import { describe, expect, it } from "vitest";
import { redact } from "../src/utils/logger.js";

describe("redact", () => {
  it("hides API keys, phones and bot tokens", () => {
    const key = ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz"].join("-");
    expect(redact(`key ${key}`)).toBe("key sk-ant-***");
    expect(redact("call +7 (900) 000-00-00")).toBe("call [phone]"); // gitleaks:allow (synthetic)
    expect(redact("call 89000000000")).toBe("call [phone]"); // gitleaks:allow (synthetic)
    expect(redact("123456789:AA" + "x".repeat(33))).toBe("[bot-token]");
  });

  it("keeps salaries and ordinary numbers", () => {
    expect(redact("200 000 - 300 000 RUB")).toBe("200 000 - 300 000 RUB");
  });
});
