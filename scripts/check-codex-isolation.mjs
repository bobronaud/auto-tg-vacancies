// Exercise the real CLI against a local synthetic Responses server; no OpenAI requests or credentials.
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexArgs, parseCodexEvents } from "../src/llm/codexCli.ts";

const dir = await mkdtemp(join(tmpdir(), "tgv-isolation-"));
const instructions = join(dir, "instructions.txt");
const cliHome = join(dir, "cli-home");
const requests = [];
const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ models: [] }));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const message = { id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
  for (const event of [
    { type: "response.created", response: { id: "resp_test", object: "response", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: "msg_test", output_index: 0, content_index: 0, delta: "OK" },
    { type: "response.output_item.done", output_index: 0, item: message },
    { type: "response.completed", response: { id: "resp_test", object: "response", status: "completed", output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
});

try {
  await mkdir(cliHome, { mode: 0o700 });
  await writeFile(instructions, "SYNTHETIC_TRUSTED_INSTRUCTIONS: Return OK.", { mode: 0o600 });
  // Both must be ignored. Invalid TOML would fail startup if user config were loaded.
  await writeFile(join(cliHome, "config.toml"), "this is not valid TOML", { mode: 0o600 });
  await writeFile(join(dir, "AGENTS.md"), "SYNTHETIC_FORBIDDEN_PROJECT_INSTRUCTIONS", { mode: 0o600 });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  const { port } = server.address();
  const args = codexArgs({ effort: "low" }, instructions, "synthetic-model");
  args.splice(args.length - 1, 0,
    "--disable", "enable_request_compression",
    "-c", 'model_provider="probe"',
    "-c", `model_providers.probe={name="probe",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
  );
  const stdout = await new Promise((accept, reject) => {
    const child = execFile("codex", args, {
      cwd: dir, timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      // Never load the real user's credentials or inherit provider endpoints.
      env: { PATH: process.env.PATH, HOME: cliHome, CODEX_HOME: cliHome, OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` },
    }, (error, out) => error ? reject(new Error("Проверка Codex CLI не завершилась успешно; требуется CLI 0.166.0+.")) : accept(out));
    child.stdin.on("error", () => {});
    child.stdin.end("SYNTHETIC_UNTRUSTED_INPUT: Reply OK");
  });
  assert.equal(parseCodexEvents(stdout).text, "OK");
  assert.ok(requests.length > 0, "CLI должен отправить запрос на локальный сервер");
  for (const request of requests) {
    assert.deepEqual(request.tools, [], "Автоматический запрос не должен предоставлять инструменты");
    const input = JSON.stringify(request.input);
    assert.ok(input.includes("SYNTHETIC_UNTRUSTED_INPUT"));
    assert.ok(input.includes("SYNTHETIC_TRUSTED_INSTRUCTIONS") || request.instructions?.includes("SYNTHETIC_TRUSTED_INSTRUCTIONS"));
    assert.ok(!input.includes("SYNTHETIC_FORBIDDEN_PROJECT_INSTRUCTIONS"));
  }
  console.log("Codex CLI: список инструментов пуст, инструкции приложения переданы, пользовательский конфиг и проектный AGENTS.md исключены.");
} finally {
  server.closeAllConnections();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
