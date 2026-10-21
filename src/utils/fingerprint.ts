import { createHash } from "node:crypto";

const normalize = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // "[Remote]", "(React)"
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Identifies the same vacancy posted in several sources: normalised title + company, falling back to the first
 * contact when the company is unknown.
 */
export function vacancyFingerprint(v: {
  title: string;
  company: string | null;
  contacts: { emails: string[]; telegramUsernames: string[]; urls: string[] };
}): string {
  const owner =
    normalize(v.company) ||
    normalize(v.contacts.emails[0] ?? v.contacts.telegramUsernames[0] ?? v.contacts.urls[0] ?? "");
  return createHash("sha256").update(`${normalize(v.title)}|${owner}`).digest("hex").slice(0, 16);
}
