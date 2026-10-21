import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { log } from "../../utils/logger.js";
import { globals } from "../context.js";

export function registerConfig(program: Command): void {
  const cmd = program.command("config").description("Config helpers");
  cmd
    .command("validate")
    .description("Validate the config file")
    .action((_, c: Command) => {
      const config = loadConfig(globals(c).config);
      log.success(`Config is valid: ${config.sources.length} source(s), roles: ${config.profile.roles.join(", ")}`);
    });
}
