import type { Command } from "commander";

// Commands that depend on the source-format analysis (stage 5). Registered so `--help` shows the roadmap.
export function registerPending(program: Command): void {
  const notYet = (stage: string) => () => {
    throw new Error(`Ещё не реализовано (${stage}). См. README → Roadmap.`);
  };
  program.command("scrape").description("[скоро] Собрать новые сообщения и отобрать вакансии").action(notYet("этапы 6–7"));
  program.command("reparse").description("[скоро] Заново разобрать сохранённые сообщения через LLM").action(notYet("этап 7"));
  program.command("vacancies").description("[скоро] Список, просмотр и статусы собранных вакансий").action(notYet("этап 8"));
}
