import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySourceChanges, ConfigError, loadConfig, parseConfig } from "../src/config/load.js";

const minimal = { profile: { roles: ["frontend"] } };

describe("config", () => {
  it("applies defaults", () => {
    const c = parseConfig(minimal);
    expect(c.sources).toEqual([]);
    expect(c.scrape.parallelSources).toBe(4);
    expect(c.llm.model).toBe("sonnet");
    expect(c.llm.batchSize).toBe(10);
    expect(c.apply.dryRun).toBe(true);
  });

  it("accepts config.example.yaml", () => {
    expect(() => loadConfig("config.example.yaml")).not.toThrow();
  });

  it("rejects secret-like keys anywhere", () => {
    expect(() => parseConfig({ ...minimal, llm: { apiKey: "x" } })).toThrow(/перенесите их в \.env/);
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

  it("adds, disables and re-enables sources preserving comments and hints", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tgv-")), "config.yaml");
    writeFileSync(
      file,
      "# my comment\nprofile:\n  roles: [frontend]\nsources: [{ type: channel, username: existing_one, hints: keep me }]\n",
    );
    const source = { type: "channel" as const, title: "T", enabled: true, hints: "" };
    expect(
      applySourceChanges(file, {
        add: [{ ...source, username: "Existing_One" }, { ...source, username: "new_channel" }],
        enable: ["new_channel"],
        disable: ["existing_one"],
      }),
    ).toEqual({ added: 1, enabled: 0, disabled: 1 });
    const text = readFileSync(file, "utf8");
    expect(text).toContain("# my comment");
    expect(text).toMatch(/^sources:\n  - type: channel\n/m); // flow style from `sources: []` turned into a block list
    let sources = loadConfig(file).sources;
    expect(sources.map((s) => [s.username, s.enabled, s.hints])).toEqual([
      ["existing_one", false, "keep me"],
      ["new_channel", true, ""],
    ]);

    expect(applySourceChanges(file, { add: [], enable: ["EXISTING_ONE"], disable: [] })).toEqual({ added: 0, enabled: 1, disabled: 0 });
    sources = loadConfig(file).sources;
    expect(sources[0]).toMatchObject({ username: "existing_one", enabled: true, hints: "keep me" });
  });

});
