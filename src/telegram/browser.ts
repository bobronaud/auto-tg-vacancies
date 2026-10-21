import { chromium, type BrowserContext, type Page } from "playwright";
import type { Config } from "../config/schema.js";
import { ensurePrivateDir } from "../utils/paths.js";

export type TgBrowser = { context: BrowserContext; newPage: () => Promise<Page>; close: () => Promise<void> };

export async function openBrowser(config: Config, opts: { headless?: boolean } = {}): Promise<TgBrowser> {
  const profileDir = ensurePrivateDir(config.browser.profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: opts.headless ?? config.scrape.headless,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  // tsx/esbuild (keepNames) wraps functions in `__name(...)`; page.evaluate callbacks run in the page,
  // where that helper doesn't exist.
  await context.addInitScript("globalThis.__name = (fn) => fn;");
  // Block heavy media: we only need text, links and buttons.
  await context.route(/\.(mp4|webm|webp|tgs|jpg|jpeg|png|gif)(\?|$)/i, (route) => route.abort());

  let firstPage: Page | undefined = context.pages()[0];
  return {
    context,
    newPage: async () => {
      const page = firstPage ?? (await context.newPage());
      firstPage = undefined;
      await page.goto(config.browser.webUrl);
      return page;
    },
    close: () => context.close(),
  };
}
