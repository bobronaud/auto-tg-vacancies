import { describe, expect, it } from "vitest";
import { normalizeButton, parseMiniAppLink } from "../src/telegram/links.js";

describe("mini app links", () => {
  it("parses bot/app links with startapp", () => {
    expect(parseMiniAppLink("https://t.me/ExampleJobsBot/app?startapp=abc%3D")).toEqual({
      bot: "ExampleJobsBot",
      app: "app",
      startParam: "abc=",
    });
    expect(parseMiniAppLink("https://t.me/example_bot?startapp")).toEqual({ bot: "example_bot", app: null, startParam: null });
  });

  it("ignores ordinary links", () => {
    expect(parseMiniAppLink("https://t.me/example_channel/123")).toBeNull();
    expect(parseMiniAppLink("https://example.com/?startapp=1")).toBeNull();
  });

  it("turns mini-app url buttons into web_app", () => {
    expect(normalizeButton({ text: "Apply", kind: "url", url: "https://t.me/ExampleJobsBot/app?startapp=x" }).kind).toBe("web_app");
    expect(normalizeButton({ text: "Site", kind: "url", url: "https://example.com" }).kind).toBe("url");
  });
});
