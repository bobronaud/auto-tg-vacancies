import { chmodSync } from "node:fs";
import Database from "better-sqlite3";
import { ensureParentDir } from "../utils/paths.js";
import { MIGRATIONS } from "./migrations.js";

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path === ":memory:") return init(new Database(path));
  const full = ensureParentDir(path);
  const db = new Database(full);
  chmodSync(full, 0o600);
  return init(db);
}

function init(db: DB): DB {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= MIGRATIONS.length) return;
  // Table rebuilds (the only way to change a CHECK in SQLite) need foreign keys off; the pragma is a no-op
  // inside a transaction, so it is switched around the loop and the result is verified before re-enabling.
  db.pragma("foreign_keys = OFF");
  try {
    for (let v = current; v < MIGRATIONS.length; v++) {
      db.transaction(() => {
        db.exec(MIGRATIONS[v]!);
        const broken = db.pragma("foreign_key_check") as unknown[];
        if (broken.length > 0) throw new Error(`migration ${v + 1} broke foreign keys: ${JSON.stringify(broken[0])}`);
        db.pragma(`user_version = ${v + 1}`);
      })();
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
