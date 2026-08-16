import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["cli/test/unit/**/*.test.{ts,mjs}"],
    globalSetup: ["cli/test/lib/rootGuard.ts"],
    // Several suites spawn the CLI as a child, and every spawn pays a cold Bun
    // transpile of the whole CLI - the launcher's source fall-through case does
    // it on purpose. That cost is ~1s warm on a developer machine and crossed
    // vitest's 5s default on a cold `macos-26` runner, so the ceiling is the
    // same on every host rather than assuming POSIX spawns stay fast. A hang
    // still fails the run; it just takes fifteen seconds to say so.
    testTimeout: 15_000
  }
})
