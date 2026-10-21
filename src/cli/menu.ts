import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { confirm, number, select } from "@inquirer/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/load.js";
import { log } from "../utils/logger.js";
import { promptTheme } from "./i18n.js";
import { buildProgram } from "./program.js";

type Action = { name: string; description?: string; args: () => Promise<string[]> | string[] } | "exit";

const ACTIONS: Record<string, Action> = {
  login: { name: "Войти в Telegram (QR-код)", args: () => ["auth", "login"] },
  scrape: { name: "Собрать вакансии", args: () => ["scrape"] },
  vacancies: { name: "Показать подходящие вакансии", args: () => ["vacancies", "list"] },
  apply: { name: "Откликнуться на вакансии", args: () => ["apply"] },
  status: { name: "Проверить сессию", args: () => ["auth", "status"] },
  discover: { name: "Выбрать источники из моих подписок", args: () => ["sources", "discover"] },
  list: { name: "Показать источники", args: () => ["sources", "list"] },
  sample: {
    name: "Выгрузить примеры сообщений из источников",
    args: async () => {
      const limit = await number({ message: "Сколько сообщений с каждого источника:", default: 50, min: 1, required: true });
      return ["sources", "sample", "--limit", String(limit)];
    },
  },
  validate: { name: "Проверить конфиг", args: () => ["config", "validate"] },
  logout: { name: "Выйти из Telegram (удалить локальную сессию)", args: () => ["auth", "logout"] },
  exit: "exit",
};

/** Interactive main menu; each item runs the same commander command as the CLI. */
export async function runMenu(configPath: string): Promise<void> {
  await ensureConfig(configPath);
  for (;;) {
    console.log("\n" + pc.bold("auto-tg-vacancies") + pc.dim(" — " + summary(configPath)));
    const key = await select({
      message: "Что сделать?",
      theme: promptTheme,
      pageSize: Object.keys(ACTIONS).length,
      choices: Object.entries(ACTIONS).map(([value, a]) => ({ value, name: a === "exit" ? "Выход" : a.name })),
    });
    const action = ACTIONS[key]!;
    if (action === "exit") return;
    try {
      await buildProgram()
        .exitOverride()
        .parseAsync(["--config", configPath, ...(await action.args())], { from: "user" });
    } catch (e) {
      if (isPromptExit(e)) continue;
      log.error(e instanceof Error ? e.message : String(e));
    }
  }
}

async function ensureConfig(configPath: string): Promise<void> {
  if (existsSync(resolve(configPath))) return;
  if (await confirm({ message: `${configPath} не найден. Создать из config.example.yaml?`, default: true })) {
    copyFileSync("config.example.yaml", resolve(configPath));
    log.success(`Создан ${configPath} — опишите в разделе «profile», какие вакансии вы ищете.`);
  }
}

function summary(configPath: string): string {
  try {
    const config = loadConfig(configPath);
    const session = existsSync(resolve(config.browser.profileDir)) ? "профиль браузера есть" : "вход не выполнен";
    return `${session}, источников: ${config.sources.filter((s) => s.enabled).length}, роли: ${config.profile.roles.join(", ")}`;
  } catch {
    return pc.yellow("конфиг не найден или содержит ошибки");
  }
}

/** Ctrl+C inside an inquirer prompt. */
export function isPromptExit(e: unknown): boolean {
  return e instanceof Error && e.name === "ExitPromptError";
}
