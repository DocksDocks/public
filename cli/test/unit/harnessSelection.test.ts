import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  HARNESSES,
  engineHome,
  harnessStateFile,
  readHarnessSelection,
  writeHarnessSelection,
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
