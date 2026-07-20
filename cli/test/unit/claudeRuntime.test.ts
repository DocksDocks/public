import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { claudeRuntimePaths, materializeClaudeSettings, statusLineCommand, type ClaudeRuntimePaths } from "../../src/engine-native/claudeRuntime"
import { commitClaudeSettings, prepareClaudeSettings } from "../../src/engine-native/claudeSync"
import type { Ctx } from "../../src/engine-native"
import { jqStringify, type Json } from "../../src/engine-native/jq"
import { makeEngineServices } from "../../src/engine-native/services"

const BUN_SENTINEL = "__DOCKS_KIT_BUN__"
const SESSION_SENTINEL = "__DOCKS_KIT_SESSION_START__"
const NOTIFY_SENTINEL = "__DOCKS_KIT_NOTIFY__"
const STATUS_SENTINEL = "__DOCKS_KIT_STATUSLINE__"

function template() {
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: BUN_SENTINEL, args: [SESSION_SENTINEL], timeout: 5 }] }],
      Notification: [{ hooks: [{ type: "command", command: BUN_SENTINEL, args: [NOTIFY_SENTINEL], timeout: 10, async: true }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }]
    },
    statusLine: { type: "command", command: STATUS_SENTINEL, refreshInterval: 5 },
    model: "opus"
  }
}

const POSIX_RUNTIME: ClaudeRuntimePaths = {
  bun: "/home/O'Brien/.bun/bin/bun",
  statusline: "/home/O'Brien/.claude/bin/statusline.mjs",
  sessionStart: "/home/O'Brien/.claude/bin/session-start.mjs",
  notify: "/home/O'Brien/.claude/bin/notify.mjs"
}

function settingsContext(reconcile = false): { readonly ctx: Ctx; readonly lines: Array<string> } {
  const lines: Array<string> = []
  const services = makeEngineServices({
    sinks: {
      stderr: (chunk) => void lines.push(chunk),
      stdout: (chunk) => void lines.push(chunk)
    }
  })
  const ctx = {
    reconcile,
    services,
    nextStepTriggers: { claudeRestart: false }
  } as Ctx
  return { ctx, lines }
}

describe("Claude runtime paths", () => {
  it("builds the three deployed program paths with output-stable separators", () => {
    expect(claudeRuntimePaths("/home/test/.claude", "/home/test/.bun/bin/bun")).toEqual({
      bun: "/home/test/.bun/bin/bun",
      statusline: "/home/test/.claude/bin/statusline.mjs",
      sessionStart: "/home/test/.claude/bin/session-start.mjs",
      notify: "/home/test/.claude/bin/notify.mjs"
    })
  })
})

describe("statusline shell guards", () => {
  it("quotes POSIX apostrophes and silently succeeds when a file is missing", () => {
    const bun = "'/home/O'\"'\"'Brien/.bun/bin/bun'"
    const script = "'/home/O'\"'\"'Brien/.claude/bin/statusline.mjs'"
    expect(statusLineCommand(POSIX_RUNTIME)).toBe(
      `test -x ${bun} && test -f ${script} && exec ${bun} ${script} || true`
    )
  })
})

describe("Claude settings materialization", () => {
  it("emits direct exec hooks, a guarded statusline, and no Stop key", () => {
    const source = template()
    const materialized = materializeClaudeSettings(source, POSIX_RUNTIME)
    expect(materialized).toEqual({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: POSIX_RUNTIME.bun, args: [POSIX_RUNTIME.sessionStart], timeout: 5 }] }],
        Notification: [{ hooks: [{ type: "command", command: POSIX_RUNTIME.bun, args: [POSIX_RUNTIME.notify], timeout: 10, async: true }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }]
      },
      statusLine: {
        type: "command",
        command: statusLineCommand(POSIX_RUNTIME),
        refreshInterval: 5
      },
      model: "opus"
    })
    expect(JSON.stringify(materialized)).not.toContain("__DOCKS_KIT_")
    expect(source).toEqual(template())
  })

  it("strips only Bun-owned pointers when runtime is deferred", () => {
    expect(materializeClaudeSettings(template(), undefined)).toEqual({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }]
      },
      model: "opus"
    })
  })

  it("rejects Stop, wrong sentinel locations, duplicate sentinels, and residue", () => {
    const withStop = template()
    Object.assign(withStop.hooks, { Stop: [{ hooks: [] }] })
    expect(() => materializeClaudeSettings(withStop, POSIX_RUNTIME)).toThrow(/hooks\.Stop/)

    const wrongLocation = template()
    wrongLocation.hooks.SessionStart[0].hooks[0].command = "bun"
    expect(() => materializeClaudeSettings(wrongLocation, POSIX_RUNTIME)).toThrow(/SessionStart/)

    const duplicate = template()
    duplicate.hooks.Notification[0].hooks[0].args.push(NOTIFY_SENTINEL)
    expect(() => materializeClaudeSettings(duplicate, POSIX_RUNTIME)).toThrow(/Notification/)

    const residue = { ...template(), note: BUN_SENTINEL }
    expect(() => materializeClaudeSettings(residue, POSIX_RUNTIME)).toThrow(/sentinel residue/)
  })
})

describe("Claude settings prepare/commit seam", () => {
  it("prepares a fresh document without writing, then commits through the temp path", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-settings-"))
    const claudeDir = join(root, ".claude")
    mkdirSync(claudeDir)
    try {
      const test = settingsContext()
      const repo: Json = { model: "opus", userSetting: true }
      const prepared = prepareClaudeSettings(test.ctx, claudeDir, repo)
      expect(prepared).toEqual({
        path: join(claudeDir, "settings.json"),
        bytes: jqStringify(repo),
        previousBytes: undefined,
        changed: true
      })
      expect(existsSync(prepared.path)).toBe(false)

      commitClaudeSettings(test.ctx, prepared)
      expect(readFileSync(prepared.path, "utf8")).toBe(jqStringify(repo))
      expect(existsSync(`${prepared.path}.tmp`)).toBe(false)
      expect(test.ctx.nextStepTriggers.claudeRestart).toBe(true)
      expect(test.lines.join("")).toContain("Settings installed")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("preserves the previous bytes for backup and rejects invalid deployed JSON before commit", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-settings-"))
    const claudeDir = join(root, ".claude")
    const path = join(claudeDir, "settings.json")
    mkdirSync(claudeDir)
    try {
      const test = settingsContext()
      const previous = '{"model":"sonnet","userOnly":true}\n'
      writeFileSync(path, previous)
      const prepared = prepareClaudeSettings(test.ctx, claudeDir, { model: "opus" })
      expect(readFileSync(path, "utf8")).toBe(previous)
      expect(existsSync(`${path}.bak`)).toBe(false)

      commitClaudeSettings(test.ctx, prepared)
      expect(readFileSync(path, "utf8")).toBe(prepared.bytes)
      expect(prepared.bytes).toContain('"model": "opus"')
      expect(prepared.bytes).toContain('"userOnly": true')
      expect(readFileSync(`${path}.bak`, "utf8")).toBe(previous)

      writeFileSync(path, "not-json")
      expect(() => prepareClaudeSettings(test.ctx, claudeDir, { model: "opus" })).toThrow()
      expect(readFileSync(path, "utf8")).toBe("not-json")
      expect(existsSync(`${path}.tmp`)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
