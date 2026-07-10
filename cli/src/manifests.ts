import { readFileSync, readdirSync, readlinkSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { payloadText } from "./payload"

export { homedir }

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
const readJsonText = (text: string): any => JSON.parse(text)

export const modelCatalog = (tool: Tool): ModelCatalog =>
  readJsonText(payloadText("SoT/models.json"))[tool]

export const toolchainManifest = (): Record<string, any> =>
  readJsonText(payloadText("SoT/toolchain.json")).tools

/** SoT settings (claude) — model/effort/env for drift display. */
export const sotClaudeSettings = (): any =>
  readJsonText(payloadText("SoT/.claude/settings.json"))

export const deployedClaudeSettings = (): any | undefined => {
  const p = join(homedir(), ".claude", "settings.json")
  return existsSync(p) ? readJson(p) : undefined
}

const tomlModelText = (text: string): string | undefined => {
  const m = text.match(/^model\s*=\s*"([^"]+)"/m)
  return m?.[1]
}

const tomlModel = (path: string): string | undefined => {
  if (!existsSync(path)) return undefined
  return tomlModelText(readFileSync(path, "utf8"))
}

export const sotCodexModel = (): string | undefined =>
  tomlModelText(payloadText("SoT/.codex/config.toml"))

export const deployedCodexModel = (): string | undefined =>
  tomlModel(join(homedir(), ".codex", "config.toml"))

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
  const declared = payloadText("SoT/.agents/skills.txt")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0)
    .map((slug) => slug.split("/").pop() as string)
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
