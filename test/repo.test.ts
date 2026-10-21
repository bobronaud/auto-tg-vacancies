import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { Repo, type NewVacancy } from "../src/db/repo.js";

const msg = (id: number) => ({ tgMessageId: id, date: null, text: `vacancy ${id}`, html: "", links: [], buttons: [] });
const vacancy = (fingerprint = "fp"): Omit<NewVacancy, "messageId"> => ({
  fingerprint,
  title: "Frontend developer",
  company: "Acme",
  grade: "middle",
  stack: ["react"],
  salary: null,
  workFormat: "remote",
  location: null,
  relevance: 0.9,
  reason: "",
  contacts: { emails: ["hr@example.com"], telegramUsernames: [], urls: [], miniApp: null },
  applyMethod: "email",
  applyInstructions: "",
  status: "matched",
});

describe("repo", () => {
  it("stores messages idempotently and links duplicate vacancies", () => {
    const repo = new Repo(openDb(":memory:"));
    const a = repo.upsertSource({ type: "channel", username: "chan_a", title: "A" });
    const b = repo.upsertSource({ type: "channel", username: "chan_b", title: "B" });
    expect(repo.insertMessages(a, [msg(1), msg(2)])).toBe(2);
    expect(repo.insertMessages(a, [msg(2), msg(3)])).toBe(1);
    repo.insertMessages(b, [msg(1)]);

    const pending = repo.messagesToClassify({});
    expect(pending).toHaveLength(4);
    const [first] = repo.saveClassification(pending[0]!.id, "vacancy", [vacancy()]);
    repo.saveClassification(pending[3]!.id, "vacancy", [vacancy()]);

    expect(repo.listVacancies({})).toHaveLength(1);
    const all = repo.listVacancies({ includeDuplicates: true });
    expect(all.find((v) => v.id !== first)?.duplicateOf).toBe(first);
    expect(repo.messagesToClassify({})).toHaveLength(2);
  });

  it("stores several vacancies of a digest and replaces them on re-parse", () => {
    const repo = new Repo(openDb(":memory:"));
    const src = repo.upsertSource({ type: "bot", username: "jobs_bot", title: "" });
    repo.insertMessages(src, [msg(1)]);
    const [m] = repo.messagesToClassify({});
    repo.saveClassification(m!.id, "digest", [vacancy("a"), vacancy("b"), vacancy("c")]);
    expect(repo.listVacancies({})).toHaveLength(3);
    repo.saveClassification(m!.id, "other", []);
    expect(repo.listVacancies({})).toHaveLength(0);
  });

  it("accepts every apply method the classifier can return", () => {
    const repo = new Repo(openDb(":memory:"));
    const src = repo.upsertSource({ type: "bot", username: "jobs_bot", title: "" });
    repo.insertMessages(src, [msg(1)]);
    const [m] = repo.messagesToClassify({});
    const methods = ["email", "telegram", "mini_app", "bot_button", "link", "unknown"] as const;
    repo.saveClassification(m!.id, "digest", methods.map((applyMethod, i) => ({ ...vacancy(String(i)), applyMethod })));
    expect(repo.listVacancies({}).map((v) => v.applyMethod).sort()).toEqual([...methods].sort());
  });

  it("tracks incremental scraping position", () => {
    const repo = new Repo(openDb(":memory:"));
    const id = repo.upsertSource({ type: "bot", username: "jobs_bot", title: "" });
    repo.markScraped(id, 10);
    repo.markScraped(id, 5);
    expect(repo.getSource("jobs_bot")?.lastMessageId).toBe(10);
  });
});
