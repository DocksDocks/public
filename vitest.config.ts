import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["cli/test/unit/**/*.test.{ts,mjs}"],
    globalSetup: ["cli/test/lib/rootGuard.ts"],
    // Several suites spawn the CLI as a child, and on Windows that pays both a
    // heavier CreateProcess and a cold Bun transpile of the whole CLI - the
    // launcher's source fall-through case does it on purpose. Those land near
    // vitest's 5s default and cross it under runner load, so Windows gets
    // headroom while every other host keeps the strict default and still
    // surfaces a hang in five seconds.
    testTimeout: process.platform === "win32" ? 15_000 : 5_000
  }
})
