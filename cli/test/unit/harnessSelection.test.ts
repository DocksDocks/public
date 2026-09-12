import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_OMP_SESSION_MODEL,
  HARNESSES,
  engineHome,
  harnessStateFile,
  readHarnessSelection,
  readOmpSessionModel,
  writeHarnessSelection,
  writeOmpSessionModel,
  type Harness
} from "../../src/engine-native/harnesses"

let home = ""

function writeState(content: string): void {
  mkdirSync(join(home, ".docks-kit"), { recursive: true })
  writeFileSync(harnessStateFile(home), content)
}

describe("harness selection state", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-harness-"))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it("returns undefined when the state file is absent", () => {
    expect(readHarnessSelection(home)).toBeUndefined()
  })

  it("returns undefined without throwing when the state file contains invalid JSON", () => {
    writeState("{invalid")

    expect(() => readHarnessSelection(home)).not.toThrow()
    expect(readHarnessSelection(home)).toBeUndefined()
  })

  it("returns undefined when the state root is an array", () => {
    writeState(JSON.stringify([{ version: 1, harnesses: ["claude"] }]))

    expect(readHarnessSelection(home)).toBeUndefined()
  })

  it("returns undefined when the state version is unsupported", () => {
    writeState(JSON.stringify({ version: 2, harnesses: ["claude"] }))

    expect(readHarnessSelection(home)).toBeUndefined()
  })

  it("returns undefined when the state contains only unknown harness names", () => {
    writeState(JSON.stringify({ version: 1, harnesses: ["unknown"] }))

    expect(readHarnessSelection(home)).toBeUndefined()
  })

  it("skips unknown harness names when a known harness is present", () => {
    writeState(JSON.stringify({ version: 1, harnesses: ["unknown", "codex"] }))

    expect(readHarnessSelection(home)).toEqual(["codex"])
  })

  it("writes and reads harnesses in canonical order without duplicates", () => {
    writeHarnessSelection(home, ["omp", "claude", "omp", "agents", "codex"])

    expect(readHarnessSelection(home)).toEqual(HARNESSES)
  })

  it("refuses to write an empty harness selection", () => {
    expect(() => writeHarnessSelection(home, [])).toThrow(/empty harness selection/i)
  })

  it("refuses to write a selection containing only unknown harness names", () => {
    const unknown = ["unknown"] as unknown as ReadonlyArray<Harness>

    expect(() => writeHarnessSelection(home, unknown)).toThrow(/known harness/i)
  })

  it("writes the state file under the selected home with mode 0600", () => {
    writeHarnessSelection(home, ["claude"])

    const stateFile = harnessStateFile(home)
    expect(stateFile).toBe(`${home}/.docks-kit/state.json`)
    expect(existsSync(stateFile)).toBe(true)
    if (process.platform !== "win32") {
      expect(statSync(stateFile).mode & 0o777).toBe(0o600)
    }
  })

  it("tightens an existing permissive state directory to 0700", () => {
    if (process.platform === "win32") return
    mkdirSync(`${home}/.docks-kit`, { recursive: true, mode: 0o755 })
    chmodSync(`${home}/.docks-kit`, 0o755)

    writeHarnessSelection(home, ["omp"])

    expect(statSync(`${home}/.docks-kit`).mode & 0o777).toBe(0o700)
  })

  it("keeps every state read and write inside the selected home", () => {
    const stateFile = harnessStateFile(home)
    expect(stateFile.startsWith(home)).toBe(true)

    writeHarnessSelection(home, ["agents"])
    expect(readHarnessSelection(home)).toEqual(["agents"])
  })

  it("resolves the engine home from HOME with a homedir fallback", () => {
    expect(engineHome({ HOME: "/fixture/home" })).toBe("/fixture/home")
    expect(engineHome({})).toBe(homedir())
    expect(engineHome({ HOME: "" })).toBe(homedir())
  })
})

describe("omp session model state", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "docks-omp-session-"))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it("keeps a stored ompSession when a harness selection is written", () => {
    writeOmpSessionModel(home, {
      selector: "provider/model-free",
      thinking: "xhigh",
      advisorThinking: "medium",
    })

    writeHarnessSelection(home, ["claude"])

    expect(readOmpSessionModel(home)).toEqual({
      selector: "provider/model-free",
      thinking: "xhigh",
      advisorThinking: "medium",
    })
    expect(readHarnessSelection(home)).toEqual(["claude"])
  })

  it("keeps stored harnesses when an omp session model is written", () => {
    writeHarnessSelection(home, ["codex", "agents"])

    writeOmpSessionModel(home, { selector: "provider/model-free", thinking: "low" })

    expect(readHarnessSelection(home)).toEqual(["codex", "agents"])
    expect(readOmpSessionModel(home)).toEqual({ selector: "provider/model-free", thinking: "low" })
  })

  it("preserves an unknown top-level key across both writers", () => {
    writeHarnessSelection(home, ["claude"])
    const stateFile = harnessStateFile(home)
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>
    writeFileSync(stateFile, `${JSON.stringify({ ...parsed, futureKey: { flag: true } }, null, 2)}\n`)

    writeHarnessSelection(home, ["codex"])
    writeOmpSessionModel(home, { selector: "provider/model-free", thinking: "high" })

    const next = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>
    expect(next["futureKey"]).toEqual({ flag: true })
    expect(readHarnessSelection(home)).toEqual(["codex"])
    expect(readOmpSessionModel(home)).toEqual({ selector: "provider/model-free", thinking: "high" })
  })

  it("returns undefined for a missing state file", () => {
    expect(readOmpSessionModel(home)).toBeUndefined()
  })

  it("returns undefined when ompSession is null", () => {
    writeState(JSON.stringify({ version: 1, ompSession: null }))

    expect(readOmpSessionModel(home)).toBeUndefined()
  })

  it("returns undefined when the selector is blank", () => {
    writeState(JSON.stringify({ version: 1, ompSession: { selector: "  ", thinking: "xhigh" } }))

    expect(readOmpSessionModel(home)).toBeUndefined()
  })

  it("reads a level-free model with both level fields absent", () => {
    writeState(JSON.stringify({ version: 1, ompSession: { selector: "provider/model-free" } }))

    expect(readOmpSessionModel(home)).toEqual({ selector: "provider/model-free" })
  })

  it("drops a blank level while keeping the valid one", () => {
    writeState(
      JSON.stringify({
        version: 1,
        ompSession: { selector: "provider/model-free", thinking: "  ", advisorThinking: "low" },
      }),
    )

    expect(readOmpSessionModel(home)).toEqual({
      selector: "provider/model-free",
      advisorThinking: "low",
    })
  })

  it("round-trips a written model with all three fields", () => {
    writeOmpSessionModel(home, {
      selector: "provider/model-free",
      thinking: "medium",
      advisorThinking: "low",
    })

    expect(readOmpSessionModel(home)).toEqual({
      selector: "provider/model-free",
      thinking: "medium",
      advisorThinking: "low",
    })
  })

  it("round-trips a level-free model with both level fields absent", () => {
    writeOmpSessionModel(home, { selector: "provider/model-free" })

    const stored = readOmpSessionModel(home)
    expect(stored).toEqual({ selector: "provider/model-free" })
    expect(stored).not.toHaveProperty("thinking")
    expect(stored).not.toHaveProperty("advisorThinking")
  })

  it("leaves no stale level behind when a level-free model overwrites a levelled one", () => {
    writeOmpSessionModel(home, {
      selector: "provider/model-free",
      thinking: "xhigh",
      advisorThinking: "medium",
    })

    writeOmpSessionModel(home, { selector: "provider/other-free" })

    const stored = readOmpSessionModel(home)
    expect(stored).toEqual({ selector: "provider/other-free" })
    expect(stored).not.toHaveProperty("thinking")
    expect(stored).not.toHaveProperty("advisorThinking")
  })

  it("rejects a blank selector", () => {
    expect(() => writeOmpSessionModel(home, { selector: "  ", thinking: "xhigh" })).toThrow(/selector/i)
  })

  it("exposes the free session default", () => {
    expect(DEFAULT_OMP_SESSION_MODEL.selector).toBe("opencode-zen/muse-spark-1.3-contributor-free")
    expect(DEFAULT_OMP_SESSION_MODEL.thinking).toBe("xhigh")
    expect(DEFAULT_OMP_SESSION_MODEL.advisorThinking).toBe("medium")
  })

  it("writes the state file and directory with private modes", () => {
    writeOmpSessionModel(home, { selector: "provider/model-free", thinking: "xhigh" })

    expect(existsSync(harnessStateFile(home))).toBe(true)
    if (process.platform !== "win32") {
      expect(statSync(harnessStateFile(home)).mode & 0o777).toBe(0o600)
      expect(statSync(join(home, ".docks-kit")).mode & 0o777).toBe(0o700)
    }
  })
})
