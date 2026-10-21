import type { Command } from "commander";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";

loadEnv({ quiet: true });

export type GlobalOptions = { config: string; verbose?: boolean };

export function globals(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>();
}

export function configFrom(cmd: Command): Config {
  return loadConfig(globals(cmd).config);
}
