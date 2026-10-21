import type { Page } from "playwright";
import type { Button, Link, ScrapedMessage } from "../db/repo.js";
import { SEL } from "./selectors.js";

const WAIT_MS = 10_000;

/** Opens a chat via hash navigation (no page reload) and waits for its message list. */
export async function openChat(page: Page, username: string): Promise<void> {
  await page.evaluate((u) => (location.hash = `#@${u}`), username);
  await page.locator(SEL.bubblesScrollable).first().waitFor({ timeout: WAIT_MS });
  await page
    .locator(SEL.bubble)
    .first()
    .waitFor({ timeout: WAIT_MS })
    .catch(() => undefined); // empty chat or bot without history
}

/** Extracts all message bubbles currently rendered in the DOM. */
export async function extractVisible(page: Page, opts: { incomingOnly?: boolean } = {}): Promise<ScrapedMessage[]> {
  return page.evaluate(
    ({ sel, incomingOnly }) => {
      const bubbles = [...document.querySelectorAll<HTMLElement>(incomingOnly ? sel.incomingBubble : sel.bubble)];
      return bubbles
        .filter((b) => !b.classList.contains("service"))
        .map((b) => {
          const messageEl = b.querySelector<HTMLElement>(sel.messageText);
          const clone = messageEl?.cloneNode(true) as HTMLElement | undefined;
          clone?.querySelectorAll(sel.messageNoise).forEach((n) => n.remove());

          const links: Link[] = [...(clone?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])].map((a) => ({
            url: a.href,
            text: (a.textContent ?? "").trim(),
          }));
          const buttons: Button[] = [...b.querySelectorAll<HTMLElement>(sel.inlineButton)].map((btn) => {
            const anchor = btn.closest("a") ?? btn.querySelector("a");
            const cls = btn.className + " " + (btn.innerHTML.match(/tgico-[\w-]+/g) ?? []).join(" ");
            const kind: Button["kind"] = /web.?(app|view)/i.test(cls)
              ? "web_app"
              : anchor?.href || /url|link|arrow/i.test(cls)
                ? "url"
                : "callback";
            return { text: (btn.textContent ?? "").trim(), url: anchor?.href, kind };
          });
          const ts = Number(b.dataset.timestamp);
          return {
            tgMessageId: Number(b.dataset.mid),
            date: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
            text: (clone?.innerText ?? "").trim(),
            html: clone?.innerHTML ?? "",
            links,
            buttons,
          };
        });
    },
    { sel: SEL, incomingOnly: opts.incomingOnly ?? false },
  );
}

/**
 * Scrolls a chat upwards collecting messages until one of the stop conditions holds:
 * a message older than `since`, a message id ≤ `afterMessageId`, `limit` reached, or the start of history.
 * No artificial delays: each step waits only for new bubbles to appear.
 */
export async function collectHistory(
  page: Page,
  opts: { since?: Date; afterMessageId?: number | null; limit?: number },
): Promise<ScrapedMessage[]> {
  const byId = new Map<number, ScrapedMessage>();
  const reachedStop = () => {
    const msgs = [...byId.values()];
    if (opts.limit && msgs.length >= opts.limit) return true;
    if (opts.afterMessageId != null && msgs.some((m) => m.tgMessageId <= opts.afterMessageId!)) return true;
    if (opts.since && msgs.some((m) => m.date && new Date(m.date) < opts.since!)) return true;
    return false;
  };

  for (;;) {
    for (const m of await extractVisible(page)) byId.set(m.tgMessageId, m);
    if (reachedStop()) break;

    const minMid = Math.min(...byId.keys());
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.scrollTop = 0;
    }, SEL.bubblesScrollable);
    const loadedMore = await page
      .waitForFunction(
        ({ s, min }) => [...document.querySelectorAll<HTMLElement>(s)].some((b) => Number(b.dataset.mid) < min),
        { s: SEL.bubble, min: Number.isFinite(minMid) ? minMid : Infinity },
        { timeout: WAIT_MS },
      )
      .then(() => true)
      .catch(() => false);
    if (!loadedMore) break; // start of history
  }

  return [...byId.values()]
    .filter((m) => opts.afterMessageId == null || m.tgMessageId > opts.afterMessageId)
    .filter((m) => !opts.since || !m.date || new Date(m.date) >= opts.since)
    .sort((a, b) => b.tgMessageId - a.tgMessageId)
    .slice(0, opts.limit);
}
