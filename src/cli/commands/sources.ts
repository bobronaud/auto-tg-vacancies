import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { checkbox } from "@inquirer/prompts";
import Table from "cli-table3";
import { addSourcesToConfig } from "../../config/load.js";
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

export function registerSources(program: Command): void {
  const cmd = program.command("sources").description("Каналы и боты, из которых собираются вакансии");

  cmd
    .command("discover")
    .description("Выбрать каналы и ботов из ваших чатов Telegram и добавить их в конфиг")
    .option("--all-types", "показывать также группы (по умолчанию только каналы и боты)")
    .action(async (opts: { allTypes?: boolean }, c: Command) => {
      const config = configFrom(c);
      const browser = await openBrowser(config);
      try {
        const page = await browser.newPage();
        if ((await detectAuthState(page)) !== "logged_in") throw new Error("Вход не выполнен. Сначала войдите: npm run dev → «Войти в Telegram»");
        const known = new Set(config.sources.map((s) => s.username.toLowerCase()));
        const dialogs = await listDialogs(page);
        const candidates = dialogs.filter(
          (d): d is typeof d & { type: SourceConfig["type"]; username: string } =>
            d.type !== "user" && !!d.username && (opts.allTypes || d.type !== "group"),
        );
        const withoutUsername = dialogs.filter((d) => d.type !== "user" && !d.username).length;
        if (withoutUsername) log.warn(`Пропущено приватных чатов без @username: ${withoutUsername} (к ним нельзя обратиться по ссылке).`);
        if (candidates.length === 0) return log.warn("Не найдено каналов и ботов с публичным @username.");

        const picked = await checkbox({
          message: "Выберите источники:",
          theme: promptTheme,
          pageSize: 20,
          choices: candidates.map((d) => ({
            name: `[${TYPE_LABEL[d.type]}] ${d.title} (@${d.username})`,
            value: d,
            checked: known.has(d.username.toLowerCase()),
          })),
        });
        const added = addSourcesToConfig(
          globals(c).config,
          picked.map((d) => ({ type: d.type, username: d.username, title: d.title, enabled: true, hints: "" })),
        );
        log.success(`Добавлено источников: ${added} (в ${globals(c).config})`);
      } finally {
        await browser.close();
      }
    });

  cmd
    .command("list")
    .description("Показать источники из конфига")
    .action((_, c: Command) => {
      const table = new Table({ head: ["тип", "username", "название", "включён"] });
      for (const s of configFrom(c).sources) table.push([TYPE_LABEL[s.type], "@" + s.username, s.title, s.enabled ? "да" : "нет"]);
      log.info(table.toString());
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
