import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { beforeAll, describe, expect, it } from "vitest"
import { main, sessionStartLines } from "../../../SoT/.claude/bin/session-start.mjs"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const SCRIPT = resolve(REPO_DIR, "SoT", ".claude", "bin", "session-start.mjs")
const NOW = new Date("2026-07-10T12:34:56.000Z")

beforeAll(() => {
  process.env.TZ = "UTC"
})

function secondLine(overrides = {}) {
  return sessionStartLines({
    env: {},
    now: NOW,
    home: "/home/test",
    readText: () => '{"effortLevel":"high"}',
    ...overrides
  })[1]
}

describe("SessionStart native context", () => {
  it("formats the exact two-line UTC payload", () => {
    expect(sessionStartLines({
      env: {
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "468000",
        CLAUDE_CODE_SUBAGENT_MODEL: "sonnet"
      },
      now: NOW,
      home: "/home/test",
      readText: () => '{"effortLevel":"xhigh"}'
    })).toEqual([
      "[CONTEXT] Current date: Friday, 2026-07-10 12:34:56 UTC",
      "[CONFIG] Context: 1M | Compact-window: 468000 | Effort: xhigh | Thinking: adaptive | Subagent: sonnet"
    ])
  })

  it("uses environment then settings then default effort precedence", () => {
    expect(secondLine({ env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } })).toContain("Effort: max")
    expect(secondLine()).toContain("Effort: high")
    expect(secondLine({ readText: () => "not json" })).toContain("Effort: default")
    expect(secondLine({ readText: () => '{"effortLevel":12}' })).toContain("Effort: default")
    expect(secondLine({ readText: () => { throw new Error("missing") } })).toContain("Effort: default")
  })

  it("preserves context, compact-window, and subagent fallbacks", () => {
    expect(secondLine({ env: { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" } })).toContain("Context: 200K")
    expect(secondLine({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "", CLAUDE_CODE_SUBAGENT_MODEL: "" } })).toContain("Compact-window: full")
    expect(secondLine({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "", CLAUDE_CODE_SUBAGENT_MODEL: "" } })).toContain("Subagent: default")
  })

  it("main writes exactly two newline-terminated lines", async () => {
    const writes = []
    expect(await main({
      env: {},
      now: NOW,
      home: "/home/test",
      readText: () => '{"effortLevel":"high"}',
      writeStdout: (value) => void writes.push(value)
    })).toBe(0)
    expect(writes).toEqual([
      "[CONTEXT] Current date: Friday, 2026-07-10 12:34:56 UTC\n[CONFIG] Context: 1M | Compact-window: full | Effort: high | Thinking: adaptive | Subagent: default\n"
    ])
  })

  it("ignores hook stdin effort data when directly executed", () => {
    const home = mkdtempSync(resolve(tmpdir(), "docks-session-start-"))
    try {
      mkdirSync(resolve(home, ".claude"), { recursive: true })
      writeFileSync(resolve(home, ".claude", "settings.json"), '{"effortLevel":"xhigh"}\n')
      const env = { ...process.env, HOME: home, TZ: "UTC" }
      delete env.CLAUDE_CODE_EFFORT_LEVEL
      const result = spawnSync("bun", [SCRIPT], {
        input: '{"effort":{"level":"low"}}',
        encoding: "utf8",
        env
      })
      expect(result.status).toBe(0)
      expect(result.stderr).toBe("")
      expect(result.stdout.split("\n")[1]).toContain("Effort: xhigh")
      expect(result.stdout).not.toContain("Effort: low")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
