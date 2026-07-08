/**
 * Ports of the lib/engine.sh direct modes: engine::model and
 * engine::toolchain. Same arg vocabulary, byte-exact messages, same exit
 * codes.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { syncClaudeModel } from "./claudeModel"
import { syncCodexModel } from "./codexToml"
import type { Ctx } from "./index"
import { isObject, parseJson, type Json } from "./jq"
import { printModels, validateClaudeModel, validateCodexModel } from "./models"
import { echo, err, warn } from "./output"
import { ensure, present, report } from "./toolchain"

export function modeModel(ctx: Ctx, args: ReadonlyArray<string>): number {
  let tool = ""
  let value = ""
  for (const arg of args) {
    if (arg === "--dry-run") ctx.dryRun = true
    else if (arg === "claude" || arg === "codex") tool = arg
    else if (arg.startsWith("-")) {
      err(`Unknown flag for model: ${arg}`)
      return 2
    } else value = arg
  }
  if (tool === "") {
    err("Usage: model <claude|codex> [value] [--dry-run]")
    return 2
  }

  if (value === "") {
    if (tool === "claude") {
      const deployed = join(ctx.home, ".claude", "settings.json")
      if (!fileReadable(deployed)) {
        warn("~/.claude/settings.json missing")
        return 0
      }
      echo(`deployed: ${jsonModelField(deployed)}`)
      echo(`SoT:      ${jsonModelField(join(ctx.repoDir, "SoT", ".claude", "settings.json"))}`)
    } else {
      const deployed = join(ctx.home, ".codex", "config.toml")
      if (!fileReadable(deployed)) {
        warn("~/.codex/config.toml missing")
        return 0
      }
      echo(`deployed: ${tomlModelField(deployed)}`)
      echo(`SoT:      ${tomlModelField(join(ctx.repoDir, "SoT", ".codex", "config.toml"))}`)
    }
    printModels(ctx.repoDir, tool)
    return 0
  }

  if (tool === "claude") {
    if (!validateClaudeModel(ctx.repoDir, value)) {
      printModels(ctx.repoDir, "claude")
      err(`Invalid Claude model '${value}'`)
      return 2
    }
    syncClaudeModel(ctx, value)
  } else {
    if (!validateCodexModel(ctx.repoDir, value)) {
      printModels(ctx.repoDir, "codex")
      err(`Invalid Codex model '${value}'`)
      return 2
    }
    syncCodexModel(ctx, value)
  }
  return 0
}

function fileReadable(p: string): boolean {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
}

/** `jq -r '.model // "default (unset)"'` — empty on unparseable input. */
function jsonModelField(file: string): string {
  const doc = parseJson(readFileSync(file, "utf8"))
  if (doc === undefined) return ""
  const v: Json | undefined = isObject(doc) ? doc["model"] : undefined
  if (v === undefined || v === null || v === false) return "default (unset)"
  return typeof v === "string" ? v : JSON.stringify(v)
}

/** `awk -F'"' '/^model[[:space:]]*=/{print $2; exit}'`. */
function tomlModelField(file: string): string {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^model[ \t]*=/.test(line)) return line.split('"')[1] ?? ""
  }
  return ""
}

export function modeToolchain(ctx: Ctx, args: ReadonlyArray<string>): number {
  const op = args[0] ?? "check"
  const tool = args[1] ?? ""
  for (const arg of args) {
    if (arg === "--yes") ctx.assumeYes = true
  }

  if (op === "check") {
    report(ctx)
    return 0
  }
  if (op !== "ensure") {
    err("Usage: toolchain [check|ensure <tool>] [--yes]")
    return 2
  }
  if (tool === "" || tool === "--yes") {
    err("Usage: toolchain ensure <tool> [--yes]")
    return 2
  }
  switch (tool) {
    case "rtk":
    case "effect-solutions":
    case "agent-browser":
      return ensure(ctx, tool, (mode) => {
        err(`EngineNative: ${tool} ${mode} is not ported yet — run with DOCKS_KIT_ENGINE=bash`)
        return 1
      })
    case "bun":
      // skills::_bun_bootstrap >/dev/null — found-bun path prints nothing.
      if (present(ctx, "bun")) return 0
      err("EngineNative: bun bootstrap is not ported yet — run with DOCKS_KIT_ENGINE=bash")
      return 1
    default:
      err("toolchain ensure supports managed tools only (rtk, bun, effect-solutions, agent-browser)")
      return 2
  }
}
