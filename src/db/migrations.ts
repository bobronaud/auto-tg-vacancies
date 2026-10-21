// Append-only list: never edit an applied migration, add a new one.
export const MIGRATIONS: string[] = [
  /* sql */ `
CREATE TABLE sources (
  id              INTEGER PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('channel', 'group', 'bot')),
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title           TEXT NOT NULL DEFAULT '',
  last_message_id INTEGER,
  last_scraped_at TEXT
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  tg_message_id INTEGER NOT NULL,
  date          TEXT,
  text          TEXT NOT NULL DEFAULT '',
  html          TEXT NOT NULL DEFAULT '',
  links_json    TEXT NOT NULL DEFAULT '[]',
  buttons_json  TEXT NOT NULL DEFAULT '[]',
  scraped_at    TEXT NOT NULL DEFAULT (datetime('now')),
  classified_at TEXT,
  kind          TEXT CHECK (kind IN ('vacancy', 'digest', 'freelance', 'application_update', 'other')),
  UNIQUE (source_id, tg_message_id)
);

CREATE TABLE vacancies (
  id                 INTEGER PRIMARY KEY,
  message_id         INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL DEFAULT 0, -- digests list several vacancies in one message
  fingerprint        TEXT NOT NULL,
  duplicate_of       INTEGER REFERENCES vacancies(id),
  title              TEXT NOT NULL,
  company            TEXT,
  grade              TEXT,
  stack_json         TEXT NOT NULL DEFAULT '[]',
  salary_json        TEXT,
  work_format        TEXT,
  location           TEXT,
  relevance          REAL NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  contacts_json      TEXT NOT NULL DEFAULT '{}',
  apply_method       TEXT NOT NULL CHECK (apply_method IN ('email', 'telegram', 'mini_app', 'link', 'unknown')),
  apply_instructions TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'matched', 'rejected', 'applied', 'ignored')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (message_id, position)
);
CREATE INDEX vacancies_fingerprint ON vacancies(fingerprint);
CREATE INDEX vacancies_status ON vacancies(status);

CREATE TABLE applications (
  id           INTEGER PRIMARY KEY,
  vacancy_id   INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  method       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dry_run')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  sent_at      TEXT,
  error        TEXT
);
`,
  /* sql */ `
-- Applications log for auto-apply. The table was never written to before this version.
DROP TABLE applications;
CREATE TABLE applications (
  id         INTEGER PRIMARY KEY,
  vacancy_id INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  method     TEXT NOT NULL CHECK (method IN ('email', 'telegram', 'bot_button', 'mini_app', 'manual')),
  status     TEXT NOT NULL CHECK (status IN ('sent', 'dry_run', 'unconfirmed', 'failed')),
  target     TEXT NOT NULL DEFAULT '', -- email address, @username, bot or mini app
  letter     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '', -- confirmation text, error or screenshot path
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX applications_vacancy ON applications(vacancy_id);
`,
];
