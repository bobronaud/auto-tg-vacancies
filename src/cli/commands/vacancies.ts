import type { Command } from "commander";
import { select, Separator } from "@inquirer/prompts";
import Table from "cli-table3";
import pc from "picocolors";
import { openDb } from "../../db/index.js";
import { Repo, VACANCY_STATUSES, type VacancyRow, type VacancyStatus } from "../../db/repo.js";
import { log } from "../../utils/logger.js";
import { configFrom } from "../context.js";
import { menuContext, menuTheme } from "../i18n.js";

const STATUS_LABEL: Record<VacancyStatus, string> = {
  new: "новая",
  matched: "подходит",
  rejected: "отклонена",
  applied: "отклик",
  ignored: "не подходит",
};

const parseStatus = (v: string): VacancyStatus => {
  if (!(VACANCY_STATUSES as readonly string[]).includes(v)) throw new Error(`Статус: ${VACANCY_STATUSES.join(" | ")}`);
  return v as VacancyStatus;
};

export function salaryText(v: VacancyRow): string {
  const s = v.salary;
  if (!s || (s.min == null && s.max == null)) return "";
  const fmt = (n: number) => n.toLocaleString("ru-RU");
  const range = s.min != null && s.max != null ? `${fmt(s.min)}–${fmt(s.max)}` : s.min != null ? `от ${fmt(s.min)}` : `до ${fmt(s.max!)}`;
  return `${range} ${s.currency ?? ""}`.trim();
}

function contactText(v: VacancyRow): string {
  const c = v.contacts;
  return [
    ...c.emails,
    ...c.telegramUsernames.map((u) => "@" + u),
    ...(c.miniApp ? [`мини-апп @${c.miniApp.botUsername}`] : []),
    ...c.urls,
  ][0] ?? "";
}

const STATUS_TITLE: Partial<Record<VacancyStatus, string>> = {
  matched: "✅ Подходящие вакансии",
  ignored: "🚫 Неподходящие вакансии",
};

/** Score coloured against the matching threshold: green — matched, yellow — close to it, red — far below. */
export function relevanceBadge(score: number, min: number): string {
  const text = score.toFixed(2);
  if (score >= min) return pc.green(text);
  return score >= min - 0.2 ? pc.yellow(text) : pc.red(text);
}

export function printVacancy(v: VacancyRow, minRelevance: number): void {
  const line = (k: string, val: unknown) => val && log.info(`${pc.bold(k)}: ${String(val)}`);
  log.info("\n" + pc.cyan("─".repeat(60)));
  log.info(pc.bold(`${v.title}${v.company ? ` — ${v.company}` : ""}`));
  line("Оценка", `${relevanceBadge(v.relevance, minRelevance)} — ${v.reason}`);
  line("Статус", STATUS_LABEL[v.status]);
  line("Грейд", v.grade);
  line("Стек", v.stack.join(", "));
  line("Зарплата", salaryText(v));
  line("Формат", [v.workFormat, v.location].filter(Boolean).join(", "));
  line("Отклик", v.applyMethod);
  line("Инструкции", v.applyInstructions);
  line("Email", v.contacts.emails.join(", "));
  line("Telegram", v.contacts.telegramUsernames.map((u) => "@" + u).join(", "));
  line("Мини-апп", v.contacts.miniApp && `@${v.contacts.miniApp.botUsername}`);
  line("Ссылки", v.contacts.urls.join("\n  "));
  line("Источник", `https://t.me/${v.sourceUsername}/${v.tgMessageId} (${v.messageDate?.slice(0, 10) ?? ""})`);
  if (v.duplicateOf) line("Дубль вакансии", v.duplicateOf);
  log.info(pc.dim("─".repeat(60)));
  log.info(v.text);
  log.info(pc.cyan("─".repeat(60)));
}

export function registerVacancies(program: Command): void {
  const cmd = program.command("vacancies").description("Собранные вакансии");

  cmd
    .command("list", { isDefault: true })
    .description("Список вакансий (по умолчанию — подходящие)")
    .option("--status <status>", `фильтр: ${VACANCY_STATUSES.join(" | ")}`, parseStatus, "matched")
    .option("--all", "все статусы")
    .option("--duplicates", "показывать дубли из других источников")
    .option("-n, --limit <n>", "сколько показать", (v) => Number.parseInt(v, 10), 50)
    .option("-f, --format <format>", "table | json | csv", "table")
    .action(
      (opts: { status: VacancyStatus; all?: boolean; duplicates?: boolean; limit: number; format: string }, c: Command) => {
        const repo = new Repo(openDb(configFrom(c).storage.dbPath));
        const rows = repo.listVacancies({
          status: opts.all ? undefined : opts.status,
          includeDuplicates: opts.duplicates,
          limit: opts.limit,
        });
        if (opts.format === "json") return console.log(JSON.stringify(rows.map(({ text, ...v }) => v), null, 2));
        if (opts.format === "csv") return console.log(toCsv(rows));
        if (rows.length === 0) return log.info("Вакансий нет.");
        const table = new Table({
          head: ["id", "оценка", "должность", "компания", "зарплата", "формат", "отклик", "источник"],
          colWidths: [6, 8, 34, 20, 18, 9, 28, 20],
          wordWrap: true,
        });
        for (const v of rows) {
          table.push([
            v.id,
            v.relevance.toFixed(2),
            v.title,
            v.company ?? "",
            salaryText(v),
            v.workFormat ?? "",
            `${v.applyMethod}: ${contactText(v)}`,
            "@" + v.sourceUsername,
          ]);
        }
        log.info(table.toString());
        log.info(pc.dim(`Показано: ${rows.length}. Подробнее: vacancies show <id>`));
      },
    );

  cmd
    .command("show <id>")
    .description("Подробности вакансии")
    .action((id: string, _, c: Command) => {
      const config = configFrom(c);
      const v = new Repo(openDb(config.storage.dbPath)).getVacancy(Number(id));
      if (!v) throw new Error(`Вакансия ${id} не найдена`);
      printVacancy(v, config.llm.minRelevance);
    });

  cmd
    .command("browse")
    .description("Интерактивный просмотр собранных вакансий")
    .option("--status <status>", "matched — подходящие, ignored — неподходящие", parseStatus, "matched")
    .action(async (opts: { status: VacancyStatus }, c: Command) => {
      const config = configFrom(c);
      const rows = new Repo(openDb(config.storage.dbPath)).listVacancies({ status: opts.status });
      if (rows.length === 0) return log.info(`Вакансий со статусом «${STATUS_LABEL[opts.status]}» нет.`);
      let current: number | undefined;
      for (;;) {
        console.log(`\n${pc.bold(STATUS_TITLE[opts.status] ?? STATUS_LABEL[opts.status])} ${pc.dim(`(${rows.length})`)}\n`);
        const picked = await select(
          {
            message: "",
            theme: menuTheme,
            pageSize: 15,
            default: current,
            choices: [
              ...rows.map((v) => ({
                value: v.id,
                name: `${relevanceBadge(v.relevance, config.llm.minRelevance)}  ${v.title}${v.company ? pc.dim(` — ${v.company}`) : ""} ${pc.dim(`@${v.sourceUsername}`)}`,
              })),
              new Separator(" "),
              { value: -1, name: "↩  Назад" },
            ],
          },
          menuContext,
        );
        if (picked === -1) return;
        current = picked;
        printVacancy(rows.find((v) => v.id === picked)!, config.llm.minRelevance);
        const next = await select(
          {
            message: "",
            theme: menuTheme,
            choices: [
              { value: "list", name: "↩  К списку" },
              { value: "back", name: "↩  В меню" },
            ],
          },
          menuContext,
        );
        if (next === "back") return;
      }
    });

  cmd
    .command("set-status <id> <status>")
    .description(`Изменить статус: ${VACANCY_STATUSES.join(" | ")}`)
    .action((id: string, status: string, _, c: Command) => {
      const ok = new Repo(openDb(configFrom(c).storage.dbPath)).setVacancyStatus(Number(id), parseStatus(status));
      if (!ok) throw new Error(`Вакансия ${id} не найдена`);
      log.success(`Вакансия ${id}: ${STATUS_LABEL[parseStatus(status)]}`);
    });
}

function toCsv(rows: VacancyRow[]): string {
  const cols = ["id", "status", "relevance", "title", "company", "grade", "salary", "workFormat", "location", "applyMethod", "contact", "source", "date"];
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [
    cols.join(","),
    ...rows.map((v) =>
      [v.id, v.status, v.relevance, v.title, v.company, v.grade, salaryText(v), v.workFormat, v.location, v.applyMethod, contactText(v), "@" + v.sourceUsername, v.messageDate]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}
