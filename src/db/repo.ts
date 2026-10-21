import type { DB } from "./index.js";
import type { SourceType } from "../config/schema.js";

export type Link = { url: string; text: string };
/** `text` is a reply-keyboard button (sends its label); `data` is the decoded callback payload. */
export type Button = { text: string; kind: "url" | "callback" | "web_app" | "text" | "other"; url?: string; data?: string };

export type ScrapedMessage = {
  tgMessageId: number;
  date: string | null;
  text: string;
  html: string;
  links: Link[];
  buttons: Button[];
};

export type StoredMessage = ScrapedMessage & { id: number; sourceId: number; sourceUsername: string };

export const VACANCY_STATUSES = ["new", "matched", "rejected", "applied", "ignored"] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];
export type ApplyMethod = "email" | "telegram" | "mini_app" | "bot_button" | "link" | "unknown";
export const MESSAGE_KINDS = ["vacancy", "digest", "freelance", "application_update", "other"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export type Salary = { min: number | null; max: number | null; currency: string | null; period: string | null };
export type Contacts = {
  emails: string[];
  telegramUsernames: string[];
  urls: string[];
  miniApp: { botUsername: string; startParam: string | null } | null;
};

export type NewVacancy = {
  messageId: number;
  fingerprint: string;
  title: string;
  company: string | null;
  grade: string | null;
  stack: string[];
  salary: Salary | null;
  workFormat: string | null;
  location: string | null;
  relevance: number;
  reason: string;
  contacts: Contacts;
  applyMethod: ApplyMethod;
  applyInstructions: string;
  status: VacancyStatus;
};

export type VacancyRow = NewVacancy & {
  id: number;
  duplicateOf: number | null;
  createdAt: string;
  sourceUsername: string;
  sourceType: SourceType;
  tgMessageId: number;
  buttons: Button[];
  messageDate: string | null;
  text: string;
};

export const APPLICATION_METHODS = ["email", "telegram", "bot_button", "mini_app", "manual"] as const;
export type ApplicationMethod = (typeof APPLICATION_METHODS)[number];
export type ApplicationStatus = "sent" | "dry_run" | "unconfirmed" | "failed";
export type NewApplication = {
  vacancyId: number;
  method: ApplicationMethod;
  status: ApplicationStatus;
  target: string;
  letter: string;
  detail: string;
};

export class Repo {
  constructor(private readonly db: DB) {}

  upsertSource(s: { type: SourceType; username: string; title: string }): number {
    const row = this.db
      .prepare(
        `INSERT INTO sources (type, username, title) VALUES (@type, @username, @title)
         ON CONFLICT(username) DO UPDATE SET type = excluded.type, title = excluded.title
         RETURNING id`,
      )
      .get(s) as { id: number };
    return row.id;
  }

  getSource(username: string) {
    return this.db
      .prepare(`SELECT id, last_message_id AS lastMessageId FROM sources WHERE username = ?`)
      .get(username) as { id: number; lastMessageId: number | null } | undefined;
  }

  markScraped(sourceId: number, lastMessageId: number | null): void {
    this.db
      .prepare(
        `UPDATE sources SET last_scraped_at = datetime('now'),
           last_message_id = max(coalesce(last_message_id, 0), coalesce(?, 0)) WHERE id = ?`,
      )
      .run(lastMessageId, sourceId);
  }

  /** Inserts messages, ignoring already stored ones. Returns number of new rows. */
  insertMessages(sourceId: number, messages: ScrapedMessage[]): number {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO messages (source_id, tg_message_id, date, text, html, links_json, buttons_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    return this.db.transaction(() =>
      messages.reduce(
        (n, m) =>
          n +
          stmt.run(sourceId, m.tgMessageId, m.date, m.text, m.html, JSON.stringify(m.links), JSON.stringify(m.buttons))
            .changes,
        0,
      ),
    )();
  }

  /** Messages not yet classified (or all of them when `all` is set), optionally for one source. */
  messagesToClassify(opts: { source?: string; all?: boolean }): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.source_id AS sourceId, s.username AS sourceUsername, m.tg_message_id AS tgMessageId,
                m.date, m.text, m.html, m.links_json, m.buttons_json
         FROM messages m JOIN sources s ON s.id = m.source_id
         WHERE (@all = 1 OR m.classified_at IS NULL) AND (@source IS NULL OR s.username = @source)
         ORDER BY m.id`,
      )
      .all({ all: opts.all ? 1 : 0, source: opts.source ?? null }) as (Omit<StoredMessage, "links" | "buttons"> & {
      links_json: string;
      buttons_json: string;
    })[];
    return rows.map(({ links_json, buttons_json, ...r }) => ({
      ...r,
      links: JSON.parse(links_json) as Link[],
      buttons: JSON.parse(buttons_json) as Button[],
    }));
  }

  /**
   * Stores the classification of a message: its kind and the vacancies found in it (several for digests).
   * Replaces earlier results (re-parse). Each vacancy is linked to an earlier one with the same fingerprint.
   */
  saveClassification(messageId: number, kind: MessageKind, vacancies: Omit<NewVacancy, "messageId">[]): number[] {
    const insert = this.db.prepare(
      `INSERT INTO vacancies (message_id, position, fingerprint, duplicate_of, title, company, grade, stack_json,
         salary_json, work_format, location, relevance, reason, contacts_json, apply_method, apply_instructions, status)
       VALUES (@messageId, @position, @fingerprint, @duplicateOf, @title, @company, @grade, @stack, @salary,
         @workFormat, @location, @relevance, @reason, @contacts, @applyMethod, @applyInstructions, @status)
       RETURNING id`,
    );
    const findOriginal = this.db.prepare(
      `SELECT id FROM vacancies WHERE fingerprint = ? AND duplicate_of IS NULL ORDER BY id LIMIT 1`,
    );
    return this.db.transaction(() => {
      this.db.prepare(`DELETE FROM vacancies WHERE message_id = ?`).run(messageId);
      this.db
        .prepare(`UPDATE messages SET kind = ?, classified_at = datetime('now') WHERE id = ?`)
        .run(kind, messageId);
      return vacancies.map((v, position) => {
        const original = findOriginal.get(v.fingerprint) as { id: number } | undefined;
        const row = insert.get({
          ...v,
          messageId,
          position,
          duplicateOf: original?.id ?? null,
          stack: JSON.stringify(v.stack),
          salary: v.salary ? JSON.stringify(v.salary) : null,
          contacts: JSON.stringify(v.contacts),
        }) as { id: number };
        return row.id;
      });
    })();
  }

  listVacancies(opts: { status?: VacancyStatus; includeDuplicates?: boolean; limit?: number }): VacancyRow[] {
    const rows = this.db
      .prepare(
        `${VACANCY_SELECT}
         WHERE (@status IS NULL OR v.status = @status) AND (@dups = 1 OR v.duplicate_of IS NULL)
         ORDER BY coalesce(m.date, v.created_at) DESC LIMIT @limit`,
      )
      .all({ status: opts.status ?? null, dups: opts.includeDuplicates ? 1 : 0, limit: opts.limit ?? -1 });
    return rows.map(toVacancy);
  }

  getVacancy(id: number): VacancyRow | undefined {
    const row = this.db.prepare(`${VACANCY_SELECT} WHERE v.id = ?`).get(id);
    return row ? toVacancy(row) : undefined;
  }

  /** Matched, non-duplicate vacancies without a sent (or unconfirmed) application, best first. */
  vacanciesToApply(limit = -1): VacancyRow[] {
    return this.db
      .prepare(
        `${VACANCY_SELECT}
         WHERE v.status = 'matched' AND v.duplicate_of IS NULL
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = v.id AND a.status IN ('sent', 'unconfirmed'))
         ORDER BY v.relevance DESC, coalesce(m.date, v.created_at) DESC LIMIT ?`,
      )
      .all(limit)
      .map(toVacancy);
  }

  /** Logs an application; a real (non-dry-run) success also marks the vacancy as applied. */
  recordApplication(a: NewApplication): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO applications (vacancy_id, method, status, target, letter, detail)
           VALUES (@vacancyId, @method, @status, @target, @letter, @detail)`,
        )
        .run(a);
      if (a.status === "sent" || a.status === "unconfirmed") this.setVacancyStatus(a.vacancyId, "applied");
    })();
  }

  setVacancyStatus(id: number, status: VacancyStatus): boolean {
    return this.db.prepare(`UPDATE vacancies SET status = ? WHERE id = ?`).run(status, id).changes > 0;
  }
}

const VACANCY_SELECT = `
  SELECT v.*, s.username AS source_username, s.type AS source_type, m.tg_message_id, m.date AS message_date, m.text,
         m.buttons_json
  FROM vacancies v JOIN messages m ON m.id = v.message_id JOIN sources s ON s.id = m.source_id`;

function toVacancy(r: unknown): VacancyRow {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as number,
    messageId: row.message_id as number,
    fingerprint: row.fingerprint as string,
    duplicateOf: (row.duplicate_of as number | null) ?? null,
    title: row.title as string,
    company: row.company as string | null,
    grade: row.grade as string | null,
    stack: JSON.parse(row.stack_json as string) as string[],
    salary: row.salary_json ? (JSON.parse(row.salary_json as string) as Salary) : null,
    workFormat: row.work_format as string | null,
    location: row.location as string | null,
    relevance: row.relevance as number,
    reason: row.reason as string,
    contacts: JSON.parse(row.contacts_json as string) as Contacts,
    applyMethod: row.apply_method as ApplyMethod,
    applyInstructions: row.apply_instructions as string,
    status: row.status as VacancyStatus,
    createdAt: row.created_at as string,
    sourceUsername: row.source_username as string,
    sourceType: row.source_type as SourceType,
    buttons: JSON.parse(row.buttons_json as string) as Button[],
    tgMessageId: row.tg_message_id as number,
    messageDate: row.message_date as string | null,
    text: row.text as string,
  };
}
