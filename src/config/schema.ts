import { z } from "zod";

// Keys that look like secrets must live in .env, never in config.yaml.
const SECRET_KEY = /(api[_-]?key|token|password|passwd|secret|cookie|auth[_-]?key)/i;

export const sourceTypeSchema = z.enum(["channel", "group", "bot"]);

const botStepSchema = z.union([
  z.object({ send: z.string().min(1) }).strict(),
  z.object({ click: z.string().min(1) }).strict(),
  z
    .object({
      repeat: z.union([z.object({ send: z.string().min(1) }).strict(), z.object({ click: z.string().min(1) }).strict()]),
      times: z.number().int().positive(),
    })
    .strict(),
]);

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
    bot: z
      .object({
        startCommand: z.string().default("/start"),
        steps: z.array(botStepSchema).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const configSchema = z
  .object({
    profile: z
      .object({
        roles: z.array(z.string()).min(1),
        description: z.string().default(""),
        stack: z.array(z.string()).default([]),
        grades: z.array(z.enum(["intern", "junior", "middle", "senior", "lead"])).default([]),
        excludeKeywords: z.array(z.string()).default([]),
        workFormat: z.array(z.enum(["remote", "hybrid", "office"])).default([]),
        locations: z.array(z.string()).default([]),
        salaryMin: z
          .object({ amount: z.number().positive(), currency: z.string().length(3) })
          .strict()
          .optional(),
        languages: z.array(z.string()).default([]),
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
        // Runs through the local `claude -p` (Claude Code subscription, no API key).
        // 'sonnet' | 'opus' | 'haiku' or a full model id.
        model: z.string().default("sonnet"),
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
        minRelevance: z.number().min(0).max(1).default(0.6),
        // Messages per `claude -p` call. Every call has a fixed start-up cost, so batching matters most.
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
        dryRun: z.boolean().default(true),
        coverLetter: z.string().default(""),
        email: z
          .object({
            from: z.string().default(""),
            smtpHost: z.string().default(""),
            smtpPort: z.number().int().positive().default(587),
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
export type BotStep = z.infer<typeof botStepSchema>;

/** Returns dotted paths of keys that look like secrets. */
export function findSecretKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretKeys(v, [...path, String(i)]));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(SECRET_KEY.test(key) ? [[...path, key].join(".")] : []),
    ...findSecretKeys(v, [...path, key]),
  ]);
}
