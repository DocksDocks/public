import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["cli/test/unit/**/*.test.{ts,mjs}"],
    globalSetup: ["cli/test/lib/rootGuard.ts"]
  }
})
