/**
 * Direct modes for `model` and `toolchain`. Same public argv vocabulary,
 * golden-tested messages, same exit codes.
 */
import { p } from "./exec"
import { readFileSync } from "node:fs"

import { syncClaudeModel } from "./claudeModel"
import { syncCodexModel } from "./codexToml"
import type { Ctx } from "./index"
import { isObject, parseJson, type Json } from "./jq"
import { printModels, validateClaudeModel, validateCodexModel } from "./models"
import { echo, err, setVerbose, warn } from "./logger"
import { rtkInstall } from "./claudeSync"
import { agentBrowserInstall, bunBootstrap, effectSolutionsInstall } from "./skillsSync"
import { ensure, report } from "./toolchain"

export function modeModel(ctx: Ctx, args: ReadonlyArray<string>): number {
  let tool = ""
  let value = ""
  for (const arg of args) {
    if (arg === "--dry-run") ctx.dryRun = true
    else if (arg === "--verbose") {
      ctx.verbose = true
      setVerbose(true)
    } else if (arg === "claude" || arg === "codex") tool = arg
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
      const deployed = p(ctx.home, ".claude", "settings.json")
      if (!fileReadable(deployed)) {
        warn("~/.claude/settings.json missing")
        return 0
      }
      echo(`deployed: ${jsonModelField(deployed)}`)
      echo(`SoT:      ${jsonModelField(p(ctx.repoDir, "SoT", ".claude", "settings.json"))}`)
    } else {
      const deployed = p(ctx.home, ".codex", "config.toml")
      if (!fileReadable(deployed)) {
        warn("~/.codex/config.toml missing")
        return 0
      }
      echo(`deployed: ${tomlModelField(deployed)}`)
      echo(`SoT:      ${tomlModelField(p(ctx.repoDir, "SoT", ".codex", "config.toml"))}`)
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
  const words = args.filter((a) => !a.startsWith("--"))
  const op = words[0] ?? args[0] ?? "check"
  const tool = words[1] ?? args[1] ?? ""
  for (const arg of args) {
    if (arg === "--yes") ctx.assumeYes = true
    else if (arg === "--verbose") {
      ctx.verbose = true
      setVerbose(true)
    }
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
      return ensure(ctx, "rtk", rtkInstall(ctx))
    case "bun":
      // skills::_bun_bootstrap >/dev/null — the found-bun stdout is discarded.
      return bunBootstrap(ctx) !== "" ? 0 : 1
    case "effect-solutions":
      return ensure(ctx, "effect-solutions", effectSolutionsInstall(ctx))
    case "agent-browser":
      return ensure(ctx, "agent-browser", agentBrowserInstall)
    default:
      err("toolchain ensure supports managed tools only (rtk, bun, effect-solutions, agent-browser)")
      return 2
  }
}
