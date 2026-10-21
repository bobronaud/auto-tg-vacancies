import type { Command } from "commander";

// Commands that depend on the source-format analysis (stage 5). Registered so `--help` shows the roadmap.
export function registerPending(program: Command): void {
  const notYet = (stage: string) => () => {
    throw new Error(`Not implemented yet (${stage}). See README → Roadmap.`);
  };
  program.command("scrape").description("[soon] Collect new messages and classify vacancies").action(notYet("stage 6–7"));
  program.command("reparse").description("[soon] Re-classify stored messages with the LLM").action(notYet("stage 7"));
  program.command("vacancies").description("[soon] List / show / update collected vacancies").action(notYet("stage 8"));
}
