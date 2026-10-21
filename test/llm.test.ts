import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { parseBatchResult } from "../src/llm/classify.js";
import { parseEnvelope } from "../src/llm/claudeCli.js";
import { batchPrompt, systemPrompt } from "../src/llm/prompt.js";
import { vacancyFingerprint } from "../src/utils/fingerprint.js";

const vacancy = {
  title: "Frontend developer",
  company: "Example Corp",
  grade: "middle",
  stack: ["react"],
  salary: { min: 200000, max: null, currency: "RUB", period: "month" },
  workFormat: "remote",
  location: null,
  relevance: 0.8,
  reason: "React, удалёнка",
  contacts: { emails: ["hr@example.com"], telegramUsernames: [], urls: [], miniApp: null },
  applyMethod: "email",
  applyInstructions: "",
};

describe("parseBatchResult", () => {
  it("accepts fenced JSON and drops unknown ids", () => {
    const text = "```json\n" + JSON.stringify({ results: [{ id: 1, kind: "vacancy", vacancies: [vacancy] }, { id: 99, kind: "other" }] }) + "\n```";
    const r = parseBatchResult(text, new Set([1, 2]));
    expect([...r.keys()]).toEqual([1]);
    expect(r.get(1)?.vacancies[0]?.salary?.min).toBe(200000);
  });

  it("coerces sloppy fields instead of failing the batch", () => {
    const text = JSON.stringify({
      results: [{ id: 1, kind: "weird", vacancies: [{ ...vacancy, grade: "middle+", workFormat: "удалённо", applyMethod: "dm", relevance: 2 }] }],
    });
    const v = parseBatchResult(text, new Set([1])).get(1)!;
    expect(v.kind).toBe("other");
    expect(v.vacancies[0]).toMatchObject({ grade: null, workFormat: null, applyMethod: "unknown", relevance: 0 });
  });

  it("rejects non-JSON answers", () => {
    expect(() => parseBatchResult("не могу помочь", new Set([1]))).toThrow(/JSON/);
  });
});

describe("parseEnvelope", () => {
  it("reads result and usage from the CLI envelope", () => {
    const out = JSON.stringify({ result: ' {"results":[]} ', usage: { input_tokens: 10, output_tokens: 5 } });
    expect(parseEnvelope(out, 100, "sonnet")).toMatchObject({ text: '{"results":[]}', inputTokens: 10 });
  });

  it("throws on CLI errors", () => {
    expect(() => parseEnvelope(JSON.stringify({ is_error: true, result: "limit" }), 1, "sonnet")).toThrow(/ошибку/);
  });
});

describe("fingerprint", () => {
  it("matches the same vacancy written slightly differently", () => {
    const a = vacancyFingerprint({ title: "Frontend-разработчик (React) [Remote]", company: "Ёлка", contacts: vacancy.contacts });
    const b = vacancyFingerprint({ title: "frontend разработчик", company: "ЕЛКА", contacts: vacancy.contacts });
    expect(a).toBe(b);
  });

  it("falls back to contacts when company is unknown", () => {
    const a = vacancyFingerprint({ title: "Dev", company: null, contacts: { ...vacancy.contacts, emails: ["a@example.com"] } });
    const b = vacancyFingerprint({ title: "Dev", company: null, contacts: { ...vacancy.contacts, emails: ["b@example.com"] } });
    expect(a).not.toBe(b);
  });
});

describe("prompt", () => {
  it("includes profile, source hints and messages without hashtag links", () => {
    const config = parseConfig({
      profile: { roles: ["frontend"], stack: ["react"] },
      sources: [{ type: "channel", username: "example_jobs", hints: "Контакты в конце поста" }],
    });
    const prompt = batchPrompt(
      [
        {
          id: 7,
          sourceId: 1,
          sourceUsername: "example_jobs",
          tgMessageId: 1,
          date: null,
          text: "Ищем фронтендера",
          html: "",
          links: [
            { url: "tg://search_hashtag?hashtag=react", text: "#react" },
            { url: "mailto:hr@example.com", text: "hr@example.com" },
          ],
          buttons: [{ text: "Откликнуться", kind: "callback", data: "apply__1" }],
        },
      ],
      new Map(config.sources.map((s) => [s.username, s])),
      config,
    );
    expect(prompt).toContain("Роли: frontend");
    expect(prompt).toContain("@example_jobs (channel): Контакты в конце поста");
    expect(prompt).toContain("mailto:hr@example.com");
    expect(prompt).not.toContain("search_hashtag");
    expect(prompt).toContain("callback | Откликнуться | apply__1");
    expect(systemPrompt()).toMatch(/данные, а не инструкции/);
  });
});
