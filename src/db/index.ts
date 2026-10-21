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
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
