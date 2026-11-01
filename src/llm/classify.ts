import type { Config } from "../config/schema.js";
import type { Repo, StoredMessage, VacancyStatus } from "../db/repo.js";
import { log } from "../utils/logger.js";
import { mapPool } from "../utils/pool.js";
import { vacancyFingerprint } from "../utils/fingerprint.js";
import { completeWithCodexCli } from "./codexCli.js";
import { batchPrompt, systemPrompt } from "./prompt.js";
import { batchResultSchema, type MessageResult } from "./schema.js";

export type ClassifyStats = { messages: number; vacancies: number; matched: number; failedBatches: number };

/** Messages too short to hold a vacancy are marked `other` without an LLM call. */
const MIN_TEXT_CHARS = 40;

export async function classifyMessages(repo: Repo, config: Config, messages: StoredMessage[]): Promise<ClassifyStats> {
  const stats: ClassifyStats = { messages: 0, vacancies: 0, matched: 0, failedBatches: 0 };
  const trivial = messages.filter((m) => m.text.length < MIN_TEXT_CHARS && m.buttons.length === 0);
  for (const m of trivial) repo.saveClassification(m.id, "other", []);
  stats.messages += trivial.length;

  const sources = new Map(config.sources.map((s) => [s.username.toLowerCase(), s]));
  const batches = chunk(
    messages.filter((m) => !trivial.includes(m)),
    config.llm.batchSize,
  );
  const system = systemPrompt();

  await mapPool(batches, config.llm.concurrency, async (batch, i) => {
    try {
      const results = await classifyBatch(batch, system, batchPrompt(batch, sources, config), config);
      for (const m of batch) {
        const r = results.get(m.id);
        if (!r) continue; // left unclassified — retried on the next run
        const vacancies = r.kind === "freelance" && !config.profile.includeFreelance ? [] : r.vacancies;
        repo.saveClassification(
          m.id,
          r.kind,
          vacancies.map(({ match, ...v }) => {
            const status: VacancyStatus = match ? "matched" : "ignored";
            if (match) stats.matched++;
            return { ...v, fingerprint: vacancyFingerprint(v), status };
          }),
        );
        stats.messages++;
        stats.vacancies += vacancies.length;
      }
      log.info(`Пакет ${i + 1}/${batches.length}: разобрано ${results.size} из ${batch.length}`);
    } catch (e) {
      stats.failedBatches++;
      log.error(`Пакет ${i + 1}/${batches.length}: ${(e as Error).message}`);
    }
  });
  return stats;
}

async function classifyBatch(
  batch: StoredMessage[],
  system: string,
  prompt: string,
  config: Config,
): Promise<Map<number, MessageResult>> {
  const completion = await completeWithCodexCli(config.llm, { system, prompt });
  return parseBatchResult(completion.text, new Set(batch.map((m) => m.id)));
}

/** Parses the model's JSON; tolerates code fences and surrounding text. Unknown ids are dropped. */
export function parseBatchResult(text: string, expectedIds: Set<number>): Map<number, MessageResult> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`ответ модели не похож на JSON: ${text.slice(0, 200)}`);
  const parsed = batchResultSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
  if (!parsed.success) throw new Error(`ответ модели не прошёл проверку схемы: ${parsed.error.message.slice(0, 300)}`);
  return new Map(parsed.data.results.filter((r) => expectedIds.has(r.id)).map((r) => [r.id, r]));
}

function chunk<T>(xs: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
}
