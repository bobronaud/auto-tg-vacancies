import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { confirm, number, select, Separator } from "@inquirer/prompts";
import pc from "picocolors";
import { planApplication } from "../apply/plan.js";
import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { openDb } from "../db/index.js";
import { Repo } from "../db/repo.js";
import { log } from "../utils/logger.js";
import { menuContext, menuTheme } from "./i18n.js";
import { buildProgram } from "./program.js";

type Stats = { session: boolean; sources: number; matched: number; ignored: number; queue: number; dryRun: boolean };

/** Interactive main menu; each item runs the same commander command as the CLI. «Выйти» or Ctrl+C exits. */
export async function runMenu(configPath: string): Promise<void> {
  await ensureConfig(configPath);
  for (;;) {
    const stats = readStats(configPath);
    console.log(`\n\n${pc.bold(pc.cyan("auto-tg-vacancies"))}\n${statusLine(stats)}\n`);
    const key = await select<string>(
      {
        message: "",
        theme: menuTheme,
        pageSize: 12,
        choices: [
          { value: "login", name: `🔑  ${pc.cyan("Войти в Telegram")}` },
          { value: "scrape", name: `📥  ${pc.green("Собрать вакансии")}` },
          { value: "browse", name: `📂  ${pc.blue("Посмотреть собранные вакансии")} ${pc.dim("›")}` },
          { value: "apply", name: `🚀  ${pc.yellow("Откликнуться на вакансии")}${stats?.queue ? pc.dim(` (${stats.queue})`) : ""}` },
          new Separator(pc.dim("  ──────────")),
          { value: "sources", name: `📡  ${pc.magenta("Источники")}` },
          { value: "sample", name: `🧪  ${pc.dim("Выгрузить примеры сообщений")}` },
          { value: "exit", name: `🚪  ${pc.red("Выйти")}` },
        ],
      },
      menuContext,
    ).catch((e: unknown) => {
      if (isPromptExit(e)) return null; // Ctrl+C in the main menu is the way out
      throw e;
    });
    if (key === null || key === "exit") return;
    try {
      const args = await argsFor(key, stats);
      if (!args) continue;
      await buildProgram()
        .exitOverride()
        .parseAsync(["--config", configPath, ...args], { from: "user" });
    } catch (e) {
      if (isPromptExit(e)) continue;
      log.error(e instanceof Error ? e.message : String(e));
    }
  }
}

/** Commander arguments for a menu item; null when the user backed out of a submenu. */
async function argsFor(key: string, stats: Stats | null): Promise<string[] | null> {
  switch (key) {
    case "login":
      return ["auth", "login"];
    case "scrape":
      return ["scrape"];
    case "apply":
      return ["apply"];
    case "sources":
      return ["sources", "manage"];
    case "sample": {
      const limit = await number({ message: "Сколько сообщений с каждого источника:", default: 50, min: 1, required: true });
      return ["sources", "sample", "--limit", String(limit)];
    }
    case "browse": {
      console.log(`\n${pc.bold("📂  Собранные вакансии")}\n`);
      const status = await select(
        {
          message: "",
          theme: menuTheme,
          choices: [
            { value: "matched", name: `✅  ${pc.green("Подходящие")}${stats ? pc.dim(` (${stats.matched})`) : ""}` },
            { value: "ignored", name: `🚫  ${pc.red("Неподходящие")}${stats ? pc.dim(` (${stats.ignored})`) : ""}` },
            new Separator(" "),
            { value: "back", name: "↩  Назад" },
          ],
        },
        menuContext,
      );
      return status === "back" ? null : ["vacancies", "browse", "--status", status];
    }
    default:
      return null;
  }
}

function statusLine(s: Stats | null): string {
  if (!s) return pc.yellow("конфиг не найден или содержит ошибки");
  const dot = pc.dim(" · ");
  return [
    s.session ? pc.green("● сессия есть") : pc.red("○ вход не выполнен"),
    `источников: ${s.sources}`,
    `подходящих: ${pc.green(String(s.matched))}`,
    `в очереди на отклик: ${s.queue ? pc.yellow(String(s.queue)) : "0"}`,
    ...(s.dryRun ? [pc.yellow("⚠ пробный режим")] : []),
  ].join(dot);
}

function readStats(configPath: string): Stats | null {
  let config: Config;
  try {
    config = loadConfig(configPath);
  } catch {
    return null;
  }
  const stats: Stats = {
    session: existsSync(resolve(config.browser.profileDir)),
    sources: config.sources.filter((s) => s.enabled).length,
    matched: 0,
    ignored: 0,
    queue: 0,
    dryRun: config.apply.dryRun,
  };
  // Don't create the database just to show zeros.
  if (!existsSync(resolve(config.storage.dbPath))) return stats;
  try {
    const repo = new Repo(openDb(config.storage.dbPath));
    stats.matched = repo.listVacancies({ status: "matched" }).length;
    stats.ignored = repo.listVacancies({ status: "ignored" }).length;
    stats.queue = repo.vacanciesToApply().filter((v) => planApplication(v, config)).length;
  } catch {
    // Counters are a nicety; the menu works without them.
  }
  return stats;
}

async function ensureConfig(configPath: string): Promise<void> {
  if (existsSync(resolve(configPath))) return;
  if (await confirm({ message: `${configPath} не найден. Создать из config.example.yaml?`, default: true })) {
    copyFileSync("config.example.yaml", resolve(configPath));
    chmodSync(resolve(configPath), 0o600); // will hold the personal profile and subscriptions
    log.success(`Создан ${configPath} — опишите в разделе «profile», какие вакансии вы ищете.`);
  }
}

/** Ctrl+C inside an inquirer prompt. */
export function isPromptExit(e: unknown): boolean {
  return e instanceof Error && e.name === "ExitPromptError";
}
