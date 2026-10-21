import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addSourcesToConfig, ConfigError, loadConfig, parseConfig } from "../src/config/load.js";

const minimal = { profile: { roles: ["frontend"] } };

describe("config", () => {
  it("applies defaults", () => {
    const c = parseConfig(minimal);
    expect(c.sources).toEqual([]);
    expect(c.scrape.parallelSources).toBe(4);
    expect(c.llm.model).toBe("claude-opus-5-5");
    expect(c.apply.dryRun).toBe(true);
  });

  it("accepts config.example.yaml", () => {
    expect(() => loadConfig("config.example.yaml")).not.toThrow();
  });

  it("rejects secret-like keys anywhere", () => {
    expect(() => parseConfig({ ...minimal, llm: { apiKey: "x" } })).toThrow(/move them to \.env/);
    expect(() => parseConfig({ ...minimal, apply: { email: { password: "x" } } })).toThrow(ConfigError);
  });

  it("rejects unknown keys and bad usernames", () => {
    expect(() => parseConfig({ ...minimal, typo: 1 })).toThrow(ConfigError);
    expect(() => parseConfig({ ...minimal, sources: [{ type: "channel", username: "a b" }] })).toThrow(ConfigError);
  });

  it("strips leading @ from usernames", () => {
    const c = parseConfig({ ...minimal, sources: [{ type: "bot", username: "@jobs_bot" }] });
    expect(c.sources[0]?.username).toBe("jobs_bot");
  });

  it("appends sources preserving comments and skipping duplicates", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tgv-")), "config.yaml");
    writeFileSync(file, "# my comment\nprofile:\n  roles: [frontend]\nsources:\n  - type: channel\n    username: existing_one\n");
    const source = { type: "channel" as const, title: "T", enabled: true, hints: "" };
    const added = addSourcesToConfig(file, [
      { ...source, username: "Existing_One" },
      { ...source, username: "new_channel" },
    ]);
    expect(added).toBe(1);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("# my comment");
    expect(loadConfig(file).sources.map((s) => s.username)).toEqual(["existing_one", "new_channel"]);
  });
});
