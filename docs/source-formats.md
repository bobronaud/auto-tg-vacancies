# Source formats

How vacancies look in the sources analysed so far (October 2026, ~50 recent messages each), and what
this means for scraping and classification. Per-source notes for the LLM live in `config.yaml → sources[].hints`
(the personal config is not committed; the summaries below are the reference).

Examples here are paraphrased — no real recruiter contacts are copied into the repository.

## Summary

| Source | Type | Vacancy share (rough, by eye over the first 25 posts) | Where the contact is | Apply method |
|---|---|---|---|---|
| `@job_react` | channel | high | `Контакты:` line — email and/or @username; or an `Откликнуться` link | email / telegram / link |
| `@jsdevjob` | channel | ~50% | `Подробнее и откликнуться на …` link (Habr Career, hh.ru, getmatch) or @username | link / telegram |
| `@forfrontend` | channel | ~80% | link to the recruiter's LinkedIn post or the job board page | link |
| `@backend_frontend_jobs` | channel | ~70%, mixed specialities | title links to the vacancy page on an aggregator | link |
| `@job_webdev` | channel | ~40% vacancies, ~35% freelance orders | `Откликнуться` link (hh.ru, hirehi.ru); freelance → kwork.ru | link |
| `@runello_rus_frontend` | channel | ~100% | none in text; inline buttons open the Runello mini app | mini_app |
| `@g_jobbot` (getmatch) | bot | vacancy cards + weekly digests + application updates | callback button «Откликнуться в боте»; page on getmatch.ru | bot_button |
| `@RunelloBot` | bot | daily digests + application confirmations | mini app buttons per vacancy | mini_app |

## Message kinds

Classification returns one of these per message (`messages.kind`), plus zero or more vacancies:

- `vacancy` — a single job post.
- `digest` — several vacancies in one message (bot digests: «Топ-3 вакансии», «еженедельная подборка»).
  Each listed vacancy becomes its own row (`vacancies.position`).
- `freelance` — a one-off order («Что нужно сделать?», kwork.ru). Collected only with `profile.includeFreelance: true`.
- `application_update` — a bot reports on an application you already sent: «Ваш отклик успешно отправлен!»,
  «Пришёл ответ…», «вакансия ушла в архив», «отказ без комментария». Useful later to avoid duplicate
  applications and to track statuses.
- `other` — ads, courses, webinars, «N офферов получили наши ученики», digests of articles, service messages.

## Channels

### `@job_react`
hh.ru-style template:
```
#<grade> #<salary bucket> #<work format>

<Company>
<Position>
<salary line>, Опыт работы: …, Полная занятость, График: 5/2, Формат работы: …

 Чем предстоит заниматься / Наши пожелания / Будет плюсом …

Контакты: <email> [/ Telegram @<user>]      ← or a line "Откликнуться" with a link

React Job в Telegram | в VK | в Max          ← channel footer, not a contact
```
Non-vacancies: mentoring/course ads (sometimes posted twice in a row).

### `@jsdevjob`
```
<Position> — <Company>
<salary> | Зарплата не указана
<Удалённо | Офис (City) | Гибрид>, terms

<short description, requirements>

Подробнее и откликнуться на <Habr Career | hh.ru | …>   ← link
<links to sibling channels of the network>            ← not contacts
```
About half of the posts are ads (courses, webinars, conferences, «offers of our students»).

### `@forfrontend`
Short announcements in Russian or English: position, «в <Company> — <what it does>», format/city,
then «Ищет <recruiter>, её пост на LinkedIn» or a link to Ashby/Greenhouse/GeekJob. No salary or stack —
the LLM must not invent them. Non-vacancies: job-search course ads.

### `@backend_frontend_jobs`
Mixed specialities. First line is the position linked to an aggregator page (the apply target),
second line is format/location or salary, then ОБЯЗАННОСТИ / ТРЕБОВАНИЯ / УСЛОВИЯ blocks. The footer
contains invite links to sibling channels («Удалёнка», «Джунам», «C-Level», «За рубежом») — not contacts.
Many ads («заработок в нейросетях», crypto arbitrage).

### `@job_webdev`
Three post types:
1. vacancies with fields `Компания:`, `Регион:`, `Опыт работы: #grade`, `Формат работы: #format`,
   `Зарплата:` and an `Откликнуться` link;
2. freelance orders: «Что нужно сделать?», `Перейти к заявке` → kwork.ru, `#фриланс`;
3. other: weekly article digests, news, dubious side jobs («от 5000 ₽ в день»).

### `@runello_rus_frontend`
Short teaser: position, truncated company description ending with «…», «Откликнуться через Runello-бот ↓»,
hashtags `#frontend #office|#remote`. Two inline buttons open the Runello mini app:
`https://t.me/RunelloBot/runello?startapp=<base64 JSON>` where the JSON is
`{"order": <vacancy id>, "action": "show_vacancy" | "apply_vacancy"}`.

## Bots

Both bots **push** messages (cards, digests, statuses) on their own, so collecting = reading the chat
history; no `bot.steps` are needed for them at the moment.

### `@g_jobbot` (getmatch)
- Vacancy card: `<Position> [Remote] @ <Company>` (both linked to getmatch.ru), salary
  («от 3 000 €/мес на руки»), format, `Стек:`, `Уровень английского:`, `Что делать:`, `О компании:`.
  Buttons: callback «Откликнуться в боте» with data `application__send__<vacancy id>`, url «Описание»,
  url «Вакансии (N)».
- Weekly digest: «Собрали еженедельную подборку…», several `<Position> @ <Company>` + salary + format.
- Application updates: response received, rejection, vacancy archived.
- Service messages: profile, surveys, salary stats.

### `@RunelloBot`
- Application confirmations: «Ваш отклик успешно отправлен!», `Вакансия:`, `Компания:`, `Соответствие: N%`,
  button «Открыть карточку вакансии» (mini app, `{"action": "vacancy", "id": …}`).
- Daily digest: «Топ-3 вакансии» — position, company, salary, skills; one mini-app button per vacancy
  (`{"order": …, "action": "show_vacancy", "src": "digest"}`) and «Все рекомендации (N)».
- Subscription / demo-access messages.

### Applying through bots (observed on real applications, October 2026)

**getmatch.** Pressing «Откликнуться в боте» either applies right away or, when the employer requires a
cover letter, answers «Для отклика на эту вакансию нужно сопроводительное письмо» with a web_app button
«Откликнуться на вакансию». That opens `candidate-onboarding-tma.getmatch.tech/?flow=cover-letter-application…`;
the recruiter's questions are in the `cover_letter_placeholder` URL parameter. The form is one textarea
(up to 4500 characters) and «Отправить отклик». Submitting takes a few seconds (spinner) — closing the browser
early can abort it. After a successful submission the bot posts nothing; reopening the form shows
«Вы уже откликнулись на эту вакансию».

**Runello.** Two startapp actions matter: `show_vacancy` only shows the card (with «Откликнуться» at the bottom),
while `apply_vacancy` **applies as soon as it is opened**, without any extra click. The scraper therefore always
opens `show_vacancy` and presses the in-app button. An applied card shows «Резюме отправлено, ждём ответ
работодателя» and «Переписка (N)»; the bot does not always post «Ваш отклик успешно отправлен!».

## Implications

- **Contacts are mostly links, not emails.** Only `@job_react` regularly gives emails. The extractor keeps
  every link with its anchor text and every inline button with its type, URL and callback data.
- **Footers are noise.** Every channel appends links to itself or sibling channels; the LLM is told
  which links are not contacts (via `hints`).
- **Apply methods for the future auto-apply:** `email`, `telegram` (DM a recruiter), `mini_app`
  (Runello: open `startapp` link), `bot_button` (getmatch: press the callback button), `link` (external site —
  manual).
- **Duplicates across channels** are common (the same company posts to several channels) — handled by
  fingerprinting.

## Telegram Web K notes (scraper internals)

- Hash navigation (`#@username`) is ignored after the app has started; chats are opened via K's own
  t.me link handler (`im(this)`), the same path as clicking a link in a message.
- When switching chats the previous one stays rendered for a moment — wait for `.chat.active` to contain
  the expected `data-peer-id`.
- Channel message ids in the DOM are `serverId + 2^32`; sponsored posts have negative ids and `.is-sponsored`.
- Inline buttons have no URL or callback data in the DOM; they are read from K's message store
  (`rootScope.managers.appMessagesManager.getMessageByPeer`).
- Older history loads only on a real scroll event; the list is virtualised (newer bubbles are removed while
  scrolling up), so messages are accumulated by id.
