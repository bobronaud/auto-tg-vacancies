import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DATA_DIR = resolve(".data");

/** Creates a private directory (0700) — used for everything under .data/. */
export function ensurePrivateDir(dir: string): string {
  const full = resolve(dir);
  if (!existsSync(full)) mkdirSync(full, { recursive: true, mode: 0o700 });
  chmodSync(full, 0o700);
  return full;
}

export function ensureParentDir(file: string): string {
  ensurePrivateDir(dirname(file));
  return resolve(file);
}
