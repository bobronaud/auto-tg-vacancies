import type { Frame, Page } from "playwright";
import { activeChatPeer, SEL } from "./selectors.js";

// Write actions on behalf of the user. Callers must have the user's confirmation before calling these.

const WAIT_MS = 20_000;

type K = { rootScope: { myId: number; managers: Record<string, any> }; appImManager: { setInnerPeer(o: object): void } };

/** Resolves @username to a peer id (users and bots positive, channels and groups negative). */
export async function resolvePeerId(page: Page, username: string): Promise<number> {
  const peer = await page.evaluate(async (u) => {
    const p = await (window as unknown as K).rootScope.managers.appUsersManager.resolveUsername(u);
    return p ? { kind: String(p._), id: Number(p.id) } : null;
  }, username.replace(/^@/, ""));
  if (!peer) throw new Error(`@${username} не найден в Telegram`);
  return peer.kind === "user" ? peer.id : -peer.id;
}

export async function myPeerId(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as K).rootScope.myId);
}

/** Opens a chat by peer id, optionally scrolled to a message (K's internal mid). */
export async function openPeer(page: Page, peerId: number, mid?: number): Promise<void> {
  await page.evaluate(
    ({ peerId, mid }) => (window as unknown as K).appImManager.setInnerPeer({ peerId, ...(mid ? { lastMsgId: mid } : {}) }),
    { peerId, mid },
  );
  await page.locator(activeChatPeer(peerId)).first().waitFor({ timeout: WAIT_MS });
}

/** Sends a text message — or a document with the text as caption — to the open chat. Returns the new message id. */
export async function sendToOpenChat(page: Page, text: string, file?: string | null): Promise<number> {
  const before = await page.locator(SEL.outgoingBubble).count();
  if (file) {
    await attachDocument(page, file);
    await page.locator(SEL.popupCaption).first().click();
    await page.keyboard.insertText(text);
    await page.locator(SEL.popupSend).first().click();
  } else {
    await page.locator(SEL.composer).first().click();
    await page.keyboard.insertText(text);
    await page.keyboard.press("Enter");
  }
  // A sent message gets an integer server id and loses the "sending" state.
  const handle = await page.waitForFunction(
    ({ sel, n }) => {
      const out = [...document.querySelectorAll<HTMLElement>(sel)];
      const last = out.at(-1);
      if (out.length <= n || !last) return null;
      const mid = Number(last.dataset.mid);
      return Number.isInteger(mid) && !last.classList.contains("is-sending") ? mid : null;
    },
    { sel: SEL.outgoingBubble, n: before },
    { timeout: 60_000 },
  );
  return (await handle.jsonValue()) as number;
}

/** K opens the file dialog with input.click(); intercept that input and feed it the file directly. */
async function attachDocument(page: Page, file: string): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __tgvFileInput?: HTMLInputElement; __tgvPatched?: boolean };
    w.__tgvFileInput = undefined;
    if (w.__tgvPatched) return;
    w.__tgvPatched = true;
    const original = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      if (this.type === "file") {
        w.__tgvFileInput = this;
        return;
      }
      return original.call(this);
    };
  });
  // The item's text also carries the icon glyph, so match a substring.
  const item = page.locator(SEL.menuItem, { hasText: "Document" }).first();
  const toggle = page.locator(SEL.attachButton).first();
  for (let i = 0; i < 3 && !(await item.isVisible()); i++) {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await item.waitFor({ timeout: 1500 }).catch(() => undefined);
  }
  await item.click();
  const input = await page.waitForFunction(() => (window as unknown as { __tgvFileInput?: HTMLInputElement }).__tgvFileInput);
  await input.asElement()!.setInputFiles(file);
  await page.locator(SEL.popupCaption).first().waitFor({ timeout: WAIT_MS });
}

/**
 * Presses an inline button under a message in the open chat and returns what the bot answered
 * (a new incoming message or the edited message itself).
 */
export async function pressInlineButton(page: Page, mid: number, label: RegExp): Promise<string> {
  const bubble = page.locator(`.chat.active .bubble[data-mid="${mid}"]`);
  await bubble.waitFor({ timeout: WAIT_MS });
  const button = bubble.locator(SEL.inlineButton, { hasText: label }).first();
  if (!(await button.count())) throw new Error(`под сообщением нет кнопки ${label}`);
  const snapshot = async () =>
    page.evaluate(
      ({ mid }) => ({
        lastIn: [...document.querySelectorAll<HTMLElement>(".chat.active .bubble.is-in[data-mid]")].at(-1)?.dataset.mid ?? "",
        own: document.querySelector(`.chat.active .bubble[data-mid="${mid}"]`)?.textContent ?? "",
      }),
      { mid },
    );
  const before = await snapshot();
  await button.click();
  // A popup alert from the bot (answerCallbackQuery with show_alert) also counts as an answer.
  const answer = await page
    .waitForFunction(
      ({ mid, before }) => {
        const alert = document.querySelector(".popup.active, .toast")?.textContent?.trim();
        if (alert) return alert;
        const ins = [...document.querySelectorAll<HTMLElement>(".chat.active .bubble.is-in[data-mid]")];
        const last = ins.at(-1);
        if (last && last.dataset.mid !== before.lastIn) return last.querySelector(".message")?.textContent?.trim() ?? "";
        const own = document.querySelector(`.chat.active .bubble[data-mid="${mid}"]`)?.textContent ?? "";
        return own !== before.own ? own.trim() : null;
      },
      { mid, before },
      { timeout: WAIT_MS },
    )
    .then((h) => h.jsonValue() as Promise<string>)
    .catch(() => "");
  return answer;
}

/** Opens a bot's mini app by its t.me link, confirms the launch dialog and returns the app's frame. */
export async function openMiniApp(page: Page, link: string, appHost?: RegExp): Promise<Frame> {
  await page.evaluate((href) => {
    const a = document.createElement("a");
    a.href = href;
    a.setAttribute("onclick", "im(this)");
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, link);
  const launch = page.locator(SEL.popupButton, { hasText: /^(Launch|Open|Открыть|Запустить)$/ }).first();
  if (await launch.waitFor({ timeout: 5000 }).then(() => true, () => false)) await launch.click();
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f !== page.mainFrame() && (appHost ? appHost.test(f.url()) : /^https:/.test(f.url())));
    if (frame) {
      await frame.waitForLoadState("domcontentloaded");
      return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("мини-апп не открылся");
}
