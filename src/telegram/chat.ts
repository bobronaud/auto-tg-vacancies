import type { Page } from "playwright";
import type { Button, Link, ScrapedMessage } from "../db/repo.js";
import { normalizeButton } from "./links.js";
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

/**
 * Extracts all message bubbles currently rendered in the DOM. Buttons come from K's message store
 * (`rootScope.managers`): the DOM has no URLs or callback data for inline buttons.
 */
export async function extractVisible(
  page: Page,
  peerId: number,
  opts: { incomingOnly?: boolean } = {},
): Promise<ScrapedMessage[]> {
  const messages = await page.evaluate(
    async ({ sel, incomingOnly, peerId }) => {
      type Obj = Record<string, any>;
      const managers = (window as unknown as { rootScope?: Obj }).rootScope?.managers;
      const decode = (data: unknown) => {
        if (!data || typeof data !== "object") return undefined;
        return new TextDecoder().decode(Uint8Array.from(Object.values(data as Record<string, number>)));
      };
      const toButton = (btn: Obj): Button => {
        const type: string = btn.type?._ ?? btn._ ?? "";
        const url: string | undefined = btn.type?.url ?? btn.url;
        const text = String(btn.text ?? "").trim();
        if (/webview/i.test(type)) return { text, kind: "web_app", url };
        if (/url/i.test(type)) return { text, kind: "url", url };
        if (/callback/i.test(type)) return { text, kind: "callback", data: decode(btn.type?.data ?? btn.data) };
        if (type === "keyboardButton") return { text, kind: "text" };
        return { text, kind: "other", url };
      };
      const storeButtons = async (mid: number): Promise<Button[] | null> => {
        try {
          const msg: Obj | undefined = await managers?.appMessagesManager.getMessageByPeer(peerId, mid);
          if (!msg) return null;
          const rows: Obj[] = msg.reply_markup?.rows ?? [];
          return rows.flatMap((row) => (row.buttons ?? []).map(toButton));
        } catch {
          return null;
        }
      };
      const domButtons = (b: HTMLElement): Button[] =>
        [...b.querySelectorAll<HTMLElement>(sel.inlineButton)].map((btn) => ({
          text: (btn.textContent ?? "").trim(),
          kind: "other",
        }));

      const bubbles = [...document.querySelectorAll<HTMLElement>(incomingOnly ? sel.incomingBubble : sel.bubble)];
      return Promise.all(
        bubbles
          .filter((b) => Number(b.dataset.mid) > 0)
          .map(async (b) => {
            const mid = Number(b.dataset.mid);
            const clone = b.querySelector<HTMLElement>(sel.messageText)?.cloneNode(true) as HTMLElement | undefined;
            clone?.querySelectorAll(sel.messageNoise).forEach((n) => n.remove());
            const links: Link[] = [...(clone?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])].map((a) => ({
              url: a.href,
              text: (a.textContent ?? "").trim(),
            }));
            const ts = Number(b.dataset.timestamp);
            return {
              tgMessageId: mid,
              date: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
              text: (clone?.innerText ?? "").trim(),
              html: clone?.innerHTML ?? "",
              links,
              buttons: (await storeButtons(mid)) ?? domButtons(b),
            };
          }),
      );
    },
    { sel: SEL, incomingOnly: opts.incomingOnly ?? false, peerId },
  );
  return messages.map((m) => ({ ...m, buttons: m.buttons.map(normalizeButton) }));
}

/**
 * Scrolls a chat upwards collecting messages until one of the stop conditions holds:
 * a message older than `since`, a message id ≤ `afterMessageId`, `limit` reached, or the start of history.
 * No artificial delays: each step waits only for new bubbles to appear.
 */
export async function collectHistory(
  page: Page,
  peerId: number,
  opts: { since?: Date; afterMessageId?: number | null; limit?: number; incomingOnly?: boolean },
): Promise<ScrapedMessage[]> {
  const byId = new Map<number, ScrapedMessage>();
  const reachedStop = () => {
    const msgs = [...byId.values()];
    if (opts.limit && msgs.length >= opts.limit) return true;
    if (opts.afterMessageId != null && msgs.some((m) => serverMessageId(m.tgMessageId) <= opts.afterMessageId!)) return true;
    if (opts.since && msgs.some((m) => m.date && new Date(m.date) < opts.since!)) return true;
    return false;
  };

  let stalls = 0;
  for (;;) {
    for (const m of await extractVisible(page, peerId, opts)) byId.set(m.tgMessageId, m);
    if (reachedStop()) break;

    const sizeBefore = byId.size;
    const loadedMore = await loadOlder(page, Math.min(...byId.keys()));
    for (const m of await extractVisible(page, peerId, opts)) byId.set(m.tgMessageId, m);
    log.debug(`history: ${byId.size} messages, loaded more: ${loadedMore}`);
    if (!loadedMore) break; // start of history
    // K sometimes renders an older bubble and immediately re-renders the list; retry before giving up.
    stalls = byId.size === sizeBefore ? stalls + 1 : 0;
    if (stalls >= LOAD_ATTEMPTS) break;
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
