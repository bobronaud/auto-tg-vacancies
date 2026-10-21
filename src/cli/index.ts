import { DEFAULT_CONFIG_PATH } from "../config/load.js";
import { log } from "../utils/logger.js";
import { isPromptExit, runMenu } from "./menu.js";
import { buildProgram } from "./program.js";

const args = process.argv.slice(2);
const configFlag = args.findIndex((a) => a === "-c" || a === "--config");
const onlyConfigFlag = args.length === 0 || (configFlag === 0 && args.length === 2);

const run = onlyConfigFlag
  ? runMenu(args[1] ?? DEFAULT_CONFIG_PATH)
  : buildProgram().parseAsync().then(() => undefined);

run.catch((e: unknown) => {
  if (isPromptExit(e)) process.exit(130);
  log.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
