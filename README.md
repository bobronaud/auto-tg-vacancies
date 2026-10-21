# auto-tg-vacancies

CLI that collects job vacancies from Telegram channels and bots through your own Telegram account,
filters them against your profile using an LLM, and stores them in a local SQLite database —
with contacts extracted (email, recruiter's Telegram, bot mini app) to prepare for auto-applying later.

> **Status:** early development. Login, source discovery and message sampling work;
> scraping + LLM classification are next (see [Roadmap](#roadmap)).

## How it works

```
 Telegram Web (web.telegram.org/k)  ──Playwright──▶  messages ──▶ SQLite (.data/vacancies.db)
   your logged-in session                                              │
   (.data/browser-profile)                                             ▼
                                                    Claude API: is it a vacancy? does it match
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
   message seen on the previous run) and extracts text, links and inline buttons. Bots are driven by a
   scripted list of steps (send a command, press a button N times).
4. **Classify.** Each new message is sent to the Claude API together with your profile; a schema-validated
   answer says whether it's a vacancy, how relevant it is, and what the contacts are.
   Duplicates posted in several channels are linked by a fingerprint.
5. **Review.** `vacancies list` shows matches; statuses (`new/matched/rejected/applied/ignored`) are tracked
   for the future auto-apply feature.

## Requirements

- Node.js **22+** and npm
- [gitleaks](https://github.com/gitleaks/gitleaks#installing) — required by the pre-commit hook
- An Anthropic API key (or `ant auth login`)
- A display for the QR login window. On WSL2 this works through WSLg (Windows 11).

## Quick start

```bash
git clone <this repo> && cd auto-tg-vacancies
npm ci                              # also installs the pre-commit hook
npx playwright install chromium

cp .env.example .env                # put ANTHROPIC_API_KEY here
cp config.example.yaml config.yaml  # describe what you are looking for in `profile`

npm run dev                         # interactive menu (the app UI is in Russian)
```

In the menu:

1. **Войти в Telegram (QR-код)** — a browser window opens; scan the code in the Telegram app:
   Settings → Devices → Link Desktop Device. If two-step verification is on, enter the password in that window.
2. **Выбрать источники из моих подписок** — tick the channels and bots that post vacancies.
3. **Выгрузить примеры сообщений из источников** — saves recent messages to `.data/samples/` to inspect formats.

Every menu item is also a plain command, handy for scripts:

```bash
npm run dev -- auth login
npm run dev -- sources discover
npm run dev -- sources sample --limit 50
```

Coming next: `scrape`, `reparse`, `vacancies list`.

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
| `config validate` | Validate `config.yaml` |
| `scrape`, `reparse`, `vacancies …` | Planned, see Roadmap |

Global options: `-c, --config <path>` (default `config.yaml`), `-v, --verbose`.

## Configuration

See [`config.example.yaml`](config.example.yaml) — every field is commented. Main sections:

- `profile` — what you are looking for (roles, free-text description, stack, grades, work format,
  locations, minimum salary, exclusions, `includeFreelance` for one-off orders). Passed to the LLM as-is.
- `sources` — channels/groups/bots; `hints` lets you describe a source's post format for the LLM;
  `bot.steps` scripts how to get vacancies out of a bot.
- `scrape` — `lookbackDays`, `parallelSources` (browser tabs working at once), `headless`.
- `llm` — `model` (default `claude-opus-5-5`; `claude-haiku-5-5` is much cheaper), `effort`,
  `minRelevance`, `concurrency`.
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
| API keys, SMTP password | `.env` | never |
| Your profile and subscriptions | `config.yaml` | never |

- **`.data/browser-profile` is equivalent to your Telegram password.** Anyone with a copy can read and
  write as you. It is created with `0700` permissions. If you think it leaked, terminate the session in
  Telegram → Settings → Devices.
- `.gitignore` excludes all of the above; a **pre-commit hook** additionally blocks them even after
  `git add -f` and runs `gitleaks` on staged changes. CI scans the whole history with gitleaks and runs
  `npm audit`.
- Logs redact phone numbers, API keys and bot tokens. Login happens only by QR code inside the browser
  window; the tool never asks for your phone number, login code or 2FA password.
- Message text is sent to the **Anthropic API** for classification. Don't use the tool on chats whose content
  you are not allowed to share with a third-party processor.
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
6. ⏳ Scraper: incremental history collection, bot scripts
7. LLM classification and extraction (`scrape`, `reparse`)
8. `vacancies list/show/set-status`, CSV/JSON export
9. Auto-apply: email, Telegram message to the recruiter, bot mini apps (dry-run by default)

## Development

```bash
npm run typecheck
npm test
npm run dev                # interactive menu (tsx, from sources)
npm run dev -- <command>   # a single command
```

Test fixtures must be synthetic — no real usernames, emails or phone numbers.
