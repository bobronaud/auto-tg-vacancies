import { Command } from "commander";
import { DEFAULT_CONFIG_PATH } from "../config/load.js";
import { log } from "../utils/logger.js";
import { registerApply } from "./commands/apply.js";
import { registerAuth } from "./commands/auth.js";
import { registerConfig } from "./commands/config.js";
import { registerScrape } from "./commands/scrape.js";
import { registerSources } from "./commands/sources.js";
import { registerVacancies } from "./commands/vacancies.js";
import { helpConfig } from "./i18n.js";

/** Builds a fresh commander program. The interactive menu creates one per action. */
export function buildProgram(): Command {
  const program = new Command()
    .name("tgv")
    .description("Сбор вакансий из Telegram-каналов и ботов. Без аргументов открывает интерактивное меню.")
    .option("-c, --config <path>", "файл конфига", DEFAULT_CONFIG_PATH)
    .option("-v, --verbose", "подробные логи")
    .helpOption("-h, --help", "показать справку")
    .helpCommand("help [command]", "показать справку по команде")
    .configureHelp(helpConfig)
    .hook("preAction", (cmd) => log.setVerbose(!!cmd.opts().verbose));

  registerAuth(program);
  registerSources(program);
  registerScrape(program);
  registerVacancies(program);
  registerApply(program);
  registerConfig(program);
  return program;
}
