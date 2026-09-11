/**
 * One CLI bundle for the whole unit run.
 *
 * Vitest forks a worker per test file batch, and each worker would otherwise
 * build its own bundle. Building here and naming the result in the environment
 * makes the run pay for one build: `cliEntry()` prefers the named entry.
 * A value already present in the environment is left alone, so
 * `DOCKS_KIT_TEST_CLI_ENTRY=cli/src/main.ts bun run test:unit` still runs every
 * spawning suite against the TypeScript entry.
 */
import { CLI_ENTRY_ENV, buildCliEntry, processCliEntryPath, removeCliEntry } from "./cliEntry"

let owned: string | undefined

export function setup(): void {
  const existing = process.env[CLI_ENTRY_ENV]
  if (existing !== undefined && existing !== "") return
  owned = buildCliEntry(processCliEntryPath())
  process.env[CLI_ENTRY_ENV] = owned
}

export function teardown(): void {
  if (owned === undefined) return
  removeCliEntry(owned)
  delete process.env[CLI_ENTRY_ENV]
  owned = undefined
}
