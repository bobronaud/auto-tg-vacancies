import type { Command } from "commander";
import { openDb } from "../../db/index.js";
import { Repo } from "../../db/repo.js";
import { classifyMessages } from "../../llm/classify.js";
import { collectMessages } from "../../scraper/collect.js";
import { pickSources } from "../../scraper/sources.js";
import { log } from "../../utils/logger.js";
import { configFrom } from "../context.js";

const parseDays = (v: string) => {
  const days = Number.parseInt(v.replace(/d$/i, ""), 10);
  if (!Number.isFinite(days) || days <= 0) throw new Error("--since: ожидается число дней, например 7 или 7d");
  return new Date(Date.now() - days * 24 * 3600 * 1000);
};

export function registerScrape(program: Command): void {
  program
    .command("scrape")
    .description("Собрать новые сообщения из источников и отобрать вакансии через Claude")
    .option("-s, --source <username>", "только этот источник")
    .option("--since <days>", "перечитать историю за N дней (по умолчанию — только новое)", parseDays)
    .option("--no-llm", "только собрать сообщения, без разбора")
    .action(async (opts: { source?: string; since?: Date; llm: boolean }, c: Command) => {
      const config = configFrom(c);
      const repo = new Repo(openDb(config.storage.dbPath));
      const collected = await collectMessages(repo, config, pickSources(config, opts.source), { since: opts.since });
      log.success(`Собрано: источников ${collected.sources}, новых сообщений ${collected.newMessages}`);
      if (opts.llm) await classifyPending(repo, configFrom(c), { source: opts.source });
    });

  program
    .command("reparse")
    .description("Заново разобрать сохранённые сообщения (например, после правки профиля)")
    .option("-s, --source <username>", "только этот источник")
    .option("--pending", "только ещё не разобранные")
    .action(async (opts: { source?: string; pending?: boolean }, c: Command) => {
      const config = configFrom(c);
      const repo = new Repo(openDb(config.storage.dbPath));
      await classifyPending(repo, config, { source: opts.source, all: !opts.pending });
    });
}

async function classifyPending(
  repo: Repo,
  config: ReturnType<typeof configFrom>,
  opts: { source?: string; all?: boolean },
): Promise<void> {
  const messages = repo.messagesToClassify({ source: opts.source?.replace(/^@/, ""), all: opts.all });
  if (messages.length === 0) return log.info("Нечего разбирать.");
  log.info(
    `Разбор ${messages.length} сообщений через claude -p (${config.llm.model}), ` +
      `пакетов: ${Math.ceil(messages.length / config.llm.batchSize)}…`,
  );
  const s = await classifyMessages(repo, config, messages);
  log.success(`Разобрано сообщений ${s.messages}, вакансий ${s.vacancies}, подходящих ${s.matched}`);
  if (s.failedBatches) log.warn(`Пакетов с ошибкой: ${s.failedBatches} — их сообщения разберутся при следующем запуске.`);
}
