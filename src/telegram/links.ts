import type { Button } from "../db/repo.js";

/** `t.me/<bot>/<app>?startapp=…` or `t.me/<bot>?startapp=…` opens a bot's mini app. */
const MINI_APP_LINK = /^https?:\/\/t\.me\/([A-Za-z0-9_]{4,32})(?:\/([A-Za-z0-9_]+))?\/?\?(?:.*&)?startapp(?:=([^&#]*))?/i;

export type MiniAppLink = { bot: string; app: string | null; startParam: string | null };

export function parseMiniAppLink(url: string): MiniAppLink | null {
  const m = MINI_APP_LINK.exec(url);
  if (!m) return null;
  return { bot: m[1]!, app: m[2] ?? null, startParam: m[3] ? decodeURIComponent(m[3]) : null };
}

/** Mini-app links in url buttons behave like web_app buttons. */
export function normalizeButton(b: Button): Button {
  return b.kind === "url" && b.url && parseMiniAppLink(b.url) ? { ...b, kind: "web_app" } : b;
}
