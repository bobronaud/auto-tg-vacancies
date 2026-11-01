import { z } from "zod";
import { log } from "../utils/logger.js";

// Keys that look like secrets must live in .env, never in config.yaml.
const SECRET_KEY = /(api[_-]?key|token|password|passwd|secret|cookie|auth[_-]?key)/i;

export const sourceTypeSchema = z.enum(["channel", "group", "bot"]);

export const sourceSchema = z
  .object({
    type: sourceTypeSchema,
    username: z
      .string()
      .regex(/^@?[A-Za-z0-9_]{4,32}$/, "username в Telegram: 4–32 символа, латиница, цифры и подчёркивание")
      .transform((u) => u.replace(/^@/, "")),
    title: z.string().default(""),
    enabled: z.boolean().default(true),
    hints: z.string().default(""),
  })
  .strict();

export const applyMethodSchema = z.enum(["email", "telegram", "bot_button", "mini_app"]);

export const resumeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]+$/i),
    title: z.string().default(""),
    // Keywords that pick this resume for a vacancy (title and stack).
    match: z.array(z.string()).default([]),
    // Keywords in the vacancy title that pick this resume outright, e.g. [fullstack]. A resume with them is used
    // only on such a title; `match` doesn't apply to it.
    titleMatch: z.array(z.string()).default([]),
    // Facts for letters (markdown); and the PDF attached to emails / Telegram messages.
    file: z.string(),
    pdf: z.string().optional(),
  })
  .strict();

export const configSchema = z
  .object({
    profile: z
      .object({
        roles: z.array(z.string()).min(1),
        description: z.string().default(""),
        stack: z.array(z.string()).default([]),
        // What makes a vacancy not matching (unless its role is in `roles`). Grade, format, location and salary never do.
        excludeKeywords: z.array(z.string()).default([]),
        includeFreelance: z.boolean().default(false),
      })
      .strict(),
    sources: z.array(sourceSchema).default([]),
    scrape: z
      .object({
        lookbackDays: z.number().int().positive().default(14),
        parallelSources: z.number().int().positive().default(4),
        headless: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    llm: z
      .object({
        // Omit to use the model from Codex user config, or the CLI's built-in default.
        model: z.string().trim().min(1).optional().transform((model) => {
          if (model && /^(sonnet|opus|haiku)(?:[-.]|$)|^claude-/i.test(model)) {
            log.warn("llm.model содержит модель Claude: используется модель Codex по умолчанию. Удалите llm.model или укажите модель Codex.");
            return undefined;
          }
          return model;
        }),
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low")
          .transform((effort) => effort === "max" ? "xhigh" as const : effort),
        // Messages per `codex exec` call. Every call has a fixed start-up cost, so batching matters most.
        batchSize: z.number().int().min(1).max(25).default(10),
        // Each call is a separate process — keep it low.
        concurrency: z.number().int().min(1).max(8).default(2),
        timeoutSec: z.number().int().min(10).max(600).default(180),
      })
      .strict()
      .prefault({}),
    storage: z
      .object({ dbPath: z.string().default(".data/vacancies.db") })
      .strict()
      .prefault({}),
    browser: z
      .object({
        profileDir: z.string().default(".data/browser-profile"),
        webUrl: z.url().default("https://web.telegram.org/k/"),
      })
      .strict()
      .prefault({}),
    apply: z
      .object({
        // true: nothing is sent, applications are only recorded as dry runs.
        dryRun: z.boolean().default(true),
        methods: z.array(applyMethodSchema).default(["email", "telegram", "bot_button", "mini_app"]),
        resumes: z.array(resumeSchema).default([]),
        // Resume id used when no resume's `match` keywords hit the vacancy.
        fallbackResume: z.string().optional(),
        letter: z
          .object({
            maxChars: z.number().int().min(100).max(4000).default(1000),
            minChars: z.number().int().min(0).default(300),
            // Experience worth mentioning that the resume files don't spell out.
            extraSkills: z.string().default(""),
            // Letters per `codex exec` call.
            batchSize: z.number().int().min(1).max(25).default(10),
            // Recruiter's questions without an exact answer in the resume (percentages, load figures):
            // false — leave «[уточнить]» for you to fill in; true — give a plausible estimate consistent with the
            // resume. Never invents employers, projects or technologies either way.
            estimateMissing: z.boolean().default(false),
          })
          .strict()
          .prefault({}),
        email: z
          .object({
            from: z.string().default(""),
            // SMTP login; defaults to `from`. The password is read from SMTP_PASSWORD in .env.
            user: z.string().default(""),
            smtpHost: z.string().default(""),
            smtpPort: z.number().int().positive().default(465),
            subject: z.string().default("Отклик на вакансию {title}"),
          })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
export type ResumeConfig = z.infer<typeof resumeSchema>;
export type ApplyChannel = z.infer<typeof applyMethodSchema>;

/** Returns dotted paths of keys that look like secrets. */
export function findSecretKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretKeys(v, [...path, String(i)]));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(SECRET_KEY.test(key) ? [[...path, key].join(".")] : []),
    ...findSecretKeys(v, [...path, key]),
  ]);
}
