import { join } from "node:path";
import type { Page } from "playwright";
import type { Config } from "../config/schema.js";
import type { ApplicationStatus, VacancyRow } from "../db/repo.js";
import { closeMiniApps, launchWebAppButton, openMiniApp, openPeer, pressInlineButton, resolvePeerId, sendToOpenChat } from "../telegram/actions.js";
import { extractVisible } from "../telegram/chat.js";
import { DATA_DIR, ensurePrivateDir } from "../utils/paths.js";
import { emailSubject, sendEmail } from "./email.js";
import { describePlan, type ApplyPlan } from "./plan.js";

export type ApplyOutcome = { status: ApplicationStatus; target: string; detail: string };

/** The bot asked for a cover letter in its form before it accepts the application (getmatch). */
export type CoverLetterForm = { bot: string; messageId: number; buttonText: string; questions: string };
export type BotOutcome = ApplyOutcome | { status: "needs_letter"; target: string; detail: string; form: CoverLetterForm };


const BOT_SUCCESS = /отклик\S*\s+(?:успешно\s+)?(?:отправлен|принят|доставлен)|вы\s+откликнулись|откликнулись|резюме\s+отправлено/i;
// Runello shows «Резюме отправлено, ждём ответ работодателя» on the vacancy card once applied.
const APP_SUCCESS = /отклик\S*\s+(?:успешно\s+)?(?:отправлен|принят)|вы\s+откликнулись|заявка\s+отправлена|резюме\s+отправлено/i;

/**
 * Sends one application. `getPage` opens the browser lazily: email needs none.
 * A result counts as `sent` only with evidence; otherwise it is `unconfirmed` with what was seen.
 */
export async function executeApplication(
  config: Config,
  v: VacancyRow,
  plan: ApplyPlan,
  letter: string,
  pdf: string | null,
  getPage: () => Promise<Page>,
): Promise<BotOutcome> {
  const target = describePlan(plan);
  switch (plan.method) {
    case "email": {
      const detail = await sendEmail(config, { to: plan.to, subject: emailSubject(config, v), text: letter, pdf });
      return { status: "sent", target, detail };
    }
    case "telegram": {
      const page = await getPage();
      const peerId = await resolvePeerId(page, plan.username);
      if (peerId < 0) throw new Error(`@${plan.username} — канал или группа, а не человек`);
      await openPeer(page, peerId);
      const mid = await sendToOpenChat(page, letter, pdf);
      return { status: "sent", target, detail: `сообщение ${mid}` };
    }
    case "bot_button": {
      const page = await getPage();
      const peerId = await resolvePeerId(page, plan.bot);
      await openPeer(page, peerId, plan.messageId);
      const answer = await pressInlineButton(page, plan.messageId, plan.label);
      const form = await findCoverLetterForm(page, peerId, plan.bot);
      if (form) return { status: "needs_letter", target, detail: answer, form };
      return { status: BOT_SUCCESS.test(answer) ? "sent" : "unconfirmed", target, detail: answer || "бот ничего не ответил" };
    }
    case "mini_app": {
      const page = await getPage();
      try {
        return await applyInMiniApp(page, v, plan.link, target);
      } finally {
        await closeMiniApps(page).catch(() => undefined);
      }
    }
  }
}

/**
 * Runello's apply link opens the response page, whose «Откликнуться» (#submit_btn) posts the form; consent is
 * implied by that click. The vacancy card instead links to that page («Откликнуться» is an <a>). Some vacancies
 * (e.g. Sber) offer only an external form we cannot fill; a card with such a form says «Отклик отправлен»
 * regardless — Runello's reminder note, not an application — so it never counts as applied.
 */
async function applyInMiniApp(page: Page, v: VacancyRow, link: string, target: string): Promise<ApplyOutcome> {
  const frame = await openMiniApp(page, link);
  const toForm = frame.locator("a.btn-lg", { hasText: /^\s*откликнуться\s*$/i }).first();
  const submit = frame.locator("#submit_btn");
  const external = frame.getByText(/^\s*(?:открыть форму работодателя|откликнуться на сайте компании)\s*$/i).first();
  const applied = frame.getByText(APP_SUCCESS).first();
  await toForm.or(submit).or(external).or(applied).first().waitFor({ timeout: 30_000 });
  // Runello's own apply wins; the external form is only the last resort.
  if (!(await submit.isVisible()) && !(await toForm.isVisible())) {
    if (await external.isVisible()) {
      throw new Error("Runello: отклик только через форму на сайте работодателя — откликнитесь вручную");
    }
    const text = (await applied.textContent())?.trim() ?? "";
    return { status: "sent", target, detail: `уже откликнулись раньше: ${text}` };
  }
  if (await toForm.isVisible()) await toForm.click();
  await submit.waitFor({ timeout: 30_000 });
  const shot = join(ensurePrivateDir(join(DATA_DIR, "screenshots")), `apply-${v.id}.png`);
  if (await submit.isDisabled()) {
    await page.screenshot({ path: shot });
    const hint = (await frame.locator("#submit_btn_adapt_hint").textContent().catch(() => ""))?.trim();
    return { status: "failed", target, detail: `кнопка отправки неактивна${hint ? `: ${hint}` : ""} (скриншот: ${shot})` };
  }
  await submit.click();
  // A native form POST: the frame navigates to the result page. Locators survive the navigation.
  const confirmed = await applied.waitFor({ timeout: 45_000 }).then(
    () => true,
    () => false,
  );
  await page.screenshot({ path: shot });
  const seen = confirmed
    ? ((await applied.textContent())?.trim() ?? "")
    : await frame.evaluate(() => document.body.innerText).catch(() => "мини-апп не показал результата");
  return { status: confirmed ? "sent" : "unconfirmed", target, detail: `${seen.replace(/\s+/g, " ").slice(0, 300)} (скриншот: ${shot})` };
}

/** After pressing «Откликнуться», getmatch may answer with a web-app button leading to a cover-letter form. */
async function findCoverLetterForm(page: Page, peerId: number, bot: string): Promise<CoverLetterForm | null> {
  const last = (await extractVisible(page, peerId, { incomingOnly: true })).at(-1);
  const button = last?.buttons.find((b) => b.kind === "web_app" && b.url && /cover-letter|cover_letter/i.test(b.url));
  if (!last || !button?.url) return null;
  const questions = new URL(button.url).searchParams.get("cover_letter_placeholder") ?? "";
  return {
    bot,
    messageId: last.tgMessageId,
    buttonText: button.text,
    questions: questions.replace(/\\\)/g, ")").replace(/&#x20;/g, " ").trim(),
  };
}

/** Opens the bot's cover-letter form, pastes the letter and submits it. */
export async function submitCoverLetterForm(
  config: Config,
  vacancyId: number,
  form: CoverLetterForm,
  letter: string,
  getPage: () => Promise<Page>,
): Promise<ApplyOutcome> {
  const target = `форма отклика @${form.bot}`;
  const page = await getPage();
  const peerId = await resolvePeerId(page, form.bot);
  await openPeer(page, peerId, form.messageId);
  const lastBefore = (await extractVisible(page, peerId, { incomingOnly: true })).at(-1)?.tgMessageId ?? 0;
  const frame = await launchWebAppButton(page, form.messageId, form.buttonText);
  const textarea = frame.locator("textarea").first();
  const applied = frame.getByText(BOT_SUCCESS).first();
  await textarea.or(applied).waitFor({ timeout: 20_000 });
  if (await applied.isVisible()) {
    return { status: "sent", target, detail: `уже откликнулись: ${(await applied.textContent())?.trim() ?? ""}` };
  }
  await textarea.fill(letter);
  const submit = frame.getByRole("button", { name: /отправить отклик/i });
  await submit.click();

  // The request takes a while (the button shows a spinner). Wait until the form closes itself or the bot
  // posts a new message; closing the browser earlier can abort the submission.
  const deadline = Date.now() + 30_000;
  let reply = "";
  while (Date.now() < deadline) {
    const fresh = (await extractVisible(page, peerId, { incomingOnly: true })).filter((m) => m.tgMessageId > lastBefore);
    if (fresh.length > 0) {
      reply = fresh.map((m) => m.text).join("\n");
      break;
    }
    if (frame.isDetached()) break;
    await page.waitForTimeout(500);
  }
  const formText = frame.isDetached() ? "" : await frame.evaluate(() => document.body.innerText).catch(() => "");
  const shot = join(ensurePrivateDir(join(DATA_DIR, "screenshots")), `apply-${vacancyId}.png`);
  await page.screenshot({ path: shot }).catch(() => undefined);

  // getmatch may not post anything to the chat; the form itself then says «Вы уже откликнулись».
  const status: ApplicationStatus = BOT_SUCCESS.test(reply) || BOT_SUCCESS.test(formText) ? "sent" : "unconfirmed";
  const seen = reply || (frame.isDetached() ? "форма закрылась, бот ничего не написал" : formText.slice(-300));
  return { status, target, detail: `${seen.replace(/\s+/g, " ").slice(0, 300)} (скриншот: ${shot})` };
}
