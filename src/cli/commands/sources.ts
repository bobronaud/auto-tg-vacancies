import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { checkbox } from "@inquirer/prompts";
import Table from "cli-table3";
import { addSourcesToConfig } from "../../config/load.js";
import type { SourceConfig } from "../../config/schema.js";
import { openBrowser } from "../../telegram/browser.js";
import { detectAuthState } from "../../telegram/auth.js";
import { collectHistory, openChat } from "../../telegram/chat.js";
import { listDialogs } from "../../telegram/dialogs.js";
import { log } from "../../utils/logger.js";
import { DATA_DIR, ensurePrivateDir } from "../../utils/paths.js";
import { mapPool } from "../../utils/pool.js";
import { configFrom, globals } from "../context.js";

export function registerSources(program: Command): void {
  const cmd = program.command("sources").description("Channels and bots to collect vacancies from");

  cmd
    .command("discover")
    .description("Pick channels/bots/groups from your Telegram dialogs and add them to the config")
    .option("--all-types", "also list groups (default: channels and bots only)")
    .action(async (opts: { allTypes?: boolean }, c: Command) => {
      const config = configFrom(c);
      const browser = await openBrowser(config);
      try {
        const page = await browser.newPage();
        if ((await detectAuthState(page)) !== "logged_in") throw new Error("Not logged in. Log in first (npm run dev → Log in to Telegram)");
        const known = new Set(config.sources.map((s) => s.username.toLowerCase()));
        const dialogs = await listDialogs(page);
        const candidates = dialogs.filter(
          (d): d is typeof d & { type: SourceConfig["type"]; username: string } =>
            d.type !== "user" && !!d.username && (opts.allTypes || d.type !== "group"),
        );
        const withoutUsername = dialogs.filter((d) => d.type !== "user" && !d.username).length;
        if (withoutUsername) log.warn(`${withoutUsername} private chat(s) without @username skipped (not addressable).`);
        if (candidates.length === 0) return log.warn("No channels/bots with a public @username found.");

        const picked = await checkbox({
          message: "Select sources (space to toggle, enter to confirm):",
          pageSize: 20,
          choices: candidates.map((d) => ({
            name: `[${d.type}] ${d.title} (@${d.username})`,
            value: d,
            checked: known.has(d.username.toLowerCase()),
          })),
        });
        const added = addSourcesToConfig(
          globals(c).config,
          picked.map((d) => ({ type: d.type, username: d.username, title: d.title, enabled: true, hints: "" })),
        );
        log.success(`Added ${added} source(s) to ${globals(c).config}`);
      } finally {
        await browser.close();
      }
    });

  cmd
    .command("list")
    .description("Show configured sources")
    .action((_, c: Command) => {
      const table = new Table({ head: ["type", "username", "title", "enabled"] });
      for (const s of configFrom(c).sources) table.push([s.type, "@" + s.username, s.title, s.enabled ? "yes" : "no"]);
      log.info(table.toString());
    });

  cmd
    .command("sample")
    .description("Dump recent messages of each source to .data/samples/ for format analysis")
    .option("-s, --source <username>", "only this source")
    .option("-l, --limit <n>", "messages per source", (v) => Number.parseInt(v, 10), 50)
    .action(async (opts: { source?: string; limit: number }, c: Command) => {
      const config = configFrom(c);
      const sources = config.sources.filter((s) => s.enabled && (!opts.source || s.username === opts.source.replace(/^@/, "")));
      if (sources.length === 0) throw new Error("No matching sources in config.");
      const outDir = ensurePrivateDir(join(DATA_DIR, "samples"));
      const browser = await openBrowser(config);
      try {
        const first = await browser.newPage();
        if ((await detectAuthState(first)) !== "logged_in") throw new Error("Not logged in. Log in first (npm run dev → Log in to Telegram)");
        const pages = [first, ...(await Promise.all(Array.from({ length: config.scrape.parallelSources - 1 }, () => browser.newPage())))];
        const free = [...pages];
        await mapPool(sources, pages.length, async (source) => {
          const page = free.pop()!;
          try {
            await openChat(page, source.username);
            const messages = await collectHistory(page, { limit: opts.limit });
            const file = join(outDir, `${source.username}.json`);
            writeFileSync(file, JSON.stringify({ source, messages }, null, 2), { mode: 0o600 });
            log.success(`@${source.username}: ${messages.length} message(s) → ${file}`);
          } catch (e) {
            log.error(`@${source.username}: ${(e as Error).message}`);
          } finally {
            free.push(page);
          }
        });
      } finally {
        await browser.close();
      }
    });
}
