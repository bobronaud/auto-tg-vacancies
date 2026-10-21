import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { Config } from "../config/schema.js";
import { log } from "../utils/logger.js";

const run = promisify(execFile);

export type Completion = { text: string; inputTokens?: number; outputTokens?: number; costUsd?: number };

/**
 * Generates through the locally installed, already-authenticated `claude` CLI, so a Claude Code
 * subscription is enough — no API key.
 *
 * By default `claude -p` ships the whole Claude Code environment with every request: its system prompt,
 * built-in tool descriptions, MCP servers (claude.ai connectors included), settings, hooks and the CLAUDE.md
 * found from cwd upwards. All of that is switched off here — for safety (the model gets no tools to act with
 * while reading untrusted Telegram posts) and to save tokens. `--bare` would do it in one flag but ignores
 * the subscription's OAuth, so the pieces are switched off one by one.
 */
export async function completeWithClaudeCli(
  llm: Config["llm"],
  req: { system: string; prompt: string },
): Promise<Completion> {
  const args = [
    "-p",
    req.prompt,
    "--output-format",
    "json",
    "--model",
    llm.model,
    "--effort",
    llm.effort,
    // No built-in tools at all.
    "--tools",
    "",
    // No MCP servers.
    "--strict-mcp-config",
    // No user/project/local settings: hooks and plugins have nothing to do here.
    "--setting-sources",
    "",
    // Replace Claude Code's own system prompt instead of appending to it.
    "--system-prompt",
    req.system,
    "--no-session-persistence",
  ];

  const started = Date.now();
  let stdout: string;
  try {
    ({ stdout } = await run("claude", args, {
      timeout: llm.timeoutSec * 1000,
      maxBuffer: 16 * 1024 * 1024,
      // Outside the project, so its CLAUDE.md and git status stay out of the prompt.
      cwd: tmpdir(),
      // The CLI finds its own credentials in the user's environment; claude.ai connectors stay off.
      env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
    }));
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.code === "ENOENT") throw new Error("`claude` не найден в PATH — установите Claude Code и войдите в него.");
    if (err.killed) throw new Error(`claude -p не ответил за ${llm.timeoutSec} с`);
    throw new Error(`claude -p завершился с ошибкой: ${err.stderr?.trim() || err.message}`);
  }
  return parseEnvelope(stdout, Date.now() - started, llm.model);
}

/** The CLI's JSON envelope carries the answer and usage; its exact shape is not a stable contract. */
export function parseEnvelope(stdout: string, elapsedMs: number, model: string): Completion {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return { text: trimmed };
  const parsed = JSON.parse(trimmed) as {
    result?: unknown;
    is_error?: boolean;
    usage?: { input_tokens?: number; output_tokens?: number };
    total_cost_usd?: number;
  };
  if (parsed.is_error) throw new Error(`claude -p вернул ошибку: ${String(parsed.result ?? trimmed).slice(0, 300)}`);
  if (typeof parsed.result !== "string") throw new Error("В ответе claude -p нет поля result");
  log.debug(
    `${model}: ${parsed.usage?.input_tokens ?? "?"} in / ${parsed.usage?.output_tokens ?? "?"} out tokens, ` +
      `${(elapsedMs / 1000).toFixed(1)} с` +
      (parsed.total_cost_usd ? `, $${parsed.total_cost_usd.toFixed(4)} из лимита подписки` : ""),
  );
  return {
    text: parsed.result.trim(),
    inputTokens: parsed.usage?.input_tokens,
    outputTokens: parsed.usage?.output_tokens,
    costUsd: parsed.total_cost_usd,
  };
}
