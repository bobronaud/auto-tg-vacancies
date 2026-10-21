import type { VacancyRow } from "../db/repo.js";

// Future auto-apply (stage 9). Implementations: EmailApplier, TelegramDmApplier, MiniAppApplier.
export type ApplyResult = { status: "sent" | "dry_run" | "failed"; payload: unknown; error?: string };

export interface Applier {
  readonly method: VacancyRow["applyMethod"];
  canHandle(vacancy: VacancyRow): boolean;
  apply(vacancy: VacancyRow, opts: { dryRun: boolean }): Promise<ApplyResult>;
}
