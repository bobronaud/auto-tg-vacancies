import type { Config } from "../config/schema.js";

// Checks and repairs carried over from auto-hh: the ways an LLM quietly ruins a cover letter.

export type LetterProblem =
  | "too_long"
  | "too_short"
  | "empty"
  | "markdown"
  | "placeholder"
  | "meta_commentary"
  | "typography"
  | "self_deprecating"
  | "signature"
  | "mixed_script";

export const PROBLEM_LABEL: Record<LetterProblem, string> = {
  too_long: "длиннее допустимого",
  too_short: "подозрительно короткое",
  empty: "пустое",
  markdown: "содержит markdown-разметку",
  placeholder: "содержит незаполненный плейсхолдер",
  meta_commentary: "содержит служебный текст модели",
  typography: "символы, которых нет на клавиатуре (длинное тире и подобные)",
  mixed_script: "кириллица и латиница в одном слове",
  self_deprecating: "признаётся, что чего-то не знает или не делал",
  signature: "подписано именем или контактами",
};

/** Characters a person does not type: dashes, typographic quotes, one-char ellipsis, special spaces, emoji. */
export const TYPOGRAPHY =
  /[—–―…«»“”„‘’‹›•‣▪◦→←⇒✓✔★]|[   ​]|[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** Admitting a gap. A technology missing from the resume is left unmentioned, not apologised for. */
export const SELF_DEPRECATING =
  /не\s+(?:работал|использовал|применял|знаком|владею|имею\s+опыт|приходилось|доводилось|успел)|нет\s+(?:коммерческого\s+)?опыта|отсутств\p{L}*\s+опыт|пока\s+не\s+\p{L}*(?:работал|использовал|знаком)|быстро\s+(?:освою|изучу|разберусь|выучу|подтяну)|готов\s+(?:изучить|освоить|научиться|подтянуть)|только\s+начинаю|слаб\p{L}*\s+сторон|без\s+(?:\p{L}+\s+){0,2}опыта|не\s+(?:пугает|страшно|смущает|проблема)|хотя\s+и\s+не\s|(?:haven'?t|have\s+not|never)\s+(?:worked|used)|no\s+(?:commercial\s+)?experience|(?:quickly|fast)\s+learn/iu;

// Only a sign-off followed by a name counts: "с уважением к вашему продукту" is a sentence.
const SIGN_OFF = /[Сс]\s+уважением[,!]?\s*\p{Lu}\p{L}+|[Bb]est\s+regards|[Ss]incerely,|[Kk]ind\s+regards/u;
const CONTACTS =
  /[\w.+-]+@[\w-]+\.\p{L}{2,}|\+7[\s(-]?\d{3}|\b8\s?\(?9\d{2}\)?[\s-]?\d{3}|t\.me\/|телеграм|telegram|whatsapp|вотсап/iu;
// «[уточнить]» is what the model writes when the resume has no answer to a recruiter's question.
const PLACEHOLDER = /\[(?:имя|название|компан|вакан|ваше|укажите|уточн|your|name|company)[^\]]*\]|\{\{[^}]+\}\}/i;
export const META =
  /как (?:языковая )?модель|как (?:ии|ai)|я не могу|вот (?:письмо|текст|вариант)|конечно[,!]|надеюсь, это подойд|as an ai|here is (?:the|a|your) letter/i;
export const MARKDOWN = /(\*\*|^#{1,6}\s|^[-*]\s+\p{L}|```)/mu;
export const MIXED_SCRIPT = /\p{Script=Cyrillic}\p{Script=Latin}|\p{Script=Latin}\p{Script=Cyrillic}/u;

export type Validation = { ok: boolean; problems: LetterProblem[]; matched: Partial<Record<LetterProblem, string>> };

export function validateLetter(text: string, letter: Config["apply"]["letter"]): Validation {
  const problems: LetterProblem[] = [];
  const matched: Partial<Record<LetterProblem, string>> = {};
  const trimmed = text.trim();
  const hit = (problem: LetterProblem, ...res: RegExp[]) => {
    for (const re of res) {
      const m = trimmed.match(re);
      if (m) {
        problems.push(problem);
        matched[problem] = quote(trimmed, m);
        return;
      }
    }
  };

  if (trimmed.length === 0) return { ok: false, problems: ["empty"], matched };
  if (trimmed.length > letter.maxChars) problems.push("too_long");
  if (trimmed.length < letter.minChars) problems.push("too_short");
  hit("markdown", MARKDOWN);
  hit("placeholder", PLACEHOLDER);
  hit("meta_commentary", META);
  hit("typography", TYPOGRAPHY);
  hit("mixed_script", MIXED_SCRIPT);
  hit("self_deprecating", SELF_DEPRECATING);
  hit("signature", SIGN_OFF, CONTACTS);
  return { ok: problems.length === 0, problems, matched };
}

export function describeProblems(v: Validation): string {
  return v.problems.map((p) => (v.matched[p] ? `${PROBLEM_LABEL[p]}: «${v.matched[p]}»` : PROBLEM_LABEL[p])).join("; ");
}

function quote(text: string, m: RegExpMatchArray): string {
  const at = m.index ?? 0;
  const from = Math.max(0, at - 40);
  const to = Math.min(text.length, at + m[0].length + 40);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`;
}

/** Repairs what can be repaired without touching meaning: markdown emphasis, typography, whitespace. */
export function tidyLetter(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[—–―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[«»“”„‹›]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[   ​]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
