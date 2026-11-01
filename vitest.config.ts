import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests use synthetic fixtures and must never load local secrets.
  envDir: false,
  test: { include: ["test/**/*.test.ts"] },
});
