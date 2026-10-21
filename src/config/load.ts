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
      `Secret-like keys are not allowed in config (move them to .env): ${secretKeys.join(", ")}`,
    );
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadConfig(path = DEFAULT_CONFIG_PATH): Config {
  const full = resolve(path);
  if (!existsSync(full)) {
    throw new ConfigError(`Config not found: ${full}\nCreate it with: cp config.example.yaml config.yaml`);
  }
  return parseConfig(parse(readFileSync(full, "utf8")));
}

/** Appends sources to config.yaml, preserving comments and skipping duplicates. Returns added count. */
export function addSourcesToConfig(path: string, sources: SourceConfig[]): number {
  const full = resolve(path);
  const doc = parseDocument(readFileSync(full, "utf8"));
  const existing = new Set(
    ((doc.toJS() as { sources?: { username?: string }[] }).sources ?? []).map((s) =>
      (s.username ?? "").replace(/^@/, "").toLowerCase(),
    ),
  );
  const fresh = sources.filter((s) => !existing.has(s.username.toLowerCase()));
  if (fresh.length === 0) return 0;
  if (!doc.has("sources") || doc.get("sources") === null) doc.set("sources", doc.createNode([]));
  for (const s of fresh) {
    const { bot, ...rest } = s;
    doc.addIn(["sources"], doc.createNode(bot ? s : rest));
  }
  parseConfig(doc.toJS());
  writeFileSync(full, doc.toString(), { mode: 0o600 });
  return fresh.length;
}
