import { join } from "node:path";
import type { Page } from "playwright";
import type { Config } from "../config/schema.js";
import type { ApplicationStatus, VacancyRow } from "../db/repo.js";
import { launchWebAppButton, openMiniApp, openPeer, pressInlineButton, resolvePeerId, sendToOpenChat } from "../telegram/actions.js";
import { extractVisible } from "../telegram/chat.js";
import { DATA_DIR, ensurePrivateDir } from "../utils/paths.js";
import { emailSubject, sendEmail } from "./email.js";
import { describePlan, type ApplyPlan } from "./plan.js";

export type ApplyOutcome = { status: ApplicationStatus; target: string; detail: string };

/** The bot asked for a cover letter in its form before it accepts the application (getmatch). */
export type CoverLetterForm = { bot: string; messageId: number; buttonText: string; questions: string };
export type BotOutcome = ApplyOutcome | { status: "needs_letter"; target: string; detail: string; form: CoverLetterForm };

const FORM_SENT = /отклик\S*\s+(?:успешно\s+)?отправлен|спасибо|успешно|отправили/i;

const BOT_SUCCESS = /отклик\S*\s+(?:успешно\s+)?(?:отправлен|принят|доставлен)|вы\s+откликнулись|откликнулись|резюме\s+отправлено/i;
// Runello shows «Резюме отправлено, ждём ответ работодателя» on the vacancy card once applied.
const APP_SUCCESS = /отклик\S*\s+(?:успешно\s+)?(?:отправлен|принят)|вы\s+откликнулись|заявка\s+отправлена|резюме\s+отправлено/i;
const APP_BLOCKED = /подписк|оплат|неограниченн|демо[- ]доступ|лимит/i;

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
      const frame = await openMiniApp(page, plan.link);
      const apply = frame.getByRole("button", { name: /^\s*откликнуться\s*$/i }).or(frame.getByText(/^\s*откликнуться\s*$/i)).first();
      const applied = frame.getByText(APP_SUCCESS).first();
      await apply.or(applied).waitFor({ timeout: 20_000 });
      if (await applied.isVisible()) {
        const text = (await applied.textContent())?.trim() ?? "";
        return { status: "sent", target, detail: `уже откликнулись раньше: ${text}` };
      }
      const before = await frame.evaluate(() => document.body.innerText);
      await apply.click();
      const seen = await frame
        .waitForFunction(
          ({ before, ok, blocked }) => {
            const text = document.body.innerText;
            if (text === before) return null;
            return new RegExp(ok, "i").test(text) || new RegExp(blocked, "i").test(text) ? text : null;
          },
          { before, ok: APP_SUCCESS.source, blocked: APP_BLOCKED.source },
          { timeout: 20_000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
        .catch(async () => frame.evaluate(() => document.body.innerText));
      const shot = join(ensurePrivateDir(join(DATA_DIR, "screenshots")), `apply-${v.id}.png`);
      await page.screenshot({ path: shot });
      const status: ApplicationStatus = APP_SUCCESS.test(seen) ? "sent" : APP_BLOCKED.test(seen) ? "failed" : "unconfirmed";
      return { status, target, detail: `${seen.replace(/\s+/g, " ").slice(0, 300)} (скриншот: ${shot})` };
    }
  }
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
  await openPeer(page, await resolvePeerId(page, form.bot), form.messageId);
  const frame = await launchWebAppButton(page, form.messageId, form.buttonText);
  const textarea = frame.locator("textarea").first();
  await textarea.waitFor({ timeout: 20_000 });
  await textarea.fill(letter);
  const before = await frame.evaluate(() => document.body.innerText);
  await frame.getByRole("button", { name: /отправить отклик/i }).click();
  const seen = await frame
    .waitForFunction((before) => (document.body.innerText !== before ? document.body.innerText : null), before, { timeout: 20_000 })
    .then((h) => h.jsonValue() as Promise<string>)
    .catch(() => "");
  const shot = join(ensurePrivateDir(join(DATA_DIR, "screenshots")), `apply-${vacancyId}.png`);
  await page.screenshot({ path: shot }).catch(() => undefined);
  const status: ApplicationStatus = FORM_SENT.test(seen) ? "sent" : "unconfirmed";
  return { status, target, detail: `${seen.replace(/\s+/g, " ").slice(0, 300) || "форма не ответила"} (скриншот: ${shot})` };
}
