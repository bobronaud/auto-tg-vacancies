import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { Config } from "../config/schema.js";
import { log } from "../utils/logger.js";
import { openBrowser } from "./browser.js";
import { SEL } from "./selectors.js";

export type AuthState = "logged_in" | "logged_out";

/** Waits until the page shows either the chat list or the login screen. */
export async function detectAuthState(page: Page, timeout = 30_000): Promise<AuthState> {
  const loggedIn = page.locator(SEL.chatList).first();
  const loggedOut = page.locator(SEL.qrCanvas).or(page.getByRole("button", { name: SEL.loginScreenButton })).first();
  await loggedIn.or(loggedOut).waitFor({ timeout });
  return (await loggedIn.isVisible()) ? "logged_in" : "logged_out";
}

export async function authStatus(config: Config): Promise<AuthState> {
  const browser = await openBrowser(config, { headless: true });
  try {
    return await detectAuthState(await browser.newPage());
  } finally {
    await browser.close();
  }
}

/** QR login in a visible browser window. A 2FA password, if set, is entered in that window too. */
export async function login(config: Config): Promise<void> {
  const browser = await openBrowser(config, { headless: false });
  try {
    const page = await browser.newPage();
    if ((await detectAuthState(page)) === "logged_in") {
      log.success("Вы уже авторизованы.");
      return;
    }
    log.info("Отсканируйте QR-код в открывшемся окне браузера: Telegram → Настройки → Устройства → Подключить устройство.");
    log.info("Если включена двухэтапная аутентификация, введите пароль в том же окне.");

    await page.locator(SEL.chatList).first().waitFor({ timeout: 5 * 60_000 });
    log.success("Вход выполнен. Сессия сохранена в " + resolve(config.browser.profileDir));
  } finally {
    await browser.close();
  }
}

/** Removes the local browser profile. The server-side session must be terminated in Telegram → Devices. */
export function logout(config: Config): void {
  rmSync(resolve(config.browser.profileDir), { recursive: true, force: true });
}
