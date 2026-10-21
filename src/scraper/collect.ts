import type { Config, SourceConfig } from "../config/schema.js";
import type { Repo } from "../db/repo.js";
import { collectHistory } from "../telegram/chat.js";
import { log } from "../utils/logger.js";
import { forEachSourceChat } from "./sources.js";

export type CollectStats = { sources: number; newMessages: number };

/**
 * Collects new messages into the DB. On the first run a source is read back `lookbackDays`
 * (or `since`); afterwards only messages newer than the last one seen.
 */
export async function collectMessages(
  repo: Repo,
  config: Config,
  sources: SourceConfig[],
  opts: { since?: Date } = {},
): Promise<CollectStats> {
  const stats: CollectStats = { sources: 0, newMessages: 0 };
  const defaultSince = new Date(Date.now() - config.scrape.lookbackDays * 24 * 3600 * 1000);

  await forEachSourceChat(config, sources, async (page, source, peerId) => {
    const sourceId = repo.upsertSource({ type: source.type, username: source.username, title: source.title });
    const last = opts.since ? null : (repo.getSource(source.username)?.lastMessageId ?? null);
    const messages = await collectHistory(page, peerId, {
      since: opts.since ?? defaultSince,
      afterMessageId: last,
      incomingOnly: source.type === "bot", // skip our own /start and button presses
    });
    const added = repo.insertMessages(sourceId, messages);
    repo.markScraped(sourceId, messages.length ? Math.max(...messages.map((m) => m.tgMessageId)) : null);
    stats.sources++;
    stats.newMessages += added;
    log.success(`@${source.username}: новых сообщений ${added}`);
  });
  return stats;
}
