/**
 * Line-based Codex TOML passes: top-level setting replacement, the SoT
 * top-level and table merges used by `sync codex`, and `--codex-model` /
 * `--codex-effort`. A TOML library would reformat user configs and break the
 * golden contract. The key is used as a raw regex fragment, preserving the
 * historical record-oriented behavior.
 */
import { p } from "./exec"
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import { resolveEffort } from "../efforts"
import type { Ctx } from "./index"

export function replaceTopLevelSetting(content: string, key: string, replacement: string): string {
  const lines = content.split("\n")
  if (lines[lines.length - 1] === "") lines.pop() // awk records exclude a trailing empty split artifact
  const keyRe = new RegExp(`^${key}[ \\t]*=`)
  const out: Array<string> = []
  let inTable = false
  let replaced = false
  for (const line of lines) {
    if (line.startsWith("[")) {
      if (!replaced) {
        out.push(replacement)
        replaced = true
      }
      inTable = true
      out.push(line)
      continue
    }
    if (!inTable && keyRe.test(line)) {
      if (!replaced) {
        out.push(replacement)
        replaced = true
      }
      continue
    }
    out.push(line)
  }
  if (!replaced) out.push(replacement)
  return `${out.join("\n")}\n`
}

export function replaceTopLevelSettingInFile(file: string, key: string, replacement: string): boolean {
  const before = readFileSync(file, "utf8")
  const next = replaceTopLevelSetting(before, key, replacement)
  if (next === before) return false
  writeFileSync(`${file}.tmp`, next)
  renameSync(`${file}.tmp`, file)
  return true
}

interface CodexSettingEdit {
  readonly tag: string
  readonly key: "model" | "model_reasoning_effort"
  readonly value: string
  readonly changed: string
  readonly unchanged: string
}

function syncCodexSetting(ctx: Ctx, edit: CodexSettingEdit): void {
  const { change, echo, verbose, warn } = ctx.services.logger
  const userCodexSettings = p(ctx.home, ".codex", "config.toml")

  if (!existsSync(userCodexSettings)) {
    // A dry-run sync already previewed installing the file, so the edit is not skipped.
    // The `docks-kit model codex <m>` command creates no file, so the skip stands.
    if (ctx.dryRun && ctx.syncCodex) {
      echo(`[dry-run] (${edit.tag}) set ${edit.key} = "${edit.value}" in ${userCodexSettings}`)
      return
    }
    warn(`(${edit.tag}) ${userCodexSettings} missing — skipped`)
    return
  }

  if (ctx.dryRun) {
    echo(`[dry-run] (${edit.tag}) set ${edit.key} = "${edit.value}" in ${userCodexSettings}`)
    return
  }

  if (replaceTopLevelSettingInFile(userCodexSettings, edit.key, `${edit.key} = "${edit.value}"`)) {
    change(edit.changed)
    ctx.nextStepTriggers.codexRestart = true
  } else {
    verbose(edit.unchanged)
  }
}

export function syncCodexModel(ctx: Ctx, model: string): void {
  if (model === "") return
  syncCodexSetting(ctx, {
    tag: "--codex-model",
    key: "model",
    value: model,
    changed: `Model: deployed Codex model set to ${model} (SoT unchanged; flag-less sync reverts)`,
    unchanged: `Model: deployed Codex model already ${model}`
  })
}

export function syncCodexEffort(ctx: Ctx, effort: string): void {
  if (effort === "") return
  const resolved = resolveEffort("codex", effort)
  const useDefault = effort === "default"
  syncCodexSetting(ctx, {
    tag: "--codex-effort",
    key: "model_reasoning_effort",
    value: resolved,
    changed: useDefault
      ? `Effort: deployed Codex model_reasoning_effort set to ${resolved} (SoT default)`
      : `Effort: deployed Codex model_reasoning_effort set to ${resolved} (SoT unchanged; flag-less sync reverts)`,
    unchanged: `Effort: deployed Codex model_reasoning_effort already ${resolved}`
  })
}

export function mergeTopLevelSettings(sotConfigText: string, userConfig: string): void {
  for (const line of sotConfigText.split("\n")) {
    if (line.startsWith("[")) break
    if (/^[ \t]*($|#)/.test(line)) continue
    if (!/^[A-Za-z0-9_.-]+[ \t]*=/.test(line)) continue
    const key = line.slice(0, line.indexOf("=")).replace(/[ \t]+$/, "")
    replaceTopLevelSettingInFile(userConfig, key, line)
  }
}

interface TomlTableHeader {
  readonly path: string
}

const TOML_BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\"
}

function tomlBasicEscape(line: string, offset: number): { readonly next: number; readonly value: string } | undefined {
  const escaped = line[offset]
  const simple = escaped === undefined ? undefined : TOML_BASIC_ESCAPES[escaped]
  if (simple !== undefined) return { next: offset + 1, value: simple }
  const digits = escaped === "u" ? 4 : escaped === "U" ? 8 : 0
  if (digits === 0) return undefined
  const hex = line.slice(offset + 1, offset + 1 + digits)
  if (hex.length !== digits || !/^[0-9A-Fa-f]+$/.test(hex)) return undefined
  const codePoint = Number.parseInt(hex, 16)
  if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return undefined
  return { next: offset + 1 + digits, value: String.fromCodePoint(codePoint) }
}

/** Decode a table header to the TOML path that determines managed ownership. */
function tomlTableHeader(line: string): TomlTableHeader | undefined {
  let offset = 0
  const skipWhitespace = (): void => {
    while (line[offset] === " " || line[offset] === "\t") offset++
  }

  skipWhitespace()
  if (line[offset] !== "[") return undefined
  offset++
  const array = line[offset] === "["
  if (array) offset++

  const keys: Array<string> = []
  while (true) {
    skipWhitespace()
    const quote = line[offset]
    let key = ""
    if (quote === '"' || quote === "'") {
      offset++
      let closed = false
      while (offset < line.length) {
        const char = line[offset]!
        if (char === quote) {
          offset++
          closed = true
          break
        }
        if (quote === '"' && char === "\\") {
          const escape = tomlBasicEscape(line, offset + 1)
          if (escape === undefined) return undefined
          key += escape.value
          offset = escape.next
          continue
        }
        if (char === "\n" || char === "\r") return undefined
        key += char
        offset++
      }
      if (!closed) return undefined
    } else {
      const start = offset
      while (offset < line.length && /[A-Za-z0-9_-]/.test(line[offset]!)) offset++
      if (offset === start) return undefined
      key = line.slice(start, offset)
    }
    keys.push(key)

    skipWhitespace()
    if (line[offset] === ".") {
      offset++
      continue
    }
    if (line[offset] !== "]") return undefined
    offset++
    if (array) {
      if (line[offset] !== "]") return undefined
      offset++
    }
    skipWhitespace()
    if (offset < line.length && line[offset] !== "#") return undefined
    return { path: JSON.stringify(keys) }
  }
}

function mergeTableSettingsText(sotConfigText: string, userConfigText: string): string {
  const sotLines = sotConfigText.split("\n")
  let merged = userConfigText
  for (let tableOffset = 0; tableOffset < sotLines.length; tableOffset++) {
    const managedHeader = tomlTableHeader(sotLines[tableOffset]!)
    if (managedHeader === undefined) continue

    const block: Array<string> = []
    for (let blockOffset = tableOffset; blockOffset < sotLines.length; blockOffset++) {
      const line = sotLines[blockOffset]!
      if (blockOffset !== tableOffset && tomlTableHeader(line) !== undefined) break
      block.push(line)
    }
    const tableBlock = block.join("\n").replace(/\n+$/, "")

    const userLines = merged.split("\n")
    if (userLines[userLines.length - 1] === "") userLines.pop()
    let skip = false
    const kept: Array<string> = []
    for (const line of userLines) {
      const header = tomlTableHeader(line)
      if (header !== undefined) {
        skip = header.path === managedHeader.path
        if (skip) continue
      }
      if (!skip) kept.push(line)
    }
    merged = `${kept.join("\n")}\n\n${tableBlock}\n`
  }
  return merged
}

export function mergeTableSettings(sotConfigText: string, userConfig: string): void {
  const next = mergeTableSettingsText(sotConfigText, readFileSync(userConfig, "utf8"))
  writeFileSync(`${userConfig}.tmp`, next)
  renameSync(`${userConfig}.tmp`, userConfig)
}
