import type { Command } from "commander";
import { editor, select } from "@inquirer/prompts";
import pc from "picocolors";
import type { Page } from "playwright";
import { emailConfigProblem } from "../../apply/email.js";
import { executeApplication } from "../../apply/execute.js";
import { describePlan, needsLetter, planApplication, type ApplyPlan } from "../../apply/plan.js";
import type { Config, ResumeConfig } from "../../config/schema.js";
import { openDb } from "../../db/index.js";
import { Repo, type VacancyRow } from "../../db/repo.js";
import { generateLetters } from "../../letters/generate.js";
import { pickResume, resumePdfPath } from "../../letters/resume.js";
import { describeProblems, tidyLetter, validateLetter, type Validation } from "../../letters/validate.js";
import { openBrowser, type TgBrowser } from "../../telegram/browser.js";
import { log } from "../../utils/logger.js";
import { configFrom } from "../context.js";
import { promptTheme } from "../i18n.js";
import { salaryText } from "./vacancies.js";

type Item = {
  v: VacancyRow;
  plan: ApplyPlan;
  resume: ResumeConfig | null;
  pdf: string | null;
  letter: string;
  validation: Validation | null;
};

export function registerApply(program: Command): void {
  program
    .command("apply")
    .description("Откликнуться на подходящие вакансии: просмотр и подтверждение каждого отклика")
    .option("-n, --limit <n>", "сколько вакансий за раз", (v) => Number.parseInt(v, 10), 20)
    .action(async (opts: { limit: number }, c: Command) => {
      const config = configFrom(c);
      const repo = new Repo(openDb(config.storage.dbPath));
      const items = await prepare(repo, config, opts.limit);
      if (items.length === 0) return;
      await review(repo, config, items);
    });
}

async function prepare(repo: Repo, config: Config, limit: number): Promise<Item[]> {
  const vacancies = repo.vacanciesToApply();
  const items: Item[] = [];
  let manual = 0;
  for (const v of vacancies) {
    if (items.length >= limit) break;
    const plan = planApplication(v, config);
    if (!plan) {
      manual++;
      continue;
    }
    const resume = needsLetter(plan) ? pickResume(config, v) : null;
    items.push({ v, plan, resume, pdf: resume ? resumePdfPath(resume) : null, letter: "", validation: null });
  }
  if (manual) log.info(`Без автоматического способа отклика (только ссылка): ${manual} — см. vacancies list.`);
  if (items.length === 0) {
    log.info("Нет вакансий, на которые можно откликнуться автоматически.");
    return [];
  }
  if (items.some((i) => i.plan.method === "email") && emailConfigProblem(config)) {
    log.warn(`Email-отклики не отправятся: ${emailConfigProblem(config)}`);
  }

  // Letters: one claude -p call per resume and batch.
  const needing = items.filter((i) => i.resume);
  const byResume = Map.groupBy(needing, (i) => i.resume!.id);
  for (const group of byResume.values()) {
    for (let start = 0; start < group.length; start += config.apply.letter.batchSize) {
      const batch = group.slice(start, start + config.apply.letter.batchSize);
      log.info(`Пишу письма (${batch[0]!.resume!.id}): ${batch.length}…`);
      try {
        const letters = await generateLetters(
          config,
          batch[0]!.resume!,
          batch.map((i, idx) => ({
            index: idx + 1,
            title: i.v.title,
            company: i.v.company,
            text: i.v.text,
            channel: i.plan.method === "telegram" ? "telegram" : "email",
            withAttachment: !!i.pdf,
          })),
        );
        letters.forEach((l, idx) => Object.assign(batch[idx]!, { letter: l.text, validation: l.validation }));
      } catch (e) {
        log.error(`Не удалось сгенерировать письма: ${(e as Error).message}`);
      }
    }
  }
  return items;
}

async function review(repo: Repo, config: Config, items: Item[]): Promise<void> {
  let browser: TgBrowser | null = null;
  let page: Page | null = null;
  const getPage = async () => {
    browser ??= await openBrowser(config);
    page ??= await browser.newPage();
    return page;
  };
  const dry = config.apply.dryRun;
  if (dry) log.warn("Пробный режим (apply.dryRun: true): отклики не отправляются, только записываются.");

  try {
    for (const [n, item] of items.entries()) {
      for (;;) {
        printCard(item, n + 1, items.length);
        const blocked = needsLetter(item.plan) && !item.letter;
        const action = await select({
          message: "Что делаем?",
          theme: promptTheme,
          choices: [
            { value: "send", name: dry ? "Отправить (пробный режим)" : "Отправить", disabled: blocked && "нет письма" },
            ...(needsLetter(item.plan) ? [{ value: "edit", name: "Редактировать письмо" }] : []),
            { value: "skip", name: "Пропустить (вернуться позже)" },
            { value: "reject", name: "Не подходит" },
            { value: "manual", name: "Уже откликнулся сам" },
            { value: "quit", name: "Закончить" },
          ],
        });
        if (action === "quit") return;
        if (action === "skip") break;
        if (action === "reject") {
          repo.setVacancyStatus(item.v.id, "rejected");
          break;
        }
        if (action === "manual") {
          repo.recordApplication({ vacancyId: item.v.id, method: "manual", status: "sent", target: "", letter: "", detail: "отмечено вручную" });
          break;
        }
        if (action === "edit") {
          item.letter = tidyLetter(await editor({ message: "Письмо", default: item.letter, waitForUserInput: false }));
          item.validation = validateLetter(item.letter, config.apply.letter);
          continue;
        }
        // send
        const base = { vacancyId: item.v.id, method: item.plan.method, target: describePlan(item.plan), letter: item.letter };
        if (dry) {
          repo.recordApplication({ ...base, status: "dry_run", detail: "" });
          log.success("Записано как пробный отклик.");
          break;
        }
        try {
          const outcome = await executeApplication(config, item.v, item.plan, item.letter, item.pdf, getPage);
          repo.recordApplication({ ...base, ...outcome });
          if (outcome.status === "sent") log.success(`Отклик отправлен: ${outcome.detail}`);
          else if (outcome.status === "unconfirmed") log.warn(`Отправлено, но подтверждения нет — проверьте вручную: ${outcome.detail}`);
          else log.error(`Не получилось: ${outcome.detail}`);
        } catch (e) {
          repo.recordApplication({ ...base, status: "failed", detail: (e as Error).message });
          log.error(`Не получилось: ${(e as Error).message}`);
        }
        break;
      }
    }
    log.success("Все вакансии просмотрены.");
  } finally {
    await (browser as TgBrowser | null)?.close();
  }
}

function printCard(item: Item, n: number, total: number): void {
  const { v, plan } = item;
  const line = (k: string, val: unknown) => val && log.info(`${pc.bold(k)}: ${String(val)}`);
  log.info("\n" + pc.cyan(`── ${n}/${total} ` + "─".repeat(50)));
  log.info(pc.bold(`${v.title}${v.company ? ` — ${v.company}` : ""}`));
  line("Зарплата", salaryText(v));
  line("Формат", [v.workFormat, v.location].filter(Boolean).join(", "));
  line("Оценка", `${v.relevance.toFixed(2)} — ${v.reason}`);
  line("Источник", `https://t.me/${v.sourceUsername}/${v.tgMessageId}`);
  line("Отклик", describePlan(plan));
  if (v.applyInstructions) line("Требования к отклику", v.applyInstructions);
  if (item.resume) line("Резюме", `${item.resume.id}${item.pdf ? " + PDF" : " (без PDF)"}`);
  if (needsLetter(plan)) {
    log.info(pc.bold("Письмо:"));
    log.info(item.letter ? pc.white(item.letter) : pc.red("(не сгенерировано)"));
    if (item.validation && !item.validation.ok) log.warn(`Проверка письма: ${describeProblems(item.validation)}`);
  }
}
