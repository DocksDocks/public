import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ompPaths, type OmpPaths } from "../../src/engine-native/ompPaths"

let sandbox = ""
let home = ""

/** home is a sandbox directory, never the working directory, so a path joined
 * against the wrong anchor cannot pass by coincidence. */
const paths = (env: Record<string, string | undefined>, platform: NodeJS.Platform = "linux"): OmpPaths =>
  ompPaths({ home, env, platform })

const expectedDefault = (configRoot: string): OmpPaths => ({
  profile: undefined,
  configRoot,
  agentDir: `${configRoot}/agent`,
  dataRoot: configRoot
})

describe("omp path resolution", () => {
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "docks-omp-paths-"))
    home = join(sandbox, "home")
  })

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true })
  })

  it("uses the home config root for the default profile with no overrides", () => {
    expect(paths({})).toEqual(expectedDefault(`${home}/.omp`))
  })

  it("treats PI_CONFIG_DIR as a root dirname under home, never a working-directory path", () => {
    expect(paths({ PI_CONFIG_DIR: ".omp-alt" })).toEqual(expectedDefault(`${home}/.omp-alt`))
    expect(paths({ PI_CONFIG_DIR: "" })).toEqual(expectedDefault(`${home}/.omp`))
  })

  it("relocates the whole config root under a named profile", () => {
    expect(paths({ OMP_PROFILE: "work" })).toEqual({
      profile: "work",
      configRoot: `${home}/.omp/profiles/work`,
      agentDir: `${home}/.omp/profiles/work/agent`,
      dataRoot: `${home}/.omp/profiles/work`
    })
  })

  it("honors PI_CODING_AGENT_DIR for the default profile and ignores it under a named profile", () => {
    const override = join(sandbox, "custom-agent")

    expect(paths({ PI_CODING_AGENT_DIR: override })).toEqual({
      ...expectedDefault(`${home}/.omp`),
      agentDir: override
    })
    expect(paths({ PI_CODING_AGENT_DIR: override, OMP_PROFILE: "work" }).agentDir)
      .toBe(`${home}/.omp/profiles/work/agent`)
  })

  it("resolves a relative PI_CODING_AGENT_DIR against the working directory", () => {
    expect(paths({ PI_CODING_AGENT_DIR: "rel-agent" }).agentDir).toBe(resolve(process.cwd(), "rel-agent"))
  })

  it("treats an explicitly empty OMP_PROFILE as the default instead of using PI_PROFILE", () => {
    expect(paths({ OMP_PROFILE: "", PI_PROFILE: "legacy" }).profile).toBeUndefined()
    expect(paths({ PI_PROFILE: "legacy" }).profile).toBe("legacy")
    expect(paths({ OMP_PROFILE: "primary", PI_PROFILE: "legacy" }).profile).toBe("primary")
  })

  it.each(["   ", "default", "..", "trailing.", "Upper", "has space", "CON", "nul.txt"])(
    "degrades the invalid or reserved profile %j to the default profile",
    (profile) => {
      expect(paths({ OMP_PROFILE: profile }).profile).toBeUndefined()
    }
  )

  it("adopts the XDG data root for the default profile only after its omp directory exists", () => {
    const dataHome = join(sandbox, "xdg-data")
    mkdirSync(dataHome)

    expect(paths({ XDG_DATA_HOME: dataHome }).dataRoot).toBe(`${home}/.omp`)

    mkdirSync(join(dataHome, "omp"))
    expect(paths({ XDG_DATA_HOME: dataHome }).dataRoot).toBe(`${dataHome}/omp`)
  })

  it("keeps the agent directory out of XDG even when the data root moves", () => {
    const dataHome = join(sandbox, "xdg-data")
    mkdirSync(join(dataHome, "omp"), { recursive: true })

    expect(paths({ XDG_DATA_HOME: dataHome })).toEqual({
      profile: undefined,
      configRoot: `${home}/.omp`,
      agentDir: `${home}/.omp/agent`,
      dataRoot: `${dataHome}/omp`
    })
  })

  it("keys a named profile on its own XDG profile directory and adopts that path", () => {
    const dataHome = join(sandbox, "xdg-data")
    mkdirSync(join(dataHome, "omp"), { recursive: true })
    const env = { XDG_DATA_HOME: dataHome, OMP_PROFILE: "work" }

    // The base app root exists, but the profile path does not: the profile
    // stays where it was first activated.
    expect(paths(env).dataRoot).toBe(`${home}/.omp/profiles/work`)

    mkdirSync(join(dataHome, "omp", "profiles", "work"), { recursive: true })
    expect(paths(env).dataRoot).toBe(`${dataHome}/omp/profiles/work`)
  })

  it("disables XDG while a PI_CODING_AGENT_DIR override is active", () => {
    const dataHome = join(sandbox, "xdg-data")
    mkdirSync(join(dataHome, "omp"), { recursive: true })
    const override = join(sandbox, "custom-agent")

    expect(paths({ XDG_DATA_HOME: dataHome, PI_CODING_AGENT_DIR: override }).dataRoot).toBe(`${home}/.omp`)
  })

  it("keeps XDG active when PI_CONFIG_DIR renames the config root", () => {
    const dataHome = join(sandbox, "xdg-data")
    mkdirSync(join(dataHome, "omp"), { recursive: true })

    expect(paths({ XDG_DATA_HOME: dataHome, PI_CONFIG_DIR: ".omp-alt" })).toEqual({
      profile: undefined,
      configRoot: `${home}/.omp-alt`,
      agentDir: `${home}/.omp-alt/agent`,
      dataRoot: `${dataHome}/omp`
    })
  })

  it("ignores XDG outside Linux and macOS", () => {
    const dataHome = join(sandbox, "xdg-data")
    mkdirSync(join(dataHome, "omp"), { recursive: true })
    const env = { XDG_DATA_HOME: dataHome }

    expect(paths(env, "darwin").dataRoot).toBe(`${dataHome}/omp`)
    expect(paths(env, "win32").dataRoot).toBe(`${home}/.omp`)
  })
})
