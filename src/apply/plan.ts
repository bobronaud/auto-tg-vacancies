import type { ApplyChannel, Config } from "../config/schema.js";
import type { VacancyRow } from "../db/repo.js";
import { parseMiniAppLink } from "../telegram/links.js";

export type ApplyPlan =
  | { method: "email"; to: string }
  | { method: "telegram"; username: string }
  | { method: "bot_button"; bot: string; messageId: number; label: RegExp }
  | { method: "mini_app"; link: string };

export const needsLetter = (p: ApplyPlan) => p.method === "email" || p.method === "telegram";

const APPLY_LABEL = /откликнуться/i;
const PREFERENCE: ApplyChannel[] = ["bot_button", "mini_app", "email", "telegram"];

/** How this vacancy can be applied to automatically, honouring the LLM's choice and `apply.methods`. */
export function planApplication(v: VacancyRow, config: Config): ApplyPlan | null {
  const enabled = new Set(config.apply.methods);
  const candidates = new Map<ApplyChannel, ApplyPlan>();

  const email = v.contacts.emails.find((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (email) candidates.set("email", { method: "email", to: email });

  const own = v.sourceUsername.toLowerCase();
  const username = v.contacts.telegramUsernames
    .map((u) => u.replace(/^@/, ""))
    .find((u) => /^[A-Za-z0-9_]{4,32}$/.test(u) && u.toLowerCase() !== own && !/bot$/i.test(u));
  if (username) candidates.set("telegram", { method: "telegram", username });

  if (v.sourceType === "bot" && v.buttons.some((b) => b.kind === "callback" && APPLY_LABEL.test(b.text))) {
    candidates.set("bot_button", { method: "bot_button", bot: v.sourceUsername, messageId: v.tgMessageId, label: APPLY_LABEL });
  }

  const miniAppLink = pickMiniAppLink(v);
  if (miniAppLink) candidates.set("mini_app", { method: "mini_app", link: miniAppLink });

  const llmChoice = v.applyMethod as ApplyChannel;
  if (enabled.has(llmChoice) && candidates.has(llmChoice)) return candidates.get(llmChoice)!;
  const fallback = PREFERENCE.find((m) => enabled.has(m) && candidates.has(m));
  return fallback ? candidates.get(fallback)! : null;
}

/**
 * Prefers a link that only shows the vacancy (the app's own "Откликнуться" is pressed afterwards), so that
 * opening the app never applies by itself.
 */
function pickMiniAppLink(v: VacancyRow): string | null {
  const links = v.buttons
    .filter((b) => b.url && parseMiniAppLink(b.url))
    .map((b) => ({ text: b.text, url: b.url! }));
  // The LLM's startParam may point at the apply action itself, so "show" buttons win over it.
  const fromLlm = v.contacts.miniApp
    ? links.find((l) => parseMiniAppLink(l.url)?.startParam === v.contacts.miniApp!.startParam && !APPLY_LABEL.test(l.text))
    : undefined;
  const titleStart = v.title.slice(0, 15).toLowerCase();
  const show =
    links.find((l) => /подробнее|открыть карточку/i.test(l.text)) ??
    fromLlm ??
    links.find((l) => l.text.toLowerCase().startsWith(titleStart)) ??
    links.find((l) => !APPLY_LABEL.test(l.text));
  return (show ?? links[0])?.url ?? null;
}

export function describePlan(p: ApplyPlan): string {
  switch (p.method) {
    case "email":
      return `email → ${p.to}`;
    case "telegram":
      return `Telegram → @${p.username}`;
    case "bot_button":
      return `кнопка «Откликнуться» в @${p.bot}`;
    case "mini_app":
      return `мини-апп ${parseMiniAppLink(p.link)?.bot ?? ""}`;
  }
}
