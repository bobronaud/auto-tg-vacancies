import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config/load.js";

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: exec }));
import { codexArgs, completeWithCodexCli, configuredModel, parseCodexEvents } from "../src/llm/codexCli.js";

const llm = parseConfig({ profile: { roles: ["frontend"] }, llm: { model: "test-model" } }).llm;
const events = (...events: object[]) => events.map((event) => JSON.stringify(event)).join("\n");
const answer = (text: string, phase?: string) => ({ type: "item.completed", item: { type: "agent_message", text, phase } });
const done = { type: "turn.completed", usage: { input_tokens: 15, output_tokens: 8 } };
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  exec.mockReset();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Codex events", () => {
  it("extracts the final answer and usage without parsing application JSON", () => {
    expect(parseCodexEvents(events(
      { type: "thread.started", thread_id: "synthetic" },
      answer("working", "commentary"),
      { type: "item.completed", item: { type: "reasoning", text: "reasoning" } },
      answer(' {"results":[]} ', "final_answer"), done,
    ))).toEqual({ text: '{"results":[]}', inputTokens: 15, outputTokens: 8 });
  });
  it("accepts messages without phase and usage", () => {
    expect(parseCodexEvents(events(answer("###ПИСЬМО 1###\nHello!"), { type: "turn.completed" })).text).toContain("Hello!");
  });
  it.each(["turn.failed", "error"])("rejects %s even after an answer", (type) => {
    expect(() => parseCodexEvents(events(answer("partial"), { type, error: { message: "limit exceeded" } }))).toThrow(/limit exceeded/);
  });
  it("rejects broken JSONL, incomplete turns and empty replies", () => {
    expect(() => parseCodexEvents("[]")).toThrow(/JSONL/);
    expect(() => parseCodexEvents("broken")).toThrow(/JSONL/);
    expect(() => parseCodexEvents(events(answer("partial")))).toThrow(/завершение/);
    expect(() => parseCodexEvents(events(answer("only commentary", "commentary"), done))).toThrow(/пустой/);
  });
});

describe("Codex model selection", () => {
  function home(config?: string) {
    const dir = mkdtempSync(join(tmpdir(), "tgv-model-test-"));
    dirs.push(dir);
    vi.stubEnv("CODEX_HOME", dir);
    if (config !== undefined) writeFileSync(join(dir, "config.toml"), config);
    return dir;
  }
  it("imports only the top-level model using TOML semantics", async () => {
    home('# comment\nmodel = \'test-model\'\n[profiles.other]\nmodel = "different"\n');
    expect(await configuredModel()).toBe("test-model");
    expect(await configuredModel("explicit-model")).toBe("explicit-model");
  });
  it("falls back to the CLI when config or model is absent", async () => {
    home();
    expect(await configuredModel()).toBeUndefined();
    writeFileSync(join(process.env.CODEX_HOME!, "config.toml"), "[features]\nhooks = true\n");
    expect(await configuredModel()).toBeUndefined();
  });
  it("never leaks config fragments in parse errors", async () => {
    home('model = "SYNTHETIC_PRIVATE_VALUE');
    await expect(configuredModel()).rejects.toThrow(/Укажите llm.model/);
    await expect(configuredModel()).rejects.not.toThrow(/SYNTHETIC_PRIVATE_VALUE/);
    expect(await configuredModel("explicit-model")).toBe("explicit-model");
  });
});

describe("Codex process", () => {
  it("passes prompt through stdin, isolates instructions and removes private files", async () => {
    const prompt = "$(never-run) `never-run`\nsynthetic post";
    let cwd = "";
    const end = vi.fn();
    exec.mockImplementation((command, args, options, callback) => {
      expect(command).toBe("codex");
      expect(args).not.toContain(prompt);
      expect(args.at(-1)).toBe("-");
      expect(options.shell).toBeUndefined();
      expect(options.timeout).toBe(llm.timeoutSec * 1000);
      expect(options.killSignal).toBe("SIGKILL");
      cwd = options.cwd;
      expect(statSync(cwd).mode & 0o777).toBe(0o700);
      expect(statSync(join(cwd, "instructions.txt")).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(cwd, "instructions.txt"), "utf8")).toBe("trusted instructions");
      queueMicrotask(() => callback(null, events(answer("OK"), done), ""));
      return { stdin: Object.assign(new EventEmitter(), { end }) };
    });
    expect((await completeWithCodexCli(llm, { system: "trusted instructions", prompt })).text).toBe("OK");
    expect(end).toHaveBeenCalledWith(prompt);
    expect(existsSync(cwd)).toBe(false);
  });
  it.each([
    [{ code: "ENOENT", message: "missing" }, /codex.*не найден/],
    [{ killed: true, message: "timeout" }, /не ответил/],
    [{ code: 1, message: "failed" }, /завершился с ошибкой/],
  ])("cleans up after process failures", async (error, expected) => {
    let cwd = "";
    exec.mockImplementation((_command, _args, options, callback) => {
      cwd = options.cwd;
      queueMicrotask(() => callback(error, "", "synthetic error"));
      return { stdin: Object.assign(new EventEmitter(), { end: vi.fn() }) };
    });
    await expect(completeWithCodexCli(llm, { system: "trusted", prompt: "data" })).rejects.toThrow(expected);
    expect(existsSync(cwd)).toBe(false);
  });
  it("disables config, persistence, instructions discovery and action tools", () => {
    const args = codexArgs(llm, "/tmp/synthetic-instructions", "test-model");
    expect(args).toEqual(expect.arrayContaining([
      "--ignore-user-config", "--ignore-rules", "--ephemeral", "read-only", 'approval_policy="never"',
      "project_doc_max_bytes=0", "shell_tool", "apps", "plugins", "hooks", "multi_agent", "goals",
      "tools.experimental_request_user_input.enabled=false",
    ]));
  });
  it("reports structured authentication errors on a nonzero exit and removes files", async () => {
    let cwd = "";
    exec.mockImplementation((_command, _args, options, callback) => {
      cwd = options.cwd;
      queueMicrotask(() => callback({ code: 1, message: "exit" }, events({ type: "turn.failed", error: { message: "authentication required" } }), "diagnostics"));
      return { stdin: Object.assign(new EventEmitter(), { end: vi.fn() }) };
    });
    await expect(completeWithCodexCli(llm, { system: "trusted", prompt: "data" })).rejects.toThrow(/authentication required.*codex login/);
    expect(existsSync(cwd)).toBe(false);
  });
  it("removes files when a successful process produces malformed output", async () => {
    let cwd = "";
    exec.mockImplementation((_command, _args, options, callback) => {
      cwd = options.cwd;
      queueMicrotask(() => callback(null, "invalid JSONL", ""));
      return { stdin: Object.assign(new EventEmitter(), { end: vi.fn() }) };
    });
    await expect(completeWithCodexCli(llm, { system: "trusted", prompt: "data" })).rejects.toThrow(/JSONL/);
    expect(existsSync(cwd)).toBe(false);
  });
});
