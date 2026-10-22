import { describe, expect, it } from "vitest";
import { planApplication } from "../src/apply/plan.js";
import { letterProblem } from "../src/cli/commands/apply.js";
import { parseConfig } from "../src/config/load.js";
import type { VacancyRow } from "../src/db/repo.js";
import { parseLetters } from "../src/letters/prompt.js";
import { pickResume } from "../src/letters/resume.js";
import { tidyLetter, validateLetter } from "../src/letters/validate.js";

const config = parseConfig({
  profile: { roles: ["frontend"] },
  apply: {
    resumes: [
      { id: "react", match: ["react", "next.js"], file: "resumes/react.md" },
      { id: "vue", match: ["vue", "nuxt"], file: "resumes/vue.md" },
      { id: "fullstack", match: ["node"], titleMatch: ["fullstack", "full-stack"], file: "resumes/fullstack.md" },
    ],
    fallbackResume: "react",
  },
});

const vacancy = (over: Partial<VacancyRow> = {}): VacancyRow => ({
  id: 1,
  messageId: 1,
  fingerprint: "fp",
  duplicateOf: null,
  title: "Frontend developer",
  company: "Example",
  grade: null,
  stack: [],
  salary: null,
  workFormat: null,
  location: null,
  reason: "",
  contacts: { emails: [], telegramUsernames: [], urls: [], miniApp: null },
  applyMethod: "unknown",
  applyInstructions: "",
  status: "matched",
  createdAt: "",
  sourceUsername: "example_jobs",
  sourceType: "channel",
  tgMessageId: 10,
  buttons: [],
  messageDate: null,
  text: "",
  ...over,
});

describe("planApplication", () => {
  it("follows the LLM's choice when it is possible", () => {
    const v = vacancy({ applyMethod: "telegram", contacts: { emails: ["hr@example.com"], telegramUsernames: ["example_hr"], urls: [], miniApp: null } });
    expect(planApplication(v, config)).toEqual({ method: "telegram", username: "example_hr" });
  });

  it("falls back to an available method and skips the source channel itself", () => {
    const v = vacancy({ applyMethod: "telegram", contacts: { emails: ["hr@example.com"], telegramUsernames: ["example_jobs"], urls: [], miniApp: null } });
    expect(planApplication(v, config)).toEqual({ method: "email", to: "hr@example.com" });
  });

  it("uses the apply button under a bot's vacancy card", () => {
    const v = vacancy({ sourceType: "bot", sourceUsername: "example_bot", tgMessageId: 1313, buttons: [{ text: "👉 Откликнуться в боте", kind: "callback", data: "apply__1" }] });
    expect(planApplication(v, config)).toMatchObject({ method: "bot_button", bot: "example_bot", messageId: 1313 });
  });

  it("opens a mini app through the post's apply button", () => {
    const v = vacancy({
      applyMethod: "mini_app",
      buttons: [
        { text: "Подробнее", kind: "web_app", url: "https://t.me/ExampleBot/app?startapp=show" },
        { text: "Откликнуться", kind: "web_app", url: "https://t.me/ExampleBot/app?startapp=apply" },
      ],
    });
    expect(planApplication(v, config)).toEqual({ method: "mini_app", link: "https://t.me/ExampleBot/app?startapp=show" });
  });

  it("ignores an LLM-chosen startParam that is the apply action", () => {
    const v = vacancy({
      applyMethod: "mini_app",
      contacts: { emails: [], telegramUsernames: [], urls: [], miniApp: { botUsername: "ExampleBot", startParam: "apply" } },
      buttons: [
        { text: "Подробнее", kind: "web_app", url: "https://t.me/ExampleBot/app?startapp=show" },
        { text: "Откликнуться", kind: "web_app", url: "https://t.me/ExampleBot/app?startapp=apply" },
      ],
    });
    expect(planApplication(v, config)).toEqual({ method: "mini_app", link: "https://t.me/ExampleBot/app?startapp=show" });
  });

  it("returns null when only an external link is available or the method is disabled", () => {
    expect(planApplication(vacancy({ contacts: { emails: [], telegramUsernames: [], urls: ["https://example.com"], miniApp: null } }), config)).toBeNull();
    const emailOnly = vacancy({ contacts: { emails: ["hr@example.com"], telegramUsernames: [], urls: [], miniApp: null } });
    expect(planApplication(emailOnly, parseConfig({ profile: { roles: ["x"] }, apply: { methods: ["telegram"] } }))).toBeNull();
  });
});

describe("pickResume", () => {
  it("prefers keywords in the title, then falls back", () => {
    expect(pickResume(config, { title: "Vue/Nuxt developer", stack: ["react"], text: "" }).id).toBe("vue");
    expect(pickResume(config, { title: "Developer", stack: ["nuxt"], text: "" }).id).toBe("vue");
    expect(pickResume(config, { title: "Angular developer", stack: [], text: "" }).id).toBe("react");
  });

  it("uses a titleMatch resume only for such titles, matching whole words", () => {
    expect(pickResume(config, { title: "Full-stack Developer (Java / React)", stack: ["react"], text: "" }).id).toBe("fullstack");
    expect(pickResume(config, { title: "Frontend developer", stack: ["Node.js", "React"], text: "" }).id).toBe("react");
    expect(pickResume(config, { title: "Developer", stack: ["Vue.js"], text: "" }).id).toBe("vue");
    expect(pickResume(config, { title: "Developer", stack: [], text: "reactive revue" }).id).toBe("react");
  });
});

describe("letters", () => {
  it("splits a batch by delimiters", () => {
    const parsed = parseLetters("###ПИСЬМО 1###\nПервое\n\nписьмо\n###ПИСЬМО 2###\nВторое");
    expect(parsed.get(1)).toBe("Первое\n\nписьмо");
    expect(parsed.get(2)).toBe("Второе");
  });

  it("repairs typography and flags self-deprecation and signatures", () => {
    expect(tidyLetter("Здравствуйте — это «тест»…")).toBe('Здравствуйте - это "тест"...');
    const letter = config.apply.letter;
    expect(validateLetter("Здравствуйте! " + "a".repeat(400) + " Не работал с Angular, но быстро освою.", letter).problems).toContain("self_deprecating");
    expect(validateLetter("Здравствуйте! " + "a".repeat(400) + " С уважением, Иван", letter).problems).toContain("signature");
  });
});

describe("letterProblem", () => {
  const ok = { ok: true, problems: [], matched: {} };
  it("lets through applications without letters and with valid ones", () => {
    expect(letterProblem({ needsLetter: false, letter: "", validation: null })).toBeNull();
    expect(letterProblem({ needsLetter: true, letter: "Здравствуйте!", validation: ok })).toBeNull();
  });
  it("skips missing or failed letters with a reason", () => {
    expect(letterProblem({ needsLetter: true, letter: "", validation: null })).toMatch(/не сгенерировано/);
    expect(
      letterProblem({ needsLetter: true, letter: "x", validation: { ok: false, problems: ["placeholder"], matched: { placeholder: "[уточнить]" } } }),
    ).toMatch(/плейсхолдер/);
  });
});
