import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import type * as NodeOs from "node:os"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type * as Payload from "../../src/payload"

const mocks = vi.hoisted<{ home: string; codexConfig: string | undefined }>(() => ({
  home: "",
  codexConfig: undefined
}))

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof NodeOs>("node:os")
  return { ...actual, homedir: () => mocks.home }
})

vi.mock("../../src/payload", async () => {
  const actual = await vi.importActual<typeof Payload>("../../src/payload")
  return {
    ...actual,
    payloadText: (path: Parameters<typeof actual.payloadText>[0]) =>
      path === "SoT/.codex/config.toml" && mocks.codexConfig !== undefined
        ? mocks.codexConfig
        : actual.payloadText(path)
  }
})

import { sotEffort } from "../../src/efforts"
import { pluginsView, skillsView, sotCodexModel } from "../../src/manifests"

describe("manifest resolvers", () => {
  it("ignores a table-scoped model when the top-level model is absent", () => {
    mocks.codexConfig = '[profiles.audit]\nmodel = "table-model"\n'
    expect(sotCodexModel()).toBeUndefined()
  })

  it("ignores a table-scoped reasoning effort when the top-level effort is absent", () => {
    mocks.codexConfig = '[profiles.audit]\nmodel_reasoning_effort = "high"\n'
    expect(() => sotEffort("codex")).toThrow(
      "Embedded SoT Codex model_reasoning_effort is missing"
    )
  })

  it("uses only user-scope plugin records as installed", () => {
    const home = mkdtempSync(join(tmpdir(), "docks-manifests-"))
    const pluginsDir = join(home, ".claude", "plugins")
    mkdirSync(pluginsDir, { recursive: true })
    writeFileSync(
      join(pluginsDir, "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "project-only@test": [{ scope: "project" }],
          "user@test": [{ scope: "user" }]
        }
      })
    )
    mocks.home = home
    try {
      const view = pluginsView()
      expect(view.find(({ plugin }) => plugin === "project-only@test")?.installed).toBe(false)
      expect(view.find(({ plugin }) => plugin === "user@test")?.installed).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("does not report a dangling skill link whose target contains the skills path fragment", () => {
    const home = mkdtempSync(join(tmpdir(), "docks-manifests-"))
    const agentsSkills = join(home, ".agents", "skills")
    const claudeSkills = join(home, ".claude", "skills")
    mkdirSync(join(agentsSkills, "dangling"), { recursive: true })
    mkdirSync(join(agentsSkills, "valid"), { recursive: true })
    mkdirSync(claudeSkills, { recursive: true })
    symlinkSync(join(agentsSkills, "missing"), join(claudeSkills, "dangling"), "dir")
    symlinkSync(join(agentsSkills, "valid"), join(claudeSkills, "valid"), "dir")
    mocks.home = home
    try {
      const view = skillsView()
      expect(view.find(({ skill }) => skill === "dangling")?.claudeSymlink).toBe(false)
      expect(view.find(({ skill }) => skill === "valid")?.claudeSymlink).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
