import { styleText } from "node:util";
import { Help } from "commander";

const KEY_LABELS: Record<string, string> = {
  navigate: "перемещение",
  select: "выбрать",
  submit: "подтвердить",
  all: "все",
  invert: "инвертировать",
};

const keysHelpTip = (keys: [string, string][]) =>
  keys
    .map(([key, action]) => `${styleText("bold", key === "space" ? "пробел" : key)} ${styleText("dim", KEY_LABELS[action] ?? action)}`)
    .join(styleText("dim", " • "));

/** Inquirer theme with Russian key hints. */
export const promptTheme = { style: { keysHelpTip } };

/**
 * Theme for menus: no "? question" line (an empty prefix and message are filtered out by the prompt),
 * cyan cursor and a Ctrl+C hint. Use with `{ clearPromptOnDone: true }` so no answer line is left behind.
 */
export const menuTheme = {
  prefix: "",
  icon: { cursor: styleText("cyan", "❯") },
  style: {
    message: () => "",
    highlight: (text: string) => styleText("bold", text),
    keysHelpTip: (keys: [string, string][]) => keysHelpTip([...keys, ["Ctrl+C", "выход"]]),
  },
};
export const menuContext = { clearPromptOnDone: true };

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
