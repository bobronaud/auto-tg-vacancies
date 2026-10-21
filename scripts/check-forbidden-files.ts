// Pre-commit guard: blocks sensitive files even if they were force-added (`git add -f`).
import { execFileSync } from "node:child_process";

const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /^\.data\//, reason: "browser profile / DB / samples (Telegram session!)" },
  { pattern: /(^|\/)\.env(\..+)?$/, reason: "secrets file" },
  { pattern: /^config\.ya?ml$/, reason: "personal config — commit config.example.yaml instead" },
  { pattern: /\.(db|sqlite3?)(-.*)?$/, reason: "database file" },
  { pattern: /^resumes\/(?!example\.md$)/, reason: "resume — personal data" },
  { pattern: /\.pdf$/i, reason: "PDF (resume?) — personal data" },
  { pattern: /\.har$/, reason: "HTTP archive may contain cookies" },
  { pattern: /(^|\/)trace.*\.zip$/, reason: "Playwright trace may contain session data" },
  { pattern: /(^|\/)(playwright-report|test-results|blob-report)\//, reason: "Playwright artifacts" },
];
const ALLOWED = [/(^|\/)\.env\.example$/];

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const violations = staged.flatMap((file) => {
  if (ALLOWED.some((re) => re.test(file))) return [];
  const hit = FORBIDDEN.find(({ pattern }) => pattern.test(file));
  return hit ? [`  ${file} — ${hit.reason}`] : [];
});

if (violations.length > 0) {
  console.error("✖ Refusing to commit sensitive files:\n" + violations.join("\n"));
  console.error("Unstage them with: git restore --staged <file>");
  process.exit(1);
}
