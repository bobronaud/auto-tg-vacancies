import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument, parse } from "yaml";
import { z } from "zod";
import { configSchema, findSecretKeys, type Config, type SourceConfig } from "./schema.js";

export const DEFAULT_CONFIG_PATH = "config.yaml";

export class ConfigError extends Error {}

export function parseConfig(raw: unknown): Config {
  const secretKeys = findSecretKeys(raw);
  if (secretKeys.length > 0) {
    throw new ConfigError(
      `Секреты в конфиге запрещены, перенесите их в .env: ${secretKeys.join(", ")}`,
    );
  }
  // Set right before parsing: a locale set at import time did not survive the CLI import graph.
  z.config(z.locales.ru());
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Ошибки в конфиге:\n${z.prettifyError(result.error).replaceAll("→ at ", "→ в ")}`);
  }
  return result.data;
}

export function loadConfig(path = DEFAULT_CONFIG_PATH): Config {
  const full = resolve(path);
  if (!existsSync(full)) {
    throw new ConfigError(`Конфиг не найден: ${full}\nСоздайте его: cp config.example.yaml config.yaml`);
  }
  return parseConfig(parse(readFileSync(full, "utf8")));
}

export type SourceChanges = { add: SourceConfig[]; enable: string[]; disable: string[] };

/**
 * Adds new sources and switches existing ones on or off in config.yaml, preserving comments.
 * Disabling keeps the entry (and its hints) so it can be switched back on. Returns what actually changed.
 */
export function applySourceChanges(path: string, changes: SourceChanges): { added: number; enabled: number; disabled: number } {
  const full = resolve(path);
  const doc = parseDocument(readFileSync(full, "utf8"));
  if (!doc.has("sources") || doc.get("sources") === null) doc.set("sources", doc.createNode([]));
  const seq = doc.get("sources") as { flow?: boolean; items: { flow?: boolean; get(k: string): unknown; set(k: string, v: unknown): void }[] };
  const items = seq.items;
  const key = (u: unknown) => String(u ?? "").replace(/^@/, "").toLowerCase();
  const byName = new Map(items.map((item) => [key(item.get("username")), item]));
  const enable = new Set(changes.enable.map(key));
  const disable = new Set(changes.disable.map(key));
  const result = { added: 0, enabled: 0, disabled: 0 };

  for (const [name, item] of byName) {
    const on = item.get("enabled") !== false;
    if (enable.has(name) && !on) {
      item.set("enabled", true);
      result.enabled++;
    } else if (disable.has(name) && on) {
      item.set("enabled", false);
      result.disabled++;
    }
  }
  for (const s of changes.add.filter((s) => !byName.has(key(s.username)))) {
    doc.addIn(["sources"], doc.createNode(s));
    result.added++;
  }
  if (result.added + result.enabled + result.disabled === 0) return result;
  // The example config starts with `sources: []`, a flow sequence; keep the list readable, one source per block.
  seq.flow = false;
  for (const item of seq.items) item.flow = false;
  parseConfig(doc.toJS());
  writeFileSync(full, doc.toString({ lineWidth: 0 }), { mode: 0o600 });
  return result;
}
