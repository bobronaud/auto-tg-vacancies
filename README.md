# auto-tg-vacancies

CLI that collects job vacancies from Telegram channels and bots through your own Telegram account,
filters them against your profile using an LLM, and stores them in a local SQLite database —
with contacts extracted (email, recruiter's Telegram, bot mini app) to prepare for auto-applying later.

> **Status:** collecting and classifying vacancies works; auto-apply is next (see [Roadmap](#roadmap)).

## How it works

```
 Telegram Web (web.telegram.org/k)  ──Playwright──▶  messages ──▶ SQLite (.data/vacancies.db)
   your logged-in session                                              │
   (.data/browser-profile)                                             ▼
                                                    claude -p: is it a vacancy? does it match
                                                    my profile? extract title, stack, salary,
                                                    contacts, how to apply
                                                                       │
                                                                       ▼
                                                     vacancies table ──▶ `vacancies list`
```

1. **Auth.** A Chromium profile is kept in `.data/browser-profile`. You log in once by QR code,
   then every command reuses the session.
2. **Sources.** `sources discover` reads your dialog list from Telegram Web's local cache and lets you pick
   channels and bots; they are saved into `config.yaml`.
3. **Collect.** For each source the browser opens the chat, scrolls back to `lookbackDays` (or to the last
   message seen on the previous run) and extracts text, links and inline buttons (with their URLs and
   callback data). The supported bots push vacancies on their own, so reading their chat is enough.
4. **Classify.** New messages go in batches of 10 to the locally installed `claude -p` (your Claude Code
   subscription, no API key) together with your profile and per-source format notes. The schema-validated
   answer says what each message is (vacancy, digest of several vacancies, freelance order, application
   status, other), how relevant each vacancy is, and how to apply. Duplicates posted in several channels are
   linked by a fingerprint.
5. **Review.** `vacancies list` shows matches; statuses (`new/matched/rejected/applied/ignored`) are tracked
   for the future auto-apply feature.

## Requirements

- Node.js **22+** and npm
- [gitleaks](https://github.com/gitleaks/gitleaks#installing) — required by the pre-commit hook
- [Claude Code](https://claude.com/claude-code) installed and logged in (`claude` on PATH) — classification
  runs through `claude -p` on your subscription; no API key is needed
- A display for the QR login window. On WSL2 this works through WSLg (Windows 11).

## Quick start

```bash
git clone <this repo> && cd auto-tg-vacancies
npm ci                              # also installs the pre-commit hook
npx playwright install chromium

cp config.example.yaml config.yaml  # describe what you are looking for in `profile`

npm run dev                         # interactive menu (the app UI is in Russian)
```

In the menu:

1. **Войти в Telegram (QR-код)** — a browser window opens; scan the code in the Telegram app:
   Settings → Devices → Link Desktop Device. If two-step verification is on, enter the password in that window.
2. **Выбрать источники из моих подписок** — tick the channels and bots that post vacancies.
3. **Собрать вакансии** — reads new messages from all sources and classifies them with Claude.
4. **Показать подходящие вакансии** — the table of matches; details with `vacancies show <id>`.

Every menu item is also a plain command, handy for scripts:

```bash
npm run dev -- auth login
npm run dev -- sources discover
npm run dev -- scrape
npm run dev -- vacancies list
```

Build a standalone binary with `npm run build` → `node dist/cli/index.js` (exposed as `tgv`).

## Commands

`npm run dev` without arguments opens the interactive menu. `npm run dev -- <command>` runs a command directly:

| Command | What it does |
|---|---|
| `auth login` | Log in by QR code in a browser window |
| `auth status` | Check whether the stored session is valid |
| `auth logout [-y]` | Delete the local session (also terminate it in Telegram → Settings → Devices) |
| `sources discover [--all-types]` | Choose channels/bots (and groups with `--all-types`) from your dialogs, add to config |
| `sources list` | Show configured sources |
| `sources sample [-s user] [-l 50]` | Save recent messages per source to `.data/samples/<username>.json` |
| `scrape [-s user] [--since 7d] [--no-llm]` | Collect new messages (first run: `lookbackDays`) and classify them |
| `reparse [-s user] [--pending]` | Classify stored messages again, e.g. after changing `profile` |
| `vacancies list [--status …] [--all] [--duplicates] [-n 50] [-f table/json/csv]` | List vacancies (default: matched) |
| `vacancies show <id>` | Details, contacts and the original post |
| `vacancies set-status <id> <status>` | `new`, `matched`, `rejected`, `applied`, `ignored` |
| `config validate` | Validate `config.yaml` |

Global options: `-c, --config <path>` (default `config.yaml`), `-v, --verbose`.

## Configuration

See [`config.example.yaml`](config.example.yaml) — every field is commented. Main sections:

- `profile` — what you are looking for (roles, free-text description, stack, grades, work format,
  locations, minimum salary, exclusions, `includeFreelance` for one-off orders). Passed to the LLM as-is.
- `sources` — channels/groups/bots; `hints` lets you describe a source's post format for the LLM;
  `bot.steps` is reserved for bots that only answer commands (not needed for the current ones).
- `scrape` — `lookbackDays`, `parallelSources` (browser tabs working at once), `headless`.
- `llm` — `model` for `claude -p` (`sonnet` by default; `haiku` uses less of the subscription), `effort`,
  `minRelevance` (threshold for `matched`), `batchSize` (messages per call), `concurrency`, `timeoutSec`.
- `storage`, `browser` — paths (keep them under `.data/`).
- `apply` — reserved for auto-apply; `dryRun: true` by default.

Secrets are **never** read from the config: keys like `apiKey`, `token`, `password` are rejected.
Put them in `.env`.

## Security and privacy

This repository is public; your data must never end up in it.

| Sensitive data | Where it lives | In git? |
|---|---|---|
| Telegram session (cookies, localStorage) | `.data/browser-profile/` | never |
| Collected messages, vacancies, samples | `.data/` | never |
| Future secrets (SMTP password) | `.env` | never |
| Your profile and subscriptions | `config.yaml` | never |

- **`.data/browser-profile` is equivalent to your Telegram password.** Anyone with a copy can read and
  write as you. It is created with `0700` permissions. If you think it leaked, terminate the session in
  Telegram → Settings → Devices.
- `.gitignore` excludes all of the above; a **pre-commit hook** additionally blocks them even after
  `git add -f` and runs `gitleaks` on staged changes. CI scans the whole history with gitleaks and runs
  `npm audit`.
- Logs redact phone numbers, API keys and bot tokens. Login happens only by QR code inside the browser
  window; the tool never asks for your phone number, login code or 2FA password.
- Message text is sent to Anthropic through your **Claude Code** subscription (`claude -p`) for
  classification. Don't use the tool on chats whose content you are not allowed to share with a third-party
  processor.
- `claude -p` runs with **no tools, no MCP servers, no settings/hooks and its own system prompt**, from a
  temp directory (so no CLAUDE.md is picked up): the model reading untrusted posts can't act on anything.
- Telegram messages are treated as **untrusted input**: the LLM is told they are data, not instructions;
  its output is validated against a schema; links from posts are never opened automatically.
- Automating a user account may violate Telegram's Terms of Service and can get the account limited.
  The tool deliberately has no throttling — use it at your own risk.

If you fork this repo, enable GitHub **Secret scanning + Push protection** and **Dependabot alerts**
(Settings → Code security). Vulnerabilities: see [SECURITY.md](SECURITY.md).

## Project structure

```
src/
  cli/            commander entry point and commands
  config/         zod schema + loader (rejects secret-like keys)
  telegram/       Playwright: browser profile, auth, dialog discovery, chat history, selectors
  scraper/        runs sources in parallel tabs, incremental collection
  llm/            claude -p wrapper, prompt, response schema, batch classification
  db/             SQLite (better-sqlite3): migrations + repository
  apply/          interface for future auto-apply implementations
  utils/          logger with redaction, paths, concurrency pool
scripts/          pre-commit guard for forbidden files
test/             vitest (synthetic data only)
```

All Telegram Web DOM selectors are in `src/telegram/selectors.ts` — the first place to fix when the
web client changes.

## Roadmap

1. ✅ Project skeleton, security baseline
2. ✅ Config + SQLite
3. ✅ Telegram Web login / status / logout
4. ✅ Source discovery and message sampling
5. ✅ Analyse post formats of the selected channels and bots — see [docs/source-formats.md](docs/source-formats.md)
6. ✅ Scraper: incremental history collection
7. ✅ LLM classification and extraction through `claude -p` (`scrape`, `reparse`)
8. ✅ `vacancies list/show/set-status`, CSV/JSON export
9. ⏳ Auto-apply: email, Telegram message to the recruiter, bot mini apps (dry-run by default)

## Development

```bash
npm run typecheck
npm test
npm run dev                # interactive menu (tsx, from sources)
npm run dev -- <command>   # a single command
```

Test fixtures must be synthetic — no real usernames, emails or phone numbers.
