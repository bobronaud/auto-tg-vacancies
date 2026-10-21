import type { Page } from "playwright";
import type { Config, SourceConfig } from "../config/schema.js";
import { detectAuthState } from "../telegram/auth.js";
import { openBrowser } from "../telegram/browser.js";
import { openChat } from "../telegram/chat.js";
import { listDialogs } from "../telegram/dialogs.js";
import { log } from "../utils/logger.js";
import { mapPool } from "../utils/pool.js";

/** Selects enabled sources, optionally narrowed to one username. */
export function pickSources(config: Config, only?: string): SourceConfig[] {
  const name = only?.replace(/^@/, "").toLowerCase();
  const sources = config.sources.filter((s) => s.enabled && (!name || s.username.toLowerCase() === name));
  if (sources.length === 0) throw new Error("В конфиге нет подходящих источников.");
  return sources;
}

/**
 * Opens each source's chat in one of `parallelSources` tabs and runs `fn` on it.
 * A failure in one source is logged and does not stop the others.
 */
export async function forEachSourceChat(
  config: Config,
  sources: SourceConfig[],
  fn: (page: Page, source: SourceConfig, peerId: number) => Promise<void>,
): Promise<void> {
  const browser = await openBrowser(config);
  try {
    const first = await browser.newPage();
    if ((await detectAuthState(first)) !== "logged_in") {
      throw new Error("Вход не выполнен. Сначала войдите: npm run dev → «Войти в Telegram»");
    }
    const peerIds = new Map((await listDialogs(first)).map((d) => [d.username?.toLowerCase(), d.peerId]));
    const tabs = Math.min(config.scrape.parallelSources, sources.length);
    const free = [first, ...(await Promise.all(Array.from({ length: tabs - 1 }, () => browser.newPage())))];

    await mapPool(sources, tabs, async (source) => {
      const page = free.pop()!;
      try {
        const peerId = peerIds.get(source.username.toLowerCase());
        if (peerId === undefined) throw new Error("нет среди ваших чатов — подпишитесь на канал или запустите бота");
        await openChat(page, source.username, peerId);
        await fn(page, source, peerId);
      } catch (e) {
        log.error(`@${source.username}: ${(e as Error).message}`);
      } finally {
        free.push(page);
      }
    });
  } finally {
    await browser.close();
  }
}
