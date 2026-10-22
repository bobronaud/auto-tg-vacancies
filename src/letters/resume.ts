import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Config, ResumeConfig } from "../config/schema.js";
import type { VacancyRow } from "../db/repo.js";

const TITLE_WEIGHT = 5;

/**
 * Picks the first resume whose `titleMatch` keywords are in the vacancy title; otherwise, among resumes without
 * `titleMatch`, the one whose `match` keywords hit the vacancy best (title counts more than stack/text).
 */
export function pickResume(config: Config, v: Pick<VacancyRow, "title" | "stack" | "text">): ResumeConfig {
  const { resumes, fallbackResume } = config.apply;
  if (resumes.length === 0) throw new Error("В конфиге нет резюме: заполните apply.resumes.");
  const body = `${v.stack.join(" ")} ${v.text}`;
  const byTitle = resumes.find((r) => r.titleMatch.some((k) => hasWord(v.title, k)));
  if (byTitle) return byTitle;
  const scored = resumes
    .filter((r) => r.titleMatch.length === 0)
    .map((r) => ({
      r,
      score: r.match.reduce((sum, k) => sum + (hasWord(v.title, k) ? TITLE_WEIGHT : 0) + (hasWord(body, k) ? 1 : 0), 0),
    }));
  const best = scored.reduce<(typeof scored)[number] | null>((a, b) => (b.score > (a?.score ?? 0) ? b : a), null);
  if (best) return best.r;
  return resumes.find((r) => r.id === fallbackResume) ?? resumes[0]!;
}

/** Whole-word, case-insensitive: «node» hits «Node.js» but not «nodes». */
function hasWord(text: string, keyword: string): boolean {
  const kw = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${kw}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

export function readResumeText(resume: ResumeConfig): string {
  const path = resolve(resume.file);
  if (!existsSync(path)) throw new Error(`Файл резюме не найден: ${path}`);
  const text = readFileSync(path, "utf8").trim();
  if (text.length < 50) throw new Error(`Файл резюме почти пустой: ${path}`);
  return text;
}

export function resumePdfPath(resume: ResumeConfig): string | null {
  if (!resume.pdf) return null;
  const path = resolve(resume.pdf);
  if (!existsSync(path)) throw new Error(`PDF резюме не найден: ${path}`);
  return path;
}
