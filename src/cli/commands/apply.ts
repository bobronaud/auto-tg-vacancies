import type { Command } from "commander";
import pc from "picocolors";
import type { Page } from "playwright";
import { emailConfigProblem } from "../../apply/email.js";
import { executeApplication, submitCoverLetterForm, type ApplyOutcome, type CoverLetterForm } from "../../apply/execute.js";
import { describePlan, needsLetter, planApplication, type ApplyPlan } from "../../apply/plan.js";
import type { Config, ResumeConfig } from "../../config/schema.js";
import { openDb } from "../../db/index.js";
import { Repo, type VacancyRow } from "../../db/repo.js";
import { generateLetters } from "../../letters/generate.js";
import { pickResume, resumePdfPath } from "../../letters/resume.js";
import { describeProblems, type Validation } from "../../letters/validate.js";
import { detectAuthState } from "../../telegram/auth.js";
import { openBrowser, type TgBrowser } from "../../telegram/browser.js";
import { log } from "../../utils/logger.js";
import { configFrom } from "../context.js";

type Item = {
  v: VacancyRow;
  plan: ApplyPlan;
  resume: ResumeConfig | null;
  pdf: string | null;
  letter: string;
  validation: Validation | null;
  /** Set when a bot answered «Откликнуться» with a cover-letter form (getmatch). */
  form?: CoverLetterForm;
};

const wantsLetter = (i: Item) => needsLetter(i.plan) || !!i.form;

/** Why this item can't be sent without a human, or null when its letter (if any) is fine. */
export function letterProblem(i: Pick<Item, "letter" | "validation"> & { needsLetter: boolean }): string | null {
  if (!i.needsLetter) return null;
  if (!i.letter) return "письмо не сгенерировано";
  if (i.validation && !i.validation.ok) return `письмо не прошло проверку: ${describeProblems(i.validation)}`;
  return null;
}

export function registerApply(program: Command): void {
  program
    .command("apply")
    .description("Автоматически откликнуться на все подходящие вакансии")
    .option("-n, --limit <n>", "откликнуться не больше чем на N вакансий", (v) => Number.parseInt(v, 10))
    .action(async (opts: { limit?: number }, c: Command) => {
      const config = configFrom(c);
      const repo = new Repo(openDb(config.storage.dbPath));
      const items = await prepare(repo, config, opts.limit ?? Number.POSITIVE_INFINITY);
      if (items.length === 0) return;
      await run(repo, config, items);
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

  // Letters: one codex exec call per resume and batch.
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

type Tally = { sent: number; unconfirmed: number; failed: number; skipped: number; dryRun: number };

/** Applies to every prepared vacancy in order, without asking. Problems are logged and the run goes on. */
async function run(repo: Repo, config: Config, items: Item[]): Promise<void> {
  let browser: TgBrowser | null = null;
  let page: Page | null = null;
  const getPage = async () => {
    browser ??= await openBrowser(config);
    if (!page) {
      page = await browser.newPage();
      if ((await detectAuthState(page)) !== "logged_in") {
        throw new Error("Вход в Telegram не выполнен. Сначала войдите: «Войти в Telegram»");
      }
    } else if (!page.url().startsWith(config.browser.webUrl)) {
      // A previous application left web.telegram.org (e.g. followed a t.me link); come back.
      await page.goto(config.browser.webUrl);
    }
    return page;
  };
  const dry = config.apply.dryRun;
  const tally: Tally = { sent: 0, unconfirmed: 0, failed: 0, skipped: 0, dryRun: 0 };
  log.info(`\n🚀 Откликаюсь на вакансии: ${items.length}${dry ? pc.yellow(" (пробный режим — ничего не отправляется)") : ""}\n`);

  try {
    for (const [n, item] of items.entries()) {
      const head = `${pc.dim(`${n + 1}/${items.length}`)} ${item.v.title}${item.v.company ? pc.dim(` — ${item.v.company}`) : ""}`;
      const problem = letterProblem({ ...item, needsLetter: wantsLetter(item) });
      if (problem) {
        tally.skipped++;
        log.info(`${pc.yellow("⏭")}  ${head} · пропущено: ${problem}`);
        continue;
      }
      const base = { vacancyId: item.v.id, method: item.plan.method, target: describePlan(item.plan), letter: item.letter };
      if (dry) {
        repo.recordApplication({ ...base, status: "dry_run", detail: "" });
        tally.dryRun++;
        log.info(`${pc.cyan("◌")}  ${head} · ${base.target} · пробный отклик`);
        continue;
      }
      let outcome: ApplyOutcome;
      try {
        let result = await executeApplication(config, item.v, item.plan, item.letter, item.pdf, getPage);
        if (result.status === "needs_letter") {
          // getmatch: the employer wants a cover letter answering their questions.
          item.form = result.form;
          await writeFormLetter(config, item);
          const formProblem = letterProblem({ ...item, needsLetter: true });
          if (formProblem) {
            tally.skipped++;
            log.info(`${pc.yellow("⏭")}  ${head} · анкета работодателя, пропущено: ${formProblem}`);
            continue;
          }
          result = await submitCoverLetterForm(config, item.v.id, item.form, item.letter, getPage);
        }
        outcome = result as ApplyOutcome;
      } catch (e) {
        outcome = { status: "failed", target: base.target, detail: (e as Error).message };
      }
      repo.recordApplication({ ...base, ...outcome, letter: item.letter });
      if (outcome.status === "sent") {
        tally.sent++;
        log.info(`${pc.green("✔")}  ${head} · ${outcome.target}`);
      } else if (outcome.status === "unconfirmed") {
        tally.unconfirmed++;
        log.info(`${pc.yellow("⚠")}  ${head} · ${outcome.target} · нет подтверждения: ${outcome.detail}`);
      } else {
        tally.failed++;
        log.info(`${pc.red("✖")}  ${head} · ${outcome.target} · ${outcome.detail}`);
      }
    }
  } finally {
    await (browser as TgBrowser | null)?.close();
  }

  const parts = [
    tally.sent && pc.green(`отправлено ${tally.sent}`),
    tally.dryRun && pc.cyan(`пробных ${tally.dryRun}`),
    tally.unconfirmed && pc.yellow(`без подтверждения ${tally.unconfirmed}`),
    tally.failed && pc.red(`не получилось ${tally.failed}`),
    tally.skipped && pc.yellow(`пропущено ${tally.skipped}`),
  ].filter(Boolean);
  log.info(`\n${pc.bold("Итог:")} ${parts.join(" · ") || "ничего"}`);
  if (tally.unconfirmed) log.info(pc.dim("Без подтверждения — проверьте вручную, скриншоты в .data/screenshots/"));
  if (tally.skipped) log.info(pc.dim("Пропущенные остались в очереди и попадут в следующий запуск."));
}

/** Drafts the letter for a bot's cover-letter form, answering the recruiter's questions from the resume. */
async function writeFormLetter(config: Config, item: Item): Promise<void> {
  item.resume ??= pickResume(config, item.v);
  log.info(`Пишу ответы на вопросы рекрутера (${item.resume.id})…`);
  try {
    const [letter] = await generateLetters(config, item.resume, [
      {
        index: 1,
        title: item.v.title,
        company: item.v.company,
        text: item.v.text,
        channel: "form",
        withAttachment: false,
        questions: item.form?.questions,
      },
    ]);
    item.letter = letter?.text ?? "";
    item.validation = letter?.validation ?? null;
  } catch (e) {
    log.error(`Не удалось сгенерировать письмо: ${(e as Error).message}`);
  }
}
