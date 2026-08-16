import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  root: "",
  firstExitCode: 0,
  firstOutput: "--- Sync complete ---\n",
  runCount: 0
}))
vi.mock("../../src/engine-native/os", () => ({
  // This unit harness exercises the Linux-canonical replay logic with every
  // engine/filesystem dependency mocked; it does not execute a host artifact.
  hostOs: vi.fn(() => ({ executableSuffixes: [""] }))
}))


vi.mock("../lib/goldenExecution", () => ({
  cleanup: vi.fn(),
  readArgvLog: vi.fn(() => "argv"),
  runEngine: vi.fn(() => {
    harness.runCount++
    if (harness.runCount === 1) {
      return {
        exitCode: harness.firstExitCode,
        output: harness.firstOutput,
        home: harness.root
      }
    }
    return {
      exitCode: 0,
      output: "second replay output",
      home: harness.root
    }
  }),
  runEngineSplit: vi.fn(),
  runPublicCli: vi.fn()
}))

vi.mock("../lib/goldenMutationCatalog", () => ({
  LEGACY_CLAUDE_FILES: {},
  MATRIX: [],
  REPLAYS: [{ fixture: "home-fresh", cmd: ["sync"] }],
  TOML_DIR: harness.root,
  TOML_SHAPES: []
}))

vi.mock("../lib/goldenResources", () => ({
  FIXTURES_DIR: harness.root,
  REPO_DIR: harness.root,
  makeStubDir: vi.fn(() => harness.root),
  materializeVariant: vi.fn(() => harness.root)
}))

vi.mock("../lib/goldenSnapshot", () => ({
  diffText: vi.fn(() => []),
  diffTrees: vi.fn(() => []),
  snapshotTree: vi.fn(() => ({})),
  stableStringify: vi.fn((value: unknown) => `${JSON.stringify(value, null, 2)}\n`)
}))

const ORIGINAL_ARGV = process.argv
const ORIGINAL_FILTER = process.env["GOLDEN_FILTER"]

beforeAll(() => {
  harness.root = mkdtempSync(join(tmpdir(), "docks-golden-replay-"))
})

beforeEach(() => {
  vi.resetModules()
  harness.runCount = 0
  harness.firstExitCode = 0
  harness.firstOutput = "--- Sync complete ---\n"
  process.argv = ["bun", "golden-mutation.ts"]
  process.env["GOLDEN_FILTER"] = "replay=2nd"

  const goldenDir = join(harness.root, "cli", "test", "goldens")
  mkdirSync(goldenDir, { recursive: true })
  writeFileSync(
    join(goldenDir, "mutation.json"),
    JSON.stringify({
      version: 1,
      cases: {
        "fixture=home-fresh cmd=sync replay=2nd": {
          command: ["sync"],
          exitCode: 0,
          tree: {},
          argvLog: "argv",
          output: "second replay output"
        },
        other: {
          command: ["other"],
          exitCode: 0,
          tree: {},
          argvLog: "other",
          output: "other"
        }
      }
    })
  )
})

afterEach(() => {
  process.argv = ORIGINAL_ARGV
  if (ORIGINAL_FILTER === undefined) delete process.env["GOLDEN_FILTER"]
  else process.env["GOLDEN_FILTER"] = ORIGINAL_FILTER
  vi.clearAllMocks()
})

afterAll(() => {
  rmSync(harness.root, { recursive: true, force: true })
})

describe("golden mutation replay anchors", () => {
  it("rejects a failed first replay even when the second replay matches its golden", async () => {
    harness.firstExitCode = 7
    harness.firstOutput = "first replay failed\n"

    await expect(import("../golden-mutation")).rejects.toThrow(
      "first replay failed for 'sync' with exit code 7"
    )
  })

  it("rejects missing first-replay output even when the second replay matches its golden", async () => {
    harness.firstOutput = ""

    await expect(import("../golden-mutation")).rejects.toThrow(
      "first replay for 'sync' produced no sync completion summary"
    )
  })
})
