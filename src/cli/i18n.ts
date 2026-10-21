import { styleText } from "node:util";
import { Help } from "commander";

const KEY_LABELS: Record<string, string> = {
  navigate: "перемещение",
  select: "выбрать",
  submit: "подтвердить",
  all: "все",
  invert: "инвертировать",
};

/** Inquirer theme with Russian key hints. */
export const promptTheme = {
  style: {
    keysHelpTip: (keys: [string, string][]) =>
      keys
        .map(([key, action]) => `${styleText("bold", key === "space" ? "пробел" : key)} ${styleText("dim", KEY_LABELS[action] ?? action)}`)
        .join(styleText("dim", " • ")),
  },
};

const HELP_TITLES: Record<string, string> = {
  "Usage:": "Использование:",
  "Options:": "Опции:",
  "Commands:": "Команды:",
  "Arguments:": "Аргументы:",
  "Global Options:": "Глобальные опции:",
};

export const helpConfig: Partial<Help> = {
  styleTitle: (title: string) => HELP_TITLES[title] ?? title,
  optionDescription(option) {
    return Help.prototype.optionDescription.call(this, option).replace(/\(default: /, "(по умолчанию: ");
  },
};
