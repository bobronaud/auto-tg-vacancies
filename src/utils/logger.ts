import pc from "picocolors";

const REDACTIONS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-***"],
  [/\+\d{1,3}[\s\-()]*\d[\d\s\-()]{7,}\d/g, "[phone]"],
  [/\b[78]9\d{9}\b/g, "[phone]"],
  [/\b\d{8,10}:AA[0-9A-Za-z_\-]{33}\b/g, "[bot-token]"],
];

/** Removes secrets and phone numbers from any string that is about to be printed. */
export function redact(text: string): string {
  return REDACTIONS.reduce((acc, [re, repl]) => acc.replace(re, repl), text);
}

const fmt = (args: unknown[]) =>
  redact(args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "));

let verbose = process.env.DEBUG === "1";

export const log = {
  setVerbose(v: boolean) {
    verbose = v;
  },
  info: (...args: unknown[]) => console.log(fmt(args)),
  success: (...args: unknown[]) => console.log(pc.green("✔ ") + fmt(args)),
  warn: (...args: unknown[]) => console.warn(pc.yellow("⚠ ") + fmt(args)),
  error: (...args: unknown[]) => console.error(pc.red("✖ ") + fmt(args)),
  debug: (...args: unknown[]) => {
    if (verbose) console.log(pc.dim(fmt(args)));
  },
};
