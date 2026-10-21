# Security

## Sensitive data handled by this project

| Data | Location | Committed? |
|---|---|---|
| Telegram session (browser profile: cookies, localStorage) | `.data/browser-profile/` | Never |
| Scraped messages, vacancies DB | `.data/*.db`, `.data/samples/` | Never |
| Anthropic API key, SMTP password | `.env` | Never |
| Personal config (profile, subscriptions) | `config.yaml` | Never |

Treat `.data/` like a password: anyone with a copy of `.data/browser-profile/` can use your Telegram account.
If you suspect it leaked, terminate the session in Telegram → Settings → Devices.

## Safeguards

- `.gitignore` excludes all of the above.
- A pre-commit hook runs `gitleaks` on staged changes and blocks forbidden paths even when added with `git add -f`.
- CI runs `gitleaks` over the full history and `npm audit`.
- Secrets are read only from environment variables; the config schema rejects secret-like keys.
- Message text from Telegram is untrusted input: it is sent to the LLM only as data, and the output is schema-validated.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Advisories → Report a vulnerability)
instead of a public issue.
