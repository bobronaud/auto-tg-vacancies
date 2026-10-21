import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { input, password } from "@inquirer/prompts";
import type { Page } from "playwright";
import type { Config } from "../config/schema.js";
import { log } from "../utils/logger.js";
import { openBrowser } from "./browser.js";
import { SEL } from "./selectors.js";

export type AuthState = "logged_in" | "logged_out";

/** Waits until the page shows either the chat list or the login screen. */
export async function detectAuthState(page: Page, timeout = 30_000): Promise<AuthState> {
  const loggedIn = page.locator(SEL.chatList).first();
  const loggedOut = page.locator(SEL.qrCanvas).or(page.getByRole("button", { name: SEL.phoneLoginButton })).first();
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

export async function login(config: Config, opts: { phone: boolean; headless: boolean }): Promise<void> {
  const browser = await openBrowser(config, { headless: opts.headless });
  try {
    const page = await browser.newPage();
    if ((await detectAuthState(page)) === "logged_in") {
      log.success("Already logged in.");
      return;
    }
    if (opts.phone) await loginByPhone(page);
    else log.info("Scan the QR code in the opened browser window: Telegram app → Settings → Devices → Link Desktop Device.");

    await page.locator(SEL.chatList).first().waitFor({ timeout: 5 * 60_000 });
    log.success("Logged in. Session is stored in " + resolve(config.browser.profileDir));
  } finally {
    await browser.close();
  }
}

async function loginByPhone(page: Page): Promise<void> {
  await page.getByRole("button", { name: SEL.phoneLoginButton }).click();
  const phone = await input({
    message: "Phone number in international format (+7...):",
    validate: (v) => /^\+\d{7,15}$/.test(v.replace(/[\s\-()]/g, "")) || "Expected +<country><number>",
  });
  const phoneField = page.locator(SEL.phoneInput);
  await phoneField.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(phone.replace(/[\s\-()]/g, ""));
  await page.getByRole("button", { name: SEL.nextButton }).click();

  const code = await password({ message: "Login code from Telegram:", mask: "*" });
  await page.locator(SEL.codeInput).first().fill(code.trim());

  const chatList = page.locator(SEL.chatList).first();
  const passwordField = page.locator(SEL.passwordInput).first();
  await chatList.or(passwordField).waitFor({ timeout: 60_000 });
  if (await passwordField.isVisible()) {
    const pwd = await password({ message: "Two-step verification password:", mask: "*" });
    await passwordField.fill(pwd);
    await passwordField.press("Enter");
  }
}

/** Removes the local browser profile. The server-side session must be terminated in Telegram → Devices. */
export function logout(config: Config): void {
  rmSync(resolve(config.browser.profileDir), { recursive: true, force: true });
}
