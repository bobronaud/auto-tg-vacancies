import { Command } from "commander";
import { DEFAULT_CONFIG_PATH } from "../config/load.js";
import { log } from "../utils/logger.js";
import { registerAuth } from "./commands/auth.js";
import { registerConfig } from "./commands/config.js";
import { registerPending } from "./commands/pending.js";
import { registerSources } from "./commands/sources.js";

const program = new Command()
  .name("tgv")
  .description("Collect job vacancies from Telegram channels and bots")
  .option("-c, --config <path>", "config file", DEFAULT_CONFIG_PATH)
  .option("-v, --verbose", "verbose logging")
  .hook("preAction", (cmd) => log.setVerbose(!!cmd.opts().verbose));

registerAuth(program);
registerSources(program);
registerConfig(program);
registerPending(program);

program.parseAsync().catch((e: unknown) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
