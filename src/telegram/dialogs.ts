import type { Page } from "playwright";
import type { SourceType } from "../config/schema.js";
import { SEL } from "./selectors.js";

export type Dialog = {
  peerId: number;
  type: SourceType | "user";
  username: string | null;
  title: string;
};

/**
 * Reads the dialog list from Telegram Web K's IndexedDB cache (`tweb-account-N`: dialogs/users/chats).
 * The DOM sidebar has no usernames or bot flags, the cache has both.
 */
export async function listDialogs(page: Page): Promise<Dialog[]> {
  await page.locator(SEL.chatList).first().waitFor();
  return page.evaluate(async () => {
    type Obj = Record<string, any>;
    const openDb = (name: string) =>
      new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const getAll = (db: IDBDatabase, store: string) =>
      new Promise<Obj[]>((res) => {
        if (!db.objectStoreNames.contains(store)) return res([]);
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result as Obj[]);
        r.onerror = () => res([]);
      });
    const username = (p: Obj | undefined): string | null =>
      p?.username ?? p?.usernames?.find((u: Obj) => u.pFlags?.active)?.username ?? p?.usernames?.[0]?.username ?? null;

    const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("tweb-account-"));
    for (const name of names) {
      const db = await openDb(name);
      const [dialogs, users, chats] = await Promise.all([getAll(db, "dialogs"), getAll(db, "users"), getAll(db, "chats")]);
      db.close();
      if (dialogs.length === 0) continue;
      const userById = new Map(users.map((u) => [Number(u.id), u]));
      const chatById = new Map(chats.map((c) => [Number(c.id), c]));
      return dialogs.map((d) => {
        const peerId = Number(d.peerId);
        if (peerId > 0) {
          const u = userById.get(peerId);
          return {
            peerId,
            type: u?.pFlags?.bot ? ("bot" as const) : ("user" as const),
            username: username(u),
            title: [u?.first_name, u?.last_name].filter(Boolean).join(" "),
          };
        }
        const c = chatById.get(-peerId);
        return {
          peerId,
          type: c?.pFlags?.broadcast ? ("channel" as const) : ("group" as const),
          username: username(c),
          title: c?.title ?? "",
        };
      });
    }
    return [];
  });
}
