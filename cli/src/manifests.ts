import { readFileSync, readdirSync, readlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { kitHome } from "./kitHome"

export interface ModelEntry {
  readonly id: string
  readonly kind: "alias" | "id"
  readonly note?: string
}

export interface ModelCatalog {
  readonly verified: string
  readonly models: ReadonlyArray<ModelEntry>
}

export type Tool = "claude" | "codex"

const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"))

export const modelCatalog = (tool: Tool): ModelCatalog =>
  readJson(join(kitHome(), "SoT", "models.json"))[tool]

export const toolchainManifest = (): Record<string, any> =>
  readJson(join(kitHome(), "SoT", "toolchain.json")).tools

/** SoT settings (claude) — model/effort/env for drift display. */
export const sotClaudeSettings = (): any =>
  readJson(join(kitHome(), "SoT", ".claude", "settings.json"))

export const deployedClaudeSettings = (): any | undefined => {
  const p = join(homedir(), ".claude", "settings.json")
  return existsSync(p) ? readJson(p) : undefined
}

const tomlModel = (path: string): string | undefined => {
  if (!existsSync(path)) return undefined
  const m = readFileSync(path, "utf8").match(/^model\s*=\s*"([^"]+)"/m)
  return m?.[1]
}

export const sotCodexModel = (): string | undefined =>
  tomlModel(join(kitHome(), "SoT", ".codex", "config.toml"))

export const deployedCodexModel = (): string | undefined =>
  tomlModel(join(homedir(), ".codex", "config.toml"))

export const homedir = (): string => process.env["HOME"] ?? "~"

/** Installed plugins (user scope) vs SoT enabledPlugins tri-state. */
export const pluginsView = (): Array<{
  plugin: string
  sot: "true" | "false" | "absent"
  installed: boolean
}> => {
  const sot: Record<string, boolean> = sotClaudeSettings().enabledPlugins ?? {}
  const installedPath = join(homedir(), ".claude", "plugins", "installed_plugins.json")
  const installed: Record<string, unknown> = existsSync(installedPath)
    ? readJson(installedPath).plugins ?? {}
    : {}
  const names = new Set([...Object.keys(sot), ...Object.keys(installed)])
  return [...names].sort().map((plugin) => ({
    plugin,
    sot: plugin in sot ? (sot[plugin] ? "true" : "false") : "absent",
    installed: plugin in installed
  }))
}

/** Universal skills: SoT manifest slugs vs ~/.agents/skills contents. */
export const skillsView = (): Array<{
  skill: string
  declared: boolean
  installed: boolean
  claudeSymlink: boolean
}> => {
  const manifestPath = join(kitHome(), "SoT", ".agents", "skills.txt")
  const declared = existsSync(manifestPath)
    ? readFileSync(manifestPath, "utf8")
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter((l) => l.length > 0)
        .map((slug) => slug.split("/").pop() as string)
    : []
  const skillsDir = join(homedir(), ".agents", "skills")
  const installed = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : []
  const names = new Set([...declared, ...installed])
  return [...names].sort().map((skill) => {
    const link = join(homedir(), ".claude", "skills", skill)
    let claudeSymlink = false
    try {
      claudeSymlink = readlinkSync(link).includes(".agents/skills")
    } catch {
      /* not a symlink or missing */
    }
    return {
      skill,
      declared: declared.includes(skill),
      installed: installed.includes(skill),
      claudeSymlink
    }
  })
}
