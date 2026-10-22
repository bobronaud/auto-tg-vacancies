import { z } from "zod";
import { MESSAGE_KINDS } from "../db/repo.js";

const nullableString = z.string().nullish().transform((v) => (v ? v : null));

export const extractedVacancySchema = z.object({
  title: z.string().min(1),
  company: nullableString,
  grade: z.enum(["intern", "junior", "middle", "senior", "lead"]).nullish().catch(null).transform((v) => v ?? null),
  stack: z.array(z.string()).catch([]).default([]),
  salary: z
    .object({
      min: z.number().nullish().transform((v) => v ?? null),
      max: z.number().nullish().transform((v) => v ?? null),
      currency: nullableString,
      period: nullableString,
    })
    .nullish()
    .catch(null)
    .transform((v) => v ?? null),
  workFormat: z.enum(["remote", "hybrid", "office"]).nullish().catch(null).transform((v) => v ?? null),
  location: nullableString,
  match: z.boolean().catch(false),
  reason: z.string().catch(""),
  contacts: z
    .object({
      emails: z.array(z.string()).catch([]).default([]),
      telegramUsernames: z.array(z.string()).catch([]).default([]),
      urls: z.array(z.string()).catch([]).default([]),
      miniApp: z
        .object({ botUsername: z.string(), startParam: nullableString })
        .nullish()
        .catch(null)
        .transform((v) => v ?? null),
    })
    .catch({ emails: [], telegramUsernames: [], urls: [], miniApp: null }),
  applyMethod: z.enum(["email", "telegram", "mini_app", "bot_button", "link", "unknown"]).catch("unknown"),
  applyInstructions: z.string().catch(""),
});

export const messageResultSchema = z.object({
  id: z.number().int(),
  kind: z.enum(MESSAGE_KINDS).catch("other"),
  vacancies: z.array(extractedVacancySchema).catch([]).default([]),
});

export const batchResultSchema = z.object({ results: z.array(messageResultSchema) });

export type MessageResult = z.infer<typeof messageResultSchema>;
