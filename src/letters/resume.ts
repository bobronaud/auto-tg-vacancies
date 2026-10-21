import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Config, ResumeConfig } from "../config/schema.js";
import type { VacancyRow } from "../db/repo.js";

const TITLE_WEIGHT = 5;

/** Picks the resume whose `match` keywords hit the vacancy best (title counts more than stack/text). */
export function pickResume(config: Config, v: Pick<VacancyRow, "title" | "stack" | "text">): ResumeConfig {
  const { resumes, fallbackResume } = config.apply;
  if (resumes.length === 0) throw new Error("В конфиге нет резюме: заполните apply.resumes.");
  const title = v.title.toLowerCase();
  const body = `${v.stack.join(" ")} ${v.text}`.toLowerCase();
  const scored = resumes.map((r) => ({
    r,
    score: r.match.reduce((sum, k) => {
      const kw = k.toLowerCase();
      return sum + (title.includes(kw) ? TITLE_WEIGHT : 0) + (body.includes(kw) ? 1 : 0);
    }, 0),
  }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score > 0) return best.r;
  return resumes.find((r) => r.id === fallbackResume) ?? resumes[0]!;
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
