import { defineConfig } from "vitest/config"
import { TEST_TIMEOUT_MS } from "./cli/test/lib/spawnTimeout"

export default defineConfig({
  test: {
    include: ["cli/test/unit/**/*.test.{ts,mjs}"],
    globalSetup: ["cli/test/lib/rootGuard.ts"],
    // Ceilings and their rationale live in cli/test/lib/spawnTimeout.ts.
    testTimeout: TEST_TIMEOUT_MS
  }
})
