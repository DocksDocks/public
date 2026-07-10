import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { isObject, parseJson, type Json } from "../../src/engine-native/jq"
import {
  cleanup,
  makeStubDir,
  materializeVariant,
  readArgvLog,
  runEngine,
  stableStringify
} from "../lib/harness"

const LEGACY_SETTINGS: { [key: string]: Json } = {
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "legacy-session", timeout: 5 }] }],
    Notification: [{ hooks: [{ type: "command", command: "legacy-notify", timeout: 10, async: true }] }],
    Stop: [{ hooks: [{ type: "command", command: "legacy-fetch", timeout: 5, async: true }] }]
  },
  statusLine: { type: "command", command: "legacy-statusline", refreshInterval: 5 },
  userOnly: "preserved"
}

const LEGACY_FILES = {
  ".claude/statusline.sh": "legacy-statusline-marker\n",
  ".claude/fetch-usage.sh": "legacy-fetch-marker\n",
  ".claude/hooks/notify.sh": "legacy-notify-marker\n"
} as const

const RUNTIME_FILES = [
  ".claude/bin/statusline.mjs",
  ".claude/bin/session-start.mjs",
  ".claude/bin/notify.mjs",
  ".claude/notification.mp3"
] as const

function legacyVariant(settings = stableStringify(LEGACY_SETTINGS)): string {
  return materializeVariant("home-fresh", {
    ".claude/settings.json": settings,
    ...LEGACY_FILES
  })
}

function settingsObject(home: string): { [key: string]: Json } {
  const parsed = parseJson(readFileSync(join(home, ".claude", "settings.json"), "utf8"))
  if (parsed === undefined || !isObject(parsed)) throw new Error("deployed settings are not an object")
  return parsed
}

function hooksObject(settings: { [key: string]: Json }): { [key: string]: Json } {
  const hooks = settings["hooks"]
  if (hooks === undefined || !isObject(hooks)) throw new Error("deployed hooks are not an object")
  return hooks
}

function expectLegacyPointers(home: string): void {
  const settings = settingsObject(home)
  const hooks = hooksObject(settings)
  const legacyHooks = hooksObject(LEGACY_SETTINGS)
  expect(hooks["SessionStart"]).toEqual(legacyHooks["SessionStart"])
  expect(hooks["Notification"]).toEqual(legacyHooks["Notification"])
  expect(hooks["Stop"]).toEqual(legacyHooks["Stop"])
  expect(settings["statusLine"]).toEqual(LEGACY_SETTINGS["statusLine"])
}

function expectLegacyFiles(home: string): void {
  for (const [relative, marker] of Object.entries(LEGACY_FILES)) {
    expect(readFileSync(join(home, relative), "utf8")).toBe(marker)
  }
}

describe.sequential("Claude runtime migration transaction", () => {
  it("shares one deferred Bun result across an all-target legacy run", () => {
    const variant = legacyVariant()
    const stubs = makeStubDir({ bun: null, curl: null, "effect-solutions": null })
    const run = runEngine("native", ["sync"], variant, stubs, {
      maskTools: ["bun", "curl", "effect-solutions"]
    })
    try {
      expect(run.exitCode).toBe(0)
      expectLegacyPointers(run.home)
      expectLegacyFiles(run.home)
      for (const relative of RUNTIME_FILES) expect(existsSync(join(run.home, relative))).toBe(false)
      expect(run.output.match(/curl not installed/g)).toHaveLength(1)
      expect(run.output.match(/Bun unavailable — Claude statusline\/hooks migration deferred/g)).toHaveLength(1)
      expect(run.output).toContain("Hooks:    migration deferred (Bun unavailable; existing hook/statusline settings preserved)")
      expect(readArgvLog(run)).not.toMatch(/^curl\t/m)
      expect(readArgvLog(run)).not.toContain("add -g effect-solutions")
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("installs only safe unrelated hooks on a fresh home when Bun is unavailable", () => {
    const stubs = makeStubDir({ bun: null, curl: null })
    const run = runEngine("native", ["sync", "claude"], "home-fresh", stubs, { maskTools: ["bun", "curl"] })
    try {
      expect(run.exitCode).toBe(0)
      const settings = settingsObject(run.home)
      const hooks = hooksObject(settings)
      expect(hooks["PreToolUse"]).toBeDefined()
      expect(hooks["PostToolUseFailure"]).toBeDefined()
      expect(hooks["SubagentStop"]).toBeDefined()
      expect(hooks["SessionStart"]).toBeUndefined()
      expect(hooks["Notification"]).toBeUndefined()
      expect(hooks["Stop"]).toBeUndefined()
      expect(settings["statusLine"]).toBeUndefined()
      for (const relative of RUNTIME_FILES) expect(existsSync(join(run.home, relative))).toBe(false)
      expect(run.output).toContain("Bun unavailable — Claude statusline/hooks migration deferred")
    } finally {
      cleanup([run])
    }
  })

  it("rejects invalid deployed settings before runtime or legacy fallback mutation", () => {
    const variant = legacyVariant("not-json")
    const run = runEngine("native", ["sync", "claude"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(1)
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe("not-json")
      expectLegacyFiles(run.home)
      for (const relative of RUNTIME_FILES) expect(existsSync(join(run.home, relative))).toBe(false)
      expect(run.output).toContain("is not valid JSON")
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("writes runtime assets before settings commit and preserves fallbacks when that commit fails", () => {
    const original = stableStringify(LEGACY_SETTINGS)
    const variant = legacyVariant(original)
    mkdirSync(join(variant, ".claude", "settings.json.tmp"))
    const run = runEngine("native", ["sync", "claude"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(1)
      expect(readFileSync(join(run.home, ".claude", "settings.json"), "utf8")).toBe(original)
      expectLegacyPointers(run.home)
      expectLegacyFiles(run.home)
      for (const relative of RUNTIME_FILES) expect(existsSync(join(run.home, relative))).toBe(true)
      expect(run.output).toContain("Claude runtime synced (statusline, session-start, notify, notification)")
      expect(run.output).not.toContain("Pruned stale artifacts")
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })

  it("prunes a null-valued hooks.Stop key on a ready migration", () => {
    const nullStop = stableStringify({ ...LEGACY_SETTINGS, hooks: { Stop: null } })
    const variant = legacyVariant(nullStop)
    const run = runEngine("native", ["sync", "claude"], variant, makeStubDir())
    try {
      expect(run.exitCode).toBe(0)
      const hooks = hooksObject(settingsObject(run.home))
      expect(Object.prototype.hasOwnProperty.call(hooks, "Stop")).toBe(false)
    } finally {
      cleanup([run])
      rmSync(variant, { recursive: true, force: true })
    }
  })
})

describe.sequential("contextual dependency degradation", () => {
  it("syncs Claude and Codex without jq or a jq warning", () => {
    for (const target of ["claude", "codex"] as const) {
      const run = runEngine("native", ["sync", target], "home-fresh", makeStubDir({ jq: null }), { maskTools: ["jq"] })
      try {
        expect(run.exitCode).toBe(0)
        expect(run.output).not.toContain("jq not installed")
        expect(readArgvLog(run)).not.toMatch(/^jq\t/m)
      } finally {
        cleanup([run])
      }
    }
  })

  it("continues Claude sync with the contextual RTK curl warning and no curl child", () => {
    const run = runEngine(
      "native",
      ["sync", "claude"],
      "home-fresh",
      makeStubDir({ curl: null, rtk: null }),
      { maskTools: ["curl", "rtk"] }
    )
    try {
      expect(run.exitCode).toBe(0)
      expect(run.output.match(/curl not installed/g)).toHaveLength(1)
      expect(run.output).toContain(
        "curl not installed — sudo apt install -y curl (cannot download RTK installer; continuing sync without RTK)"
      )
      expect(run.output).not.toContain("latest version unknown")
      expect(run.output).not.toContain("RTK bootstrap failed")
      expect(readArgvLog(run)).not.toMatch(/^curl\t/m)
    } finally {
      cleanup([run])
    }
  })

  it("fails direct RTK ensure with its contextual curl warning and no curl child", () => {
    const run = runEngine(
      "native",
      ["toolchain", "ensure", "rtk"],
      "home-fresh",
      makeStubDir({ curl: null, rtk: null }),
      { maskTools: ["curl", "rtk"] }
    )
    try {
      expect(run.exitCode).toBe(1)
      expect(run.output.match(/curl not installed/g)).toHaveLength(1)
      expect(run.output).toContain(
        "curl not installed — sudo apt install -y curl (cannot download RTK installer; toolchain ensure rtk aborted)"
      )
      expect(run.output).not.toContain("latest version unknown")
      expect(readArgvLog(run)).not.toMatch(/^curl\t/m)
    } finally {
      cleanup([run])
    }
  })
})
