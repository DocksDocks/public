import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runEngineNative } from "../../src/engine-native"
import { DEPENDENCIES, type ToolId } from "../../src/engine-native/deps"
import { makePlatform, type DependencyManager, type EngineServices, type Logger } from "../../src/engine-native/services"

interface LogRecord {
  readonly level: "change" | "verbose" | "warn" | "err" | "echo"
  readonly message: string
}

function stubServices(records: Array<LogRecord>): EngineServices {
  const logger: Logger = {
    change: (message) => void records.push({ level: "change", message }),
    progress: () => {},
    clearProgress: () => {},
    verbose: (message) => void records.push({ level: "verbose", message }),
    warn: (message) => void records.push({ level: "warn", message }),
    err: (message) => void records.push({ level: "err", message }),
    echo: (message) => void records.push({ level: "echo", message }),
    acquireTerminal: () => ({
      update: () => {},
      withExclusive: async (action) => await action(),
      release: () => {}
    })
  }
  const platform = makePlatform("linux")
  const deps: DependencyManager = {
    spec: (id) => {
      const specification = DEPENDENCIES[id]
      return { ...specification, installHint: (value = platform.raw()) => specification.installHint(value) }
    },
    probe: (id) => ({ state: "present", path: `/stub-bin/${id}` }),
    version: async (id) => (id === "bun" ? "1.3.14" : "0.5.3"),
    path: async (id) => `/stub-bin/${id}`,
    location: async (id) => ({ path: `/stub-bin/${id}`, binDir: "" }),
    latest: async (id: ToolId) => (id === "effect-solutions" ? "0.5.3" : ""),
    warnMissing: () => {}
  }
  return { logger, deps, platform }
}

const ENV_KEYS = [
  "HOME",
  "AGENTS_DIR",
  "DRY_RUN",
  "DOCKS_KIT_VERBOSE",
  "SKIP_BUBBLEWRAP",
  "RECONCILE",
  "PRUNE",
  "ASSUME_YES",
  "CLAUDE_COMPACT_WINDOW",
  "CLAUDE_PERMISSIVE",
  "CLAUDE_PLUGINS",
  "CLAUDE_MODEL",
  "CODEX_MODEL",
  "DOCKS_KIT_SYNC_CONCURRENCY"
] as const

describe.sequential("modifier field validation", () => {
  let root = ""
  let previous = new Map<string, string | undefined>()

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "modifier-validation-"))
    previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const key of ENV_KEYS) delete process.env[key]
    process.env["HOME"] = root
    process.env["AGENTS_DIR"] = join(root, ".agents")
  })

  afterEach(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  })

  it("normalizes CLAUDE_COMPACT_WINDOW through the flag parser and rejects junk", async () => {
    process.env["CLAUDE_COMPACT_WINDOW"] = "680k"
    const environmentRecords: Array<LogRecord> = []
    expect(await runEngineNative(["sync", "claude", "--dry-run"], stubServices(environmentRecords))).toBe(0)

    delete process.env["CLAUDE_COMPACT_WINDOW"]
    const flagRecords: Array<LogRecord> = []
    expect(
      await runEngineNative(
        ["sync", "claude", "--dry-run", "--claude-compact-window=680k"],
        stubServices(flagRecords)
      )
    ).toBe(0)

    const compactMessage = (records: Array<LogRecord>): string | undefined =>
      records.find(({ message }) => message.includes("(--claude-compact-window)"))?.message
    expect(compactMessage(environmentRecords)).toBe(compactMessage(flagRecords))
    expect(compactMessage(environmentRecords)).toContain("CLAUDE_CODE_AUTO_COMPACT_WINDOW=680000")

    process.env["CLAUDE_COMPACT_WINDOW"] = "junk"
    const invalidRecords: Array<LogRecord> = []
    expect(await runEngineNative(["sync", "agents", "--dry-run"], stubServices(invalidRecords))).toBe(2)
    expect(invalidRecords).toContainEqual({
      level: "err",
      message: "CLAUDE_COMPACT_WINDOW expects a token count (e.g. 680000 or 680k)"
    })
  })

  it("rejects every invalid CLAUDE_PLUGINS token", async () => {
    process.env["CLAUDE_PLUGINS"] = "supabase arbitrary n8n"
    const records: Array<LogRecord> = []

    expect(await runEngineNative(["sync", "agents", "--dry-run"], stubServices(records))).toBe(2)
    expect(records).toContainEqual({
      level: "err",
      message: "Unknown opt-in plugin 'arbitrary'. Known: supabase, n8n"
    })
  })

  it("warns for every explicit Claude modifier when Claude is deselected", async () => {
    const records: Array<LogRecord> = []

    expect(
      await runEngineNative(
        [
          "sync",
          "agents",
          "--dry-run",
          "--claude-compact-window=680k",
          "--claude-permissive",
          "--claude-plugin=supabase"
        ],
        stubServices(records)
      )
    ).toBe(0)
    expect(records.filter(({ level }) => level === "warn")).toEqual([
      { level: "warn", message: "--claude-compact-window ignored: claude target not selected" },
      { level: "warn", message: "--claude-permissive ignored: claude target not selected" },
      { level: "warn", message: "--claude-plugin ignored: claude target not selected" }
    ])
  })

  it("fails when deployed model configuration exists but cannot be read", async () => {
    mkdirSync(join(root, ".claude", "settings.json"), { recursive: true })
    const records: Array<LogRecord> = []

    expect(await runEngineNative(["model", "claude"], stubServices(records))).toBe(1)
    expect(records).toContainEqual({
      level: "err",
      message: expect.stringContaining("Failed to read ~/.claude/settings.json:")
    })
    expect(records).not.toContainEqual({ level: "warn", message: "~/.claude/settings.json missing" })
  })

  it("derives toolchain operation and tool only from positional words", async () => {
    const checkRecords: Array<LogRecord> = []
    expect(await runEngineNative(["toolchain", "--yes"], stubServices(checkRecords))).toBe(0)

    const ensureRecords: Array<LogRecord> = []
    expect(await runEngineNative(["toolchain", "--yes", "ensure"], stubServices(ensureRecords))).toBe(2)
    expect(ensureRecords).toContainEqual({
      level: "err",
      message: "Usage: toolchain ensure <tool> [--yes]"
    })
  })
})
