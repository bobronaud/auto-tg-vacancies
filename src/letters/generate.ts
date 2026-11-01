import type { Config, ResumeConfig } from "../config/schema.js";
import { completeWithCodexCli } from "../llm/codexCli.js";
import { letterBatchPrompt, letterSystemPrompt, parseLetters, type LetterTarget } from "./prompt.js";
import { readResumeText } from "./resume.js";
import { tidyLetter, validateLetter, type Validation } from "./validate.js";

export type GeneratedLetter = { index: number; text: string; validation: Validation };

/** Generates letters for vacancies sharing one resume, in a single `codex exec` call. */
export async function generateLetters(
  config: Config,
  resume: ResumeConfig,
  targets: LetterTarget[],
): Promise<GeneratedLetter[]> {
  if (targets.length === 0) return [];
  const letter = config.apply.letter;
  const completion = await completeWithCodexCli(config.llm, {
    system: letterSystemPrompt(letter),
    prompt: letterBatchPrompt(targets, resume, readResumeText(resume), letter),
  });
  const parsed = parseLetters(completion.text);
  return targets.map((t) => {
    const text = tidyLetter(parsed.get(t.index) ?? "");
    return { index: t.index, text, validation: validateLetter(text, letter) };
  });
}
