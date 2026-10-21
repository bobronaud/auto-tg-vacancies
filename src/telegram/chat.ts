import type { Page } from "playwright";
import type { Button, Link, ScrapedMessage } from "../db/repo.js";
import { log } from "../utils/logger.js";
import { activeChatPeer, SEL } from "./selectors.js";

const WAIT_MS = 10_000;
// Loading older history: scroll nudges per step and how long to wait after each one.
const LOAD_ATTEMPTS = 3;
const LOAD_ATTEMPT_MS = 4_000;
const OPEN_TIMEOUT_MS = 30_000;
// K encodes channel message ids as serverId + 2^32.
const CHANNEL_MID_OFFSET = 2 ** 32;

/**
 * Opens a chat through K's own handler for t.me links (`im(this)`), the same path as clicking a link in a
 * message. Hash navigation (`#@username`) is ignored after the app has started. The previous chat stays
 * rendered for a moment, so we wait until the active chat belongs to `peerId`.
 */
export async function openChat(page: Page, username: string, peerId: number): Promise<void> {
  // A freshly opened tab registers `im` only after the app has booted; without it the click would leave to t.me.
  await page.waitForFunction(() => typeof (window as unknown as { im?: unknown }).im === "function", null, {
    timeout: OPEN_TIMEOUT_MS,
  });
  await page.evaluate((u) => {
    const a = document.createElement("a");
    a.href = `https://t.me/${u}`;
    a.setAttribute("onclick", "im(this)");
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, username);
  await page.locator(activeChatPeer(peerId)).first().waitFor({ timeout: OPEN_TIMEOUT_MS });
  await page.locator(SEL.bubblesScrollable).first().waitFor({ timeout: WAIT_MS });
  await page
    .locator(SEL.bubble)
    .first()
    .waitFor({ timeout: WAIT_MS })
    .catch(() => undefined); // empty chat or bot without history
}

export function serverMessageId(mid: number): number {
  return mid >= CHANNEL_MID_OFFSET ? mid - CHANNEL_MID_OFFSET : mid;
}

/** Extracts all message bubbles currently rendered in the DOM. */
export async function extractVisible(page: Page, opts: { incomingOnly?: boolean } = {}): Promise<ScrapedMessage[]> {
  return page.evaluate(
    ({ sel, incomingOnly }) => {
      const bubbles = [...document.querySelectorAll<HTMLElement>(incomingOnly ? sel.incomingBubble : sel.bubble)];
      return bubbles
        .filter((b) => Number(b.dataset.mid) > 0)
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
    if (opts.afterMessageId != null && msgs.some((m) => serverMessageId(m.tgMessageId) <= opts.afterMessageId!)) return true;
    if (opts.since && msgs.some((m) => m.date && new Date(m.date) < opts.since!)) return true;
    return false;
  };

  for (;;) {
    for (const m of await extractVisible(page)) byId.set(m.tgMessageId, m);
    if (reachedStop()) break;

    const sizeBefore = byId.size;
    const loadedMore = await loadOlder(page, Math.min(...byId.keys()));
    for (const m of await extractVisible(page)) byId.set(m.tgMessageId, m);
    log.debug(`history: ${byId.size} messages, loaded more: ${loadedMore}`);
    if (!loadedMore || byId.size === sizeBefore) break; // start of history
  }

  return [...byId.values()]
    .map((m) => ({ ...m, tgMessageId: serverMessageId(m.tgMessageId) }))
    .filter((m) => opts.afterMessageId == null || m.tgMessageId > opts.afterMessageId)
    .filter((m) => !opts.since || !m.date || new Date(m.date) >= opts.since)
    .sort((a, b) => b.tgMessageId - a.tgMessageId)
    .slice(0, opts.limit);
}

/**
 * Scrolls to the top and waits for a message older than `minMid`. Setting scrollTop to 0 when it is already 0
 * fires no scroll event, so each attempt first moves down a little.
 */
async function loadOlder(page: Page, minMid: number): Promise<boolean> {
  for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt++) {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return;
      el.scrollTop = 300;
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    }, SEL.bubblesScrollable);
    const loaded = await page
      .waitForFunction(
        ({ s, min }) =>
          [...document.querySelectorAll<HTMLElement>(s)].some((b) => {
            const mid = Number(b.dataset.mid);
            return mid > 0 && mid < min;
          }),
        { s: SEL.bubble, min: Number.isFinite(minMid) ? minMid : Infinity },
        { timeout: LOAD_ATTEMPT_MS },
      )
      .then(() => true)
      .catch(() => false);
    if (loaded) return true;
  }
  return false;
}
