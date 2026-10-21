import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { checkbox } from "@inquirer/prompts";
import Table from "cli-table3";
import pc from "picocolors";
import { applySourceChanges } from "../../config/load.js";
import type { SourceConfig } from "../../config/schema.js";
import { openBrowser } from "../../telegram/browser.js";
import { detectAuthState } from "../../telegram/auth.js";
import { collectHistory } from "../../telegram/chat.js";
import { forEachSourceChat, pickSources } from "../../scraper/sources.js";
import { listDialogs } from "../../telegram/dialogs.js";
import { log } from "../../utils/logger.js";
import { DATA_DIR, ensurePrivateDir } from "../../utils/paths.js";
import { configFrom, globals } from "../context.js";
import { promptTheme } from "../i18n.js";

const TYPE_LABEL: Record<SourceConfig["type"], string> = { channel: "канал", group: "группа", bot: "бот" };
const TYPE_ICON: Record<SourceConfig["type"], string> = { channel: "📢", group: "👥", bot: "🤖" };

function printSources(sources: SourceConfig[]): void {
  const table = new Table({ head: ["", "тип", "username", "название"] });
  for (const s of sources) {
    table.push([s.enabled ? pc.green("✔") : pc.dim("—"), `${TYPE_ICON[s.type]} ${TYPE_LABEL[s.type]}`, "@" + s.username, s.title]);
  }
  log.info(table.toString());
}

export function registerSources(program: Command): void {
  const cmd = program.command("sources").description("Каналы и боты, из которых собираются вакансии");

  cmd
    .command("manage")
    .description("Выбрать источники: каналы и боты из ваших подписок, отмечены включённые")
    .option("--all-types", "показывать также группы (по умолчанию только каналы и боты)")
    .action(async (opts: { allTypes?: boolean }, c: Command) => {
      const config = configFrom(c);
      const browser = await openBrowser(config);
      let dialogs: Awaited<ReturnType<typeof listDialogs>>;
      try {
        const page = await browser.newPage();
        if ((await detectAuthState(page)) !== "logged_in") throw new Error("Вход не выполнен. Сначала войдите: npm run dev → «Войти в Telegram»");
        dialogs = await listDialogs(page);
      } finally {
        await browser.close();
      }

      type Choice = { type: SourceConfig["type"]; username: string; title: string };
      const configured = new Map(config.sources.map((s) => [s.username.toLowerCase(), s]));
      const fromDialogs: Choice[] = dialogs.flatMap((d) =>
        d.type !== "user" && d.username && (opts.allTypes || d.type !== "group" || configured.has(d.username.toLowerCase()))
          ? [{ type: d.type, username: d.username, title: d.title }]
          : [],
      );
      const seen = new Set(fromDialogs.map((d) => d.username.toLowerCase()));
      // Sources in the config you are no longer subscribed to stay visible, so they can be switched off.
      const choices: Choice[] = [
        ...fromDialogs,
        ...config.sources.filter((s) => !seen.has(s.username.toLowerCase())),
      ];
      const withoutUsername = dialogs.filter((d) => d.type !== "user" && !d.username).length;
      if (withoutUsername) log.info(pc.dim(`Приватных чатов без @username: ${withoutUsername} — их нельзя добавить.`));
      if (choices.length === 0) return log.warn("Не найдено каналов и ботов с публичным @username.");

      const picked = await checkbox({
        message: "Источники вакансий (пробел — включить/выключить, Enter — сохранить):",
        theme: promptTheme,
        pageSize: 20,
        choices: choices.map((d) => {
          const cfg = configured.get(d.username.toLowerCase());
          return {
            name: `${TYPE_ICON[d.type]} ${d.title || d.username} ${pc.dim("@" + d.username)}${cfg && !cfg.enabled ? pc.dim(" (выключен)") : ""}`,
            short: "@" + d.username,
            value: d,
            checked: !!cfg?.enabled,
          };
        }),
      });

      const pickedNames = new Set(picked.map((d) => d.username.toLowerCase()));
      const result = applySourceChanges(globals(c).config, {
        add: picked
          .filter((d) => !configured.has(d.username.toLowerCase()))
          .map((d) => ({ type: d.type, username: d.username, title: d.title, enabled: true, hints: "" })),
        enable: picked.map((d) => d.username),
        disable: config.sources.filter((s) => !pickedNames.has(s.username.toLowerCase())).map((s) => s.username),
      });
      log.success(`Добавлено: ${result.added}, включено: ${result.enabled}, выключено: ${result.disabled}`);
      printSources(configFrom(c).sources);
    });

  cmd
    .command("list")
    .description("Показать источники из конфига")
    .action((_, c: Command) => {
      printSources(configFrom(c).sources);
    });

  cmd
    .command("sample")
    .description("Выгрузить последние сообщения каждого источника в .data/samples/ для анализа форматов")
    .option("-s, --source <username>", "только этот источник")
    .option("-l, --limit <n>", "сообщений с каждого источника", (v) => Number.parseInt(v, 10), 50)
    .action(async (opts: { source?: string; limit: number }, c: Command) => {
      const config = configFrom(c);
      const outDir = ensurePrivateDir(join(DATA_DIR, "samples"));
      await forEachSourceChat(config, pickSources(config, opts.source), async (page, source, peerId) => {
        const messages = await collectHistory(page, peerId, { limit: opts.limit });
        const file = join(outDir, `${source.username}.json`);
        writeFileSync(file, JSON.stringify({ source, messages }, null, 2), { mode: 0o600 });
        log.success(`@${source.username}: сообщений ${messages.length} → ${file}`);
      });
    });
}
