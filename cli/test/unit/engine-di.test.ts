import { describe, expect, it, vi } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runEngineNative } from "../../src/engine-native"
import {
  syncClaudeAdvisor,
  syncClaudeEffort
} from "../../src/engine-native/claudeSettingsModifiers"
import { replaceTopLevelSetting, syncCodexEffort } from "../../src/engine-native/codexToml"
import { DEPENDENCIES, type ToolId } from "../../src/engine-native/deps"
import type { Ctx } from "../../src/engine-native"
import {
  makeEngineServices,
  makePlatform,
  type DependencyManager,
  type EngineServices,
  type Logger
} from "../../src/engine-native/services"
import { sotEffort } from "../../src/efforts"
import { kitHome } from "../../src/kitHome"

type LogLevel = "change" | "verbose" | "warn" | "err" | "echo"
interface LogRecord {
  readonly level: LogLevel
  readonly message: string
}

interface StubOptions {
  readonly missing?: ReadonlyArray<ToolId>
  readonly versions?: Partial<Record<ToolId, string>>
  readonly latest?: Partial<Record<ToolId, string>>
}

function stubServices(records: Array<LogRecord>, options: StubOptions = {}): EngineServices {
  const logger: Logger = {
    change: (message) => void records.push({ level: "change", message }),
    verbose: (message) => void records.push({ level: "verbose", message }),
    warn: (message) => void records.push({ level: "warn", message }),
    err: (message) => void records.push({ level: "err", message }),
    echo: (message) => void records.push({ level: "echo", message })
  }
  const platform = makePlatform("linux")
  const missing = new Set(options.missing ?? [])
  const versions: Partial<Record<ToolId, string>> = {
    "agent-browser": "0.31.1",
    "effect-solutions": "0.5.3",
    bun: "1.3.14",
    ...options.versions
  }
  const latest: Partial<Record<ToolId, string>> = {
    "agent-browser": "0.31.1",
    "effect-solutions": "0.5.3",
    rtk: "0.43.0",
    ...options.latest
  }
  const warned = new Set<ToolId>()
  const deps: DependencyManager = {
    spec: (id) => {
      const specification = DEPENDENCIES[id]
      return { ...specification, installHint: (pf = platform.raw()) => specification.installHint(pf) }
    },
    probe: (id) =>
      missing.has(id)
        ? { state: "missing" }
        : { state: "present", path: `/stub-bin/${id}` },
    version: (id) => versions[id] ?? "",
    path: (id) => (missing.has(id) ? "" : `/stub-bin/${id}`),
    location: (id) => ({ path: missing.has(id) ? "" : `/stub-bin/${id}`, binDir: "" }),
    latest: (id) => latest[id] ?? "",
    warnMissing: (id, currentLogger, context) => {
      if (warned.has(id)) return
      warned.add(id)
      const suffix = context !== undefined && context !== "" ? ` (${context})` : ""
      currentLogger.warn(`${id} not installed — ${DEPENDENCIES[id].installHint(platform.raw())}${suffix}`)
    }
  }
  return { logger, deps, platform }
}

class RecordingLogger implements Logger {
  constructor(private readonly records: Array<LogRecord>) {}

  change(message: string): void {
    this.records.push({ level: "change", message })
  }

  verbose(message: string): void {
    this.records.push({ level: "verbose", message })
  }

  warn(message: string): void {
    this.records.push({ level: "warn", message })
  }

  err(message: string): void {
    this.records.push({ level: "err", message })
  }

  echo(message: string): void {
    this.records.push({ level: "echo", message })
  }
}

function modifierCtx(home: string, records: Array<LogRecord>, dryRun = false): Ctx {
  return {
    repoDir: kitHome(),
    home,
    agentsDir: join(home, ".agents"),
    dryRun,
    verbose: true,
    skipRtk: false,
    reconcile: false,
    prune: false,
    assumeYes: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: "",
    codexEffort: "",
    services: stubServices(records),
    targetFilterSet: true,
    syncClaude: true,
    syncCodex: false,
    syncAgents: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false
    }
  }
}

describe("Claude settings modifiers", () => {
  it("sets effort, resolves default from the embedded SoT, and is idempotent", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-effort-modifier-"))
    const settings = join(home, ".claude", "settings.json")
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(settings, '{"model":"sonnet","userOnly":true}\n')
    const records: Array<LogRecord> = []
    const ctx = modifierCtx(home, records)

    try {
      syncClaudeEffort(ctx, "low")
      expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({
        model: "sonnet",
        userOnly: true,
        effortLevel: "low"
      })
      expect(records).toContainEqual({
        level: "change",
        message: "Effort: deployed settings effortLevel set to low (SoT unchanged; flag-less sync reverts)"
      })
      expect(ctx.nextStepTriggers.claudeRestart).toBe(true)

      records.length = 0
      ctx.nextStepTriggers.claudeRestart = false
      syncClaudeEffort(ctx, "low")
      expect(records).toEqual([
        { level: "verbose", message: "Effort: deployed settings effortLevel already low" }
      ])
      expect(ctx.nextStepTriggers.claudeRestart).toBe(false)

      records.length = 0
      syncClaudeEffort(ctx, "default")
      expect(JSON.parse(readFileSync(settings, "utf8"))).toMatchObject({
        model: "sonnet",
        userOnly: true,
        effortLevel: sotEffort("claude")
      })
      expect(records).toContainEqual({
        level: "change",
        message: `Effort: deployed settings effortLevel set to ${sotEffort("claude")} (SoT default)`
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("owns advisor on/off/default edits without duplicate same-state changes", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-advisor-modifier-"))
    const settings = join(home, ".claude", "settings.json")
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(settings, '{"advisorModel":"fable","userOnly":true}\n')
    const records: Array<LogRecord> = []
    const ctx = modifierCtx(home, records)

    try {
      for (const state of ["off", "default"] as const) {
        records.length = 0
        ctx.nextStepTriggers.claudeRestart = false
        syncClaudeAdvisor(ctx, state)
        expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ userOnly: true })
        expect(records.some(({ level }) => level === "change")).toBe(state === "off")
        expect(ctx.nextStepTriggers.claudeRestart).toBe(state === "off")
      }

      records.length = 0
      ctx.nextStepTriggers.claudeRestart = false
      syncClaudeAdvisor(ctx, "on")
      expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ userOnly: true, advisorModel: "fable" })
      expect(records).toEqual([
        {
          level: "change",
          message: "Advisor: deployed settings advisorModel set to fable (SoT unchanged; flag-less sync reverts)"
        }
      ])
      expect(ctx.nextStepTriggers.claudeRestart).toBe(true)

      records.length = 0
      ctx.nextStepTriggers.claudeRestart = false
      syncClaudeAdvisor(ctx, "on")
      expect(records).toEqual([
        { level: "verbose", message: "Advisor: deployed settings advisorModel already fable" }
      ])
      expect(ctx.nextStepTriggers.claudeRestart).toBe(false)

      records.length = 0
      syncClaudeAdvisor(ctx, "default")
      expect(records.filter(({ level }) => level === "change")).toHaveLength(1)
      expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ userOnly: true })
      expect(ctx.nextStepTriggers.claudeRestart).toBe(true)

      records.length = 0
      ctx.nextStepTriggers.claudeRestart = false
      syncClaudeAdvisor(ctx, "default")
      expect(records).toEqual([
        { level: "verbose", message: "Advisor: deployed settings advisorModel already unset (SoT default: off)" }
      ])
      expect(ctx.nextStepTriggers.claudeRestart).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("leaves invalid JSON untouched and keeps dry-run edits descriptive only", () => {
    const invalidHome = mkdtempSync(join(tmpdir(), "claude-modifier-invalid-"))
    const invalidSettings = join(invalidHome, ".claude", "settings.json")
    mkdirSync(join(invalidHome, ".claude"), { recursive: true })
    writeFileSync(invalidSettings, "{broken\n")
    const invalidRecords: Array<LogRecord> = []
    const invalidCtx = modifierCtx(invalidHome, invalidRecords)

    const dryHome = mkdtempSync(join(tmpdir(), "claude-modifier-dry-"))
    const drySettings = join(dryHome, ".claude", "settings.json")
    mkdirSync(join(dryHome, ".claude"), { recursive: true })
    writeFileSync(drySettings, '{"userOnly":true}\n')
    const dryRecords: Array<LogRecord> = []
    const dryCtx = modifierCtx(dryHome, dryRecords, true)

    try {
      syncClaudeEffort(invalidCtx, "high")
      syncClaudeAdvisor(invalidCtx, "on")
      expect(readFileSync(invalidSettings, "utf8")).toBe("{broken\n")
      expect(existsSync(`${invalidSettings}.tmp`)).toBe(false)
      expect(invalidRecords.filter(({ level }) => level === "err")).toHaveLength(2)
      expect(invalidCtx.nextStepTriggers.claudeRestart).toBe(false)

      syncClaudeEffort(dryCtx, "low")
      syncClaudeAdvisor(dryCtx, "on")
      expect(readFileSync(drySettings, "utf8")).toBe('{"userOnly":true}\n')
      expect(dryRecords).toEqual([
        {
          level: "echo",
          message: `[dry-run] (--claude-effort) set .effortLevel=low in ${drySettings}`
        },
        {
          level: "echo",
          message: `[dry-run] (--claude-advisor) set .advisorModel=fable in ${drySettings}`
        }
      ])
    } finally {
      rmSync(invalidHome, { recursive: true, force: true })
      rmSync(dryHome, { recursive: true, force: true })
    }
  })
})

describe("Codex effort modifier", () => {
  it("keeps every TOML fixture table-stable for none, ultra, and the SoT default", () => {
    const fixtureDir = join(kitHome(), "cli", "test", "fixtures", "codex-toml")
    const fixtures = readdirSync(fixtureDir).filter((name) => name.endsWith(".toml")).sort()
    expect(fixtures).toHaveLength(7)

    for (const fixture of fixtures) {
      const before = readFileSync(join(fixtureDir, fixture), "utf8")
      const firstTable = before.search(/^\[/m)
      const tableBytes = firstTable === -1 ? "" : before.slice(firstTable)
      for (const effort of ["none", "ultra", sotEffort("codex")]) {
        const next = replaceTopLevelSetting(
          before,
          "model_reasoning_effort",
          `model_reasoning_effort = "${effort}"`
        )
        const lines = next.split("\n")
        const effortLines = lines.filter((line) => line.startsWith("model_reasoning_effort ="))
        const firstTableLine = lines.findIndex((line) => line.startsWith("["))
        const effortLine = lines.findIndex((line) => line.startsWith("model_reasoning_effort ="))
        expect(effortLines).toEqual([`model_reasoning_effort = "${effort}"`])
        expect(firstTableLine === -1 || effortLine < firstTableLine).toBe(true)
        if (firstTable !== -1) expect(next.slice(next.search(/^\[/m))).toBe(tableBytes)
      }
    }
  })

  it("sets and resolves deployed effort atomically without repeat-run churn", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-effort-modifier-"))
    const config = join(home, ".codex", "config.toml")
    mkdirSync(join(home, ".codex"), { recursive: true })
    writeFileSync(
      config,
      '# keep\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "low" # stale\nmodel_reasoning_effort = "medium"\n\n[features]\nmemories = true\n'
    )
    const records: Array<LogRecord> = []
    const ctx = modifierCtx(home, records)

    try {
      syncCodexEffort(ctx, "ultra")
      expect(readFileSync(config, "utf8")).toBe(
        '# keep\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "ultra"\n\n[features]\nmemories = true\n'
      )
      expect(records).toEqual([
        {
          level: "change",
          message: "Effort: deployed Codex model_reasoning_effort set to ultra (SoT unchanged; flag-less sync reverts)"
        }
      ])
      expect(ctx.nextStepTriggers.codexRestart).toBe(true)
      expect(existsSync(`${config}.tmp`)).toBe(false)

      records.length = 0
      ctx.nextStepTriggers.codexRestart = false
      syncCodexEffort(ctx, "ultra")
      expect(records).toEqual([
        { level: "verbose", message: "Effort: deployed Codex model_reasoning_effort already ultra" }
      ])
      expect(ctx.nextStepTriggers.codexRestart).toBe(false)

      records.length = 0
      syncCodexEffort(ctx, "default")
      expect(readFileSync(config, "utf8")).toContain(
        `model_reasoning_effort = "${sotEffort("codex")}"`
      )
      expect(records).toEqual([
        {
          level: "change",
          message: `Effort: deployed Codex model_reasoning_effort set to ${sotEffort("codex")} (SoT default)`
        }
      ])

      records.length = 0
      syncCodexEffort(ctx, "none")
      expect(readFileSync(config, "utf8")).toContain('model_reasoning_effort = "none"')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("keeps missing-file and dry-run behavior non-mutating", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-effort-dry-"))
    const records: Array<LogRecord> = []
    const ctx = modifierCtx(home, records)
    const config = join(home, ".codex", "config.toml")

    try {
      syncCodexEffort(ctx, "ultra")
      expect(records).toEqual([
        { level: "warn", message: `(--codex-effort) ${config} missing — skipped` }
      ])

      mkdirSync(join(home, ".codex"), { recursive: true })
      writeFileSync(config, 'model_reasoning_effort = "low"\n')
      records.length = 0
      ctx.dryRun = true
      syncCodexEffort(ctx, "ultra")
      expect(readFileSync(config, "utf8")).toBe('model_reasoning_effort = "low"\n')
      expect(records).toEqual([
        {
          level: "echo",
          message: `[dry-run] (--codex-effort) set model_reasoning_effort = "ultra" in ${config}`
        }
      ])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe.sequential("EngineNative full service injection", () => {
  it("validates raw effort and advisor modifiers before any sync mutation", () => {
    const bareCases = [
      ["claude", "--claude-effort", "Available claude effort levels", "--claude-effort requires a value"],
      ["codex", "--codex-effort", "Available codex effort levels", "--codex-effort requires a value"],
      ["claude", "--claude-advisor", "Available claude advisor states", "--claude-advisor requires a value"]
    ] as const
    for (const [target, flag, catalog, error] of bareCases) {
      const records: Array<LogRecord> = []
      expect(runEngineNative(["sync", target, flag], stubServices(records))).toBe(2)
      expect(records.filter(({ level }) => level === "echo").map(({ message }) => message).join("\n")).toContain(catalog)
      expect(records).toContainEqual({ level: "err", message: expect.stringContaining(error) })
      expect(records.every(({ level }) => level === "echo" || level === "err")).toBe(true)
    }

    const invalidCases = [
      ["claude", "--claude-effort=max", "Available claude effort levels", "Invalid Claude effort 'max'"],
      ["codex", "--codex-effort=future", "Available codex effort levels", "Invalid Codex effort 'future'"],
      ["claude", "--claude-advisor=maybe", "Available claude advisor states", "Invalid Claude advisor state 'maybe'"]
    ] as const
    for (const [target, flag, catalog, error] of invalidCases) {
      const records: Array<LogRecord> = []
      expect(runEngineNative(["sync", target, flag], stubServices(records))).toBe(2)
      expect(records.filter(({ level }) => level === "echo").map(({ message }) => message).join("\n")).toContain(catalog)
      expect(records).toContainEqual({ level: "err", message: expect.stringContaining(error) })
    }
  })

  it("warns and clears effort and advisor modifiers for unselected targets", () => {
    const root = mkdtempSync(join(tmpdir(), "engine-di-modifier-ignore-"))
    const previousHome = process.env["HOME"]
    const previousAgents = process.env["AGENTS_DIR"]
    try {
      process.env["HOME"] = root
      process.env["AGENTS_DIR"] = join(root, ".agents")
      const records: Array<LogRecord> = []
      expect(
        runEngineNative(
          [
            "sync",
            "agents",
            "--dry-run",
            "--claude-effort=low",
            "--claude-advisor=on",
            "--codex-effort=max"
          ],
          stubServices(records)
        )
      ).toBe(0)
      expect(records.filter(({ level }) => level === "warn")).toEqual([
        { level: "warn", message: "--claude-effort ignored: claude target not selected" },
        { level: "warn", message: "--claude-advisor ignored: claude target not selected" },
        { level: "warn", message: "--codex-effort ignored: codex target not selected" }
      ])
      expect(records.some(({ level }) => level === "err")).toBe(false)
    } finally {
      if (previousHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = previousHome
      if (previousAgents === undefined) delete process.env["AGENTS_DIR"]
      else process.env["AGENTS_DIR"] = previousAgents
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("routes manager warnings through the current run logger", () => {
    const root = mkdtempSync(join(tmpdir(), "engine-di-mixed-"))
    const previous = new Map(
      ["HOME", "AGENTS_DIR", "PATH", "DRY_RUN", "DOCKS_KIT_VERBOSE"].map((key) => [key, process.env[key]])
    )
    const constructionWrites: Array<string> = []
    const runRecords: Array<LogRecord> = []

    try {
      process.env["HOME"] = root
      process.env["AGENTS_DIR"] = join(root, ".agents")
      process.env["PATH"] = root
      delete process.env["DRY_RUN"]
      delete process.env["DOCKS_KIT_VERBOSE"]
      const constructed = makeEngineServices({
        sinks: {
          stderr: (chunk) => void constructionWrites.push(chunk),
          stdout: (chunk) => void constructionWrites.push(chunk)
        }
      })
      const services = { ...constructed, logger: new RecordingLogger(runRecords) }

      expect(runEngineNative(["sync", "agents", "--dry-run"], services)).toBe(0)
      expect(constructionWrites).toEqual([])
      expect(runRecords).toContainEqual({
        level: "warn",
        message:
          "npx not installed — ships with Node.js — install via https://nodejs.org (or your package manager) (skipping universal skills bootstrap)"
      })
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("uses the run wrapper as the sole verbosity gate for factory loggers", () => {
    const stderr: Array<string> = []
    const stdout: Array<string> = []
    const factory = makeEngineServices({
      sinks: {
        stderr: (chunk) => void stderr.push(chunk),
        stdout: (chunk) => void stdout.push(chunk)
      }
    })
    const services = { ...factory, deps: stubServices([]).deps }

    expect(runEngineNative(["toolchain", "ensure", "agent-browser"], services)).toBe(0)
    expect(runEngineNative(["toolchain", "ensure", "agent-browser", "--verbose"], services)).toBe(0)
    expect(runEngineNative(["toolchain", "ensure", "agent-browser"], services)).toBe(0)
    expect(stderr).toEqual(["\x1b[1;32m[ok]\x1b[0m agent-browser up to date (0.31.1)\n"])
    expect(stdout).toEqual([])
  })

  it("preserves class-based logger methods and receivers", () => {
    const records: Array<LogRecord> = []
    const services = { ...stubServices([]), logger: new RecordingLogger(records) }

    expect(runEngineNative(["sync", "--unknown"], services)).toBe(2)
    expect(records).toEqual([{ level: "err", message: "Unknown arg: --unknown" }])
  })

  it("captures every in-process branch without real stream writes", () => {
    const root = mkdtempSync(join(tmpdir(), "engine-di-"))
    const stubPath = join(root, "stub-bin")
    mkdirSync(stubPath)
    const envKeys = [
      "HOME",
      "AGENTS_DIR",
      "PATH",
      "DRY_RUN",
      "DOCKS_KIT_VERBOSE",
      "SKIP_RTK",
      "RECONCILE",
      "PRUNE",
      "ASSUME_YES",
      "CLAUDE_COMPACT_WINDOW",
      "CLAUDE_PERMISSIVE",
      "CLAUDE_PLUGINS",
      "CLAUDE_MODEL",
      "CODEX_MODEL",
      "BUN_INSTALL",
      "SHELL"
    ] as const
    const previous = new Map(envKeys.map((key) => [key, process.env[key]]))
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write)
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write)

    const useHome = (name: string): string => {
      const home = join(root, name)
      mkdirSync(home, { recursive: true })
      process.env["HOME"] = home
      process.env["AGENTS_DIR"] = join(home, ".agents")
      return home
    }
    const noBypass = (): void => {
      expect(stdout).not.toHaveBeenCalled()
      expect(stderr).not.toHaveBeenCalled()
      stdout.mockClear()
      stderr.mockClear()
    }

    try {
      process.env["PATH"] = stubPath
      process.env["SHELL"] = "/bin/bash"
      for (const key of envKeys.slice(3, -1)) delete process.env[key]

      // Canonical reproduction: a Codex dry-run is fully visible to the
      // custom logger while the real process streams remain untouched.
      const codexHome = useHome("canonical-codex")
      const codexRecords: Array<LogRecord> = []
      expect(runEngineNative(["sync", "codex", "--dry-run"], stubServices(codexRecords))).toBe(0)
      expect(codexRecords).toEqual([
        { level: "echo", message: "[dry-run] verify bubblewrap installed (recommended Codex Linux sandbox runtime)" },
        {
          level: "echo",
          message: `[dry-run] merge ${kitHome()}/SoT/.codex/config.toml -> ${codexHome}/.codex/config.toml`
        },
        {
          level: "echo",
          message: `[dry-run] cp ${kitHome()}/SoT/.codex/rules/*.rules -> ${codexHome}/.codex/rules/`
        },
        {
          level: "echo",
          message: `[dry-run] cp ${kitHome()}/SoT/.codex/AGENTS.md -> ${codexHome}/.codex/AGENTS.md`
        },
        {
          level: "echo",
          message: `[dry-run] cp ${kitHome()}/SoT/.codex/plugins/marketplace.json -> ${codexHome}/.agents/plugins/marketplace.json`
        },
        {
          level: "echo",
          message: "[dry-run] remove legacy configured Codex Docks marketplace when personal marketplace is deployed"
        },
        { level: "echo", message: "[dry-run] add enabled Codex plugins from SoT" },
        { level: "echo", message: "" },
        { level: "echo", message: "--- Sync complete ---" },
        { level: "echo", message: `Repo:     ${kitHome()}` },
        { level: "echo", message: `Codex:    ${codexHome}/.codex` }
      ])
      noBypass()

      useHome("parse-error")
      const parseRecords: Array<LogRecord> = []
      expect(runEngineNative(["sync", "--unknown"], stubServices(parseRecords))).toBe(2)
      expect(parseRecords).toEqual([{ level: "err", message: "Unknown arg: --unknown" }])
      noBypass()

      useHome("dry-run")
      const dryRecords: Array<LogRecord> = []
      expect(runEngineNative(["sync", "agents", "--dry-run"], stubServices(dryRecords))).toBe(0)
      expect(dryRecords).toEqual([
        {
          level: "echo",
          message: "[dry-run] npx skills@1.5.15 add vercel-labs/agent-browser -g -y -a claude-code codex"
        },
        { level: "echo", message: "[dry-run] agent-browser up to date (0.31.1)" },
        { level: "echo", message: "[dry-run] effect-solutions up to date (0.5.3)" },
        { level: "echo", message: "" },
        { level: "echo", message: "--- Sync complete ---" },
        { level: "echo", message: `Repo:     ${kitHome()}` },
        { level: "echo", message: `Skills:   ${process.env["AGENTS_DIR"]}/skills` }
      ])
      noBypass()

      useHome("missing-dep")
      const missingRecords: Array<LogRecord> = []
      expect(runEngineNative(["sync", "agents"], stubServices(missingRecords, { missing: ["npx"] }))).toBe(0)
      expect(missingRecords).toEqual([
        {
          level: "warn",
          message:
            "npx not installed — ships with Node.js — install via https://nodejs.org (or your package manager) (skipping universal skills bootstrap)"
        },
        { level: "echo", message: "" },
        { level: "echo", message: "--- Sync complete ---" },
        { level: "echo", message: `Repo:     ${kitHome()}` },
        { level: "echo", message: `Skills:   ${process.env["AGENTS_DIR"]}/skills` },
        { level: "echo", message: "          0 universal skill(s) installed" }
      ])
      noBypass()

      const modelHome = useHome("model")
      mkdirSync(join(modelHome, ".claude"), { recursive: true })
      writeFileSync(join(modelHome, ".claude", "settings.json"), '{"model":"sonnet"}\n')
      const modelRecords: Array<LogRecord> = []
      expect(runEngineNative(["model", "claude"], stubServices(modelRecords))).toBe(0)
      expect(modelRecords.slice(0, 3)).toEqual([
        { level: "echo", message: "deployed: sonnet" },
        { level: "echo", message: "SoT:      fable" },
        {
          level: "echo",
          message: expect.stringContaining("Available claude models (kit-verified")
        }
      ])
      expect(modelRecords.every(({ level }) => level === "echo")).toBe(true)
      expect(modelRecords.at(-1)?.message).toContain("full claude-* model IDs outside the catalog")
      noBypass()

      useHome("gate-decline")
      const gateRecords: Array<LogRecord> = []
      const gateServices = stubServices(gateRecords, {
        versions: { "agent-browser": "0.30.0" },
        latest: { "agent-browser": "0.99.0" }
      })
      expect(runEngineNative(["toolchain", "ensure", "agent-browser"], gateServices)).toBe(0)
      expect(gateRecords).toEqual([
        {
          level: "warn",
          message:
            "skipping agent-browser upgrade (latest 0.99.0 is above kit-verified 0.31.1; pass --yes to accept, or update SoT/toolchain.json after testing)"
        }
      ])
      noBypass()

      const dedupWarns: Array<LogRecord> = []
      for (const run of ["dedup-1", "dedup-2"]) {
        useHome(run)
        const runRecords: Array<LogRecord> = []
        expect(runEngineNative(["sync", "agents"], stubServices(runRecords, { missing: ["npx"] }))).toBe(0)
        expect(runRecords.filter(({ level }) => level === "warn")).toHaveLength(1)
        dedupWarns.push(...runRecords.filter(({ level }) => level === "warn"))
        noBypass()
      }
      expect(dedupWarns).toHaveLength(2)

      useHome("verbosity")
      const verboseRecords: Array<LogRecord> = []
      const verboseServices = stubServices(verboseRecords)
      expect(runEngineNative(["toolchain", "ensure", "agent-browser"], verboseServices)).toBe(0)
      expect(runEngineNative(["toolchain", "ensure", "agent-browser", "--verbose"], verboseServices)).toBe(0)
      expect(runEngineNative(["toolchain", "ensure", "agent-browser"], verboseServices)).toBe(0)
      expect(verboseRecords).toEqual([{ level: "verbose", message: "agent-browser up to date (0.31.1)" }])
      noBypass()
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})
