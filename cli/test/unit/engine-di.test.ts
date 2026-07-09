import { describe, expect, it, vi } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runEngineNative } from "../../src/engine-native"
import { DEPENDENCIES, type ToolId } from "../../src/engine-native/deps"
import { makePlatform, type DependencyManager, type EngineServices, type Logger } from "../../src/engine-native/services"
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
        : { state: "present", version: "", path: `/stub-bin/${id}` },
    version: (id) => versions[id] ?? "",
    path: (id) => (missing.has(id) ? "" : `/stub-bin/${id}`),
    latest: (id) => latest[id] ?? "",
    warnMissing: (id, context) => {
      if (warned.has(id)) return
      warned.add(id)
      const suffix = context !== undefined && context !== "" ? ` (${context})` : ""
      logger.warn(`${id} not installed — ${DEPENDENCIES[id].installHint(platform.raw())}${suffix}`)
    }
  }
  return { logger, deps, platform }
}

describe("EngineNative full service injection", () => {
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
        { level: "echo", message: "SoT:      opus" },
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
