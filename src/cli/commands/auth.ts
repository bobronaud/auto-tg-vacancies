import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { authStatus, login, logout } from "../../telegram/auth.js";
import { log } from "../../utils/logger.js";
import { configFrom } from "../context.js";

export function registerAuth(program: Command): void {
  const cmd = program.command("auth").description("Сессия Telegram Web");

  cmd
    .command("login")
    .description("Войти в Telegram Web по QR-коду (откроется окно браузера)")
    .action(async (_, c: Command) => {
      await login(configFrom(c));
    });

  cmd
    .command("status")
    .description("Проверить, активна ли сохранённая сессия")
    .action(async (_, c: Command) => {
      const state = await authStatus(configFrom(c));
      if (state === "logged_in") log.success("Вход выполнен");
      else log.warn("Вход не выполнен. Запустите: npm run dev → «Войти в Telegram»");
    });

  cmd
    .command("logout")
    .description("Удалить локальный профиль браузера (сессию)")
    .option("-y, --yes", "без подтверждения")
    .action(async (opts: { yes?: boolean }, c: Command) => {
      if (!opts.yes && !(await confirm({ message: "Удалить локальную сессию Telegram?", default: false }))) return;
      logout(configFrom(c));
      log.success("Локальная сессия удалена.");
      log.info("Завершите её и на сервере: Telegram → Настройки → Устройства.");
    });
}
