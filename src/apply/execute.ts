import { join } from "node:path";
import type { Page } from "playwright";
import type { Config } from "../config/schema.js";
import type { ApplicationStatus, VacancyRow } from "../db/repo.js";
import { openMiniApp, openPeer, pressInlineButton, resolvePeerId, sendToOpenChat } from "../telegram/actions.js";
import { DATA_DIR, ensurePrivateDir } from "../utils/paths.js";
import { emailSubject, sendEmail } from "./email.js";
import { describePlan, type ApplyPlan } from "./plan.js";

export type ApplyOutcome = { status: ApplicationStatus; target: string; detail: string };

const BOT_SUCCESS = /отклик\S*\s+(?:успешно\s+)?(?:отправлен|принят|доставлен)|вы\s+откликнулись|откликнулись|резюме\s+отправлено/i;
const APP_SUCCESS = /отклик\S*\s+(?:успешно\s+)?(?:отправлен|принят)|вы\s+откликнулись|заявка\s+отправлена/i;
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
): Promise<ApplyOutcome> {
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
      await openPeer(page, await resolvePeerId(page, plan.bot), plan.messageId);
      const answer = await pressInlineButton(page, plan.messageId, plan.label);
      return { status: BOT_SUCCESS.test(answer) ? "sent" : "unconfirmed", target, detail: answer || "бот ничего не ответил" };
    }
    case "mini_app": {
      const page = await getPage();
      const frame = await openMiniApp(page, plan.link);
      const apply = frame.getByRole("button", { name: /^\s*откликнуться\s*$/i }).or(frame.getByText(/^\s*откликнуться\s*$/i)).first();
      await apply.waitFor({ timeout: 20_000 });
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
