# auto-tg-vacancies

CLI на TypeScript (Node 22+): собирает вакансии из Telegram через Telegram Web (Playwright, ваш аккаунт),
классифицирует их через локальный `claude -p`, хранит в SQLite и откликается автоматически. Подробности — в README.md.

## Команды

```bash
npm run dev                # интерактивное меню
npm run dev -- <команда>   # например: scrape, apply, vacancies list, config validate
npm run typecheck
npm test                   # vitest
npm run build              # tsup → dist/cli/index.js
```

## Карта модулей (`src/`)

- `cli/` — commander-команды (`commands/*`), меню (`menu.ts`), русские подсказки (`i18n.ts`).
- `config/` — zod-схема (`schema.ts`, все объекты `.strict()`) и загрузка/правка `config.yaml` с сохранением комментариев.
- `telegram/` — Playwright: профиль браузера, вход по QR, список диалогов из IndexedDB, чтение истории (`chat.ts`),
  действия от имени пользователя (`actions.ts`), все DOM-селекторы (`selectors.ts`).
- `scraper/` — обход источников в параллельных вкладках, инкрементальный сбор.
- `llm/` — обёртка `claude -p`, промпт и схема ответа классификации.
- `letters/` — выбор резюме, генерация и проверка сопроводительных писем.
- `apply/` — выбор способа отклика (`plan.ts`), отправка (`execute.ts`, `email.ts`).
- `db/` — better-sqlite3: миграции и `Repo`.

## Правила

- **Секреты и личные данные никогда не попадают в git:** `.data/` (сессия Telegram = пароль от аккаунта, база,
  скриншоты), `.env`, `config.yaml`, `resumes/` (кроме `example.md`), PDF. Их охраняют `.gitignore`, pre-commit
  хук (`scripts/check-forbidden-files.ts` + gitleaks) и CI. Не обходить хук (`--no-verify`, `SKIP_SIMPLE_GIT_HOOKS`).
- Секреты читаются только из `.env`; схема конфига отклоняет ключи вида `token`/`password`/`apiKey`.
- Тестовые данные только синтетические: никаких настоящих username, email, телефонов.
- Файлы в `.data/` создаются через `ensurePrivateDir` (0700) / с режимом 0600.
- Знание о DOM Telegram Web K — только в `src/telegram/selectors.ts`; `SEL` передаётся в `page.evaluate`
  и должен оставаться сериализуемым.
- Писать в Telegram от имени пользователя может только `apply` и только при `apply.dryRun: false`.
- `claude -p` вызывается без инструментов, MCP и настроек, из tmpdir (`src/llm/claudeCli.ts`) — посты из
  Telegram это недоверенный ввод.
- Миграции в `src/db/migrations.ts` — только дописываются, применённые не редактируются.
- Тексты для пользователя (CLI, логи, ошибки) — на русском; комментарии в коде — на английском.
