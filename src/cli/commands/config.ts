import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { log } from "../../utils/logger.js";
import { globals } from "../context.js";

export function registerConfig(program: Command): void {
  const cmd = program.command("config").description("Работа с конфигом");
  cmd
    .command("validate")
    .description("Проверить файл конфига")
    .action((_, c: Command) => {
      const config = loadConfig(globals(c).config);
      log.success(`Конфиг в порядке: источников ${config.sources.length}, роли: ${config.profile.roles.join(", ")}`);
    });
}
