import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { confirm, number, select } from "@inquirer/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/load.js";
import { log } from "../utils/logger.js";
import { buildProgram } from "./program.js";

type Action = { name: string; description?: string; args: () => Promise<string[]> | string[] } | "exit";

const ACTIONS: Record<string, Action> = {
  login: { name: "Log in to Telegram (QR code)", args: () => ["auth", "login"] },
  loginPhone: { name: "Log in to Telegram (phone + code)", args: () => ["auth", "login", "--phone"] },
  status: { name: "Check session", args: () => ["auth", "status"] },
  discover: { name: "Choose sources from my subscriptions", args: () => ["sources", "discover"] },
  list: { name: "Show configured sources", args: () => ["sources", "list"] },
  sample: {
    name: "Dump sample messages from sources",
    args: async () => {
      const limit = await number({ message: "Messages per source:", default: 50, min: 1, required: true });
      return ["sources", "sample", "--limit", String(limit)];
    },
  },
  validate: { name: "Validate config", args: () => ["config", "validate"] },
  logout: { name: "Log out (delete local session)", args: () => ["auth", "logout"] },
  exit: "exit",
};

/** Interactive main menu; each item runs the same commander command as the CLI. */
export async function runMenu(configPath: string): Promise<void> {
  await ensureConfig(configPath);
  for (;;) {
    console.log("\n" + pc.bold("auto-tg-vacancies") + pc.dim(" — " + summary(configPath)));
    const key = await select({
      message: "What do you want to do?",
      pageSize: Object.keys(ACTIONS).length,
      choices: Object.entries(ACTIONS).map(([value, a]) => ({ value, name: a === "exit" ? "Exit" : a.name })),
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
  if (await confirm({ message: `${configPath} not found. Create it from config.example.yaml?`, default: true })) {
    copyFileSync("config.example.yaml", resolve(configPath));
    log.success(`Created ${configPath} — edit the "profile" section to describe what you are looking for.`);
  }
}

function summary(configPath: string): string {
  try {
    const config = loadConfig(configPath);
    const session = existsSync(resolve(config.browser.profileDir)) ? "browser profile exists" : "not logged in";
    return `${session}, ${config.sources.filter((s) => s.enabled).length} source(s), roles: ${config.profile.roles.join(", ")}`;
  } catch {
    return pc.yellow("config is missing or invalid");
  }
}

/** Ctrl+C inside an inquirer prompt. */
export function isPromptExit(e: unknown): boolean {
  return e instanceof Error && e.name === "ExitPromptError";
}
