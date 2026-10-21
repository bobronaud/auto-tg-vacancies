import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { authStatus, login, logout } from "../../telegram/auth.js";
import { log } from "../../utils/logger.js";
import { configFrom } from "../context.js";

export function registerAuth(program: Command): void {
  const cmd = program.command("auth").description("Telegram Web session");

  cmd
    .command("login")
    .description("Log in to Telegram Web (QR code in a browser window by default)")
    .option("--phone", "log in with phone number + code in the terminal instead of QR")
    .option("--headless", "do not show the browser window (only with --phone)")
    .action(async (opts: { phone?: boolean; headless?: boolean }, c: Command) => {
      if (opts.headless && !opts.phone) throw new Error("--headless requires --phone (QR needs a visible window)");
      await login(configFrom(c), { phone: !!opts.phone, headless: !!opts.headless });
    });

  cmd
    .command("status")
    .description("Check whether the stored session is logged in")
    .action(async (_, c: Command) => {
      const state = await authStatus(configFrom(c));
      if (state === "logged_in") log.success("Logged in");
      else log.warn("Not logged in. Run: npm run dev → Log in to Telegram");
    });

  cmd
    .command("logout")
    .description("Delete the local browser profile (session)")
    .option("-y, --yes", "skip confirmation")
    .action(async (opts: { yes?: boolean }, c: Command) => {
      if (!opts.yes && !(await confirm({ message: "Delete the local Telegram session?", default: false }))) return;
      logout(configFrom(c));
      log.success("Local session deleted.");
      log.info("Also terminate it on the server: Telegram → Settings → Devices.");
    });
}
