/**
 * Direct modes for `model` and `toolchain`. Same public argv vocabulary,
 * golden-tested messages, same exit codes.
 */
import { p } from "./exec"
import { readFileSync } from "node:fs"
import { payloadText } from "../payload"

import { syncClaudeModel } from "./claudeSettingsModifiers"
import { syncCodexModel } from "./codexToml"
import type { Ctx } from "./index"
import { isObject, parseJson, type Json } from "./jq"
import { printModels, validateClaudeModel, validateCodexModel } from "./models"
import { bunBootstrap } from "./bun"
import { installedVersion, present, report } from "./toolchain"

export function modeModel(ctx: Ctx, args: ReadonlyArray<string>): number {
  const { echo, err, warn } = ctx.services.logger
  let tool = ""
  let value = ""
  for (const arg of args) {
    if (arg === "--dry-run") ctx.dryRun = true
    else if (arg === "--verbose") {
      ctx.verbose = true
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
      const result = readConfig(deployed)
      if (result.kind === "missing") {
        warn("~/.claude/settings.json missing")
        return 0
      }
      if (result.kind === "read-error") {
        err(`Failed to read ~/.claude/settings.json: ${String(result.error)}`)
        return 1
      }
      echo(`deployed: ${jsonModelText(result.data)}`)
      echo(`SoT:      ${jsonModelText(payloadText("SoT/.claude/settings.json"))}`)
    } else {
      const deployed = p(ctx.home, ".codex", "config.toml")
      const result = readConfig(deployed)
      if (result.kind === "missing") {
        warn("~/.codex/config.toml missing")
        return 0
      }
      if (result.kind === "read-error") {
        err(`Failed to read ~/.codex/config.toml: ${String(result.error)}`)
        return 1
      }
      echo(`deployed: ${tomlModelText(result.data)}`)
      echo(`SoT:      ${tomlModelText(payloadText("SoT/.codex/config.toml"))}`)
    }
    printModels(ctx, tool)
    return 0
  }

  if (tool === "claude") {
    if (!validateClaudeModel(ctx, value)) {
      printModels(ctx, "claude")
      err(`Invalid Claude model '${value}'`)
      return 2
    }
    syncClaudeModel(ctx, value)
  } else {
    if (!validateCodexModel(ctx, value)) {
      printModels(ctx, "codex")
      err(`Invalid Codex model '${value}'`)
      return 2
    }
    syncCodexModel(ctx, value)
  }
  return 0
}

type ConfigReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "read-error"; readonly error: unknown }
  | { readonly kind: "data"; readonly data: string }

function readConfig(file: string): ConfigReadResult {
  try {
    return { kind: "data", data: readFileSync(file, "utf8") }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined
    return code === "ENOENT" ? { kind: "missing" } : { kind: "read-error", error }
  }
}

function jsonModelText(text: string): string {
  const doc = parseJson(text)
  if (doc === undefined) return ""
  const v: Json | undefined = isObject(doc) ? doc["model"] : undefined
  if (v === undefined || v === null || v === false) return "default (unset)"
  return typeof v === "string" ? v : JSON.stringify(v)
}

/** `awk -F'"' '/^model[[:space:]]*=/{print $2; exit}'`. */

function tomlModelText(text: string): string {
  for (const line of text.split("\n")) {
    if (/^model[ \t]*=/.test(line)) return line.split('"')[1] ?? ""
  }
  return ""
}

export async function modeToolchain(ctx: Ctx, args: ReadonlyArray<string>): Promise<number> {
  const { echo, err, verbose } = ctx.services.logger
  const words = args.filter((arg) => !arg.startsWith("--"))
  const op = words[0] ?? "check"
  const tool = words[1] ?? ""
  for (const arg of args) {
    if (arg === "--verbose") ctx.verbose = true
  }

  if (op === "check") {
    await report(ctx)
    return 0
  }
  if (op !== "ensure") {
    err("Usage: toolchain [check|ensure <tool>]")
    return 2
  }
  if (tool === "") {
    err("Usage: toolchain ensure <tool>")
    return 2
  }
  switch (tool) {
    case "bun": {
      // `bun` is the one managed tool, and its bootstrap is silent when Bun is
      // already installed. Probe first so the no-op confirmation the `--verbose`
      // contract promises is not mistaken for a fresh install.
      const alreadyInstalled = present(ctx, "bun")
      if ((await bunBootstrap(ctx, ctx.services)).kind !== "ready") return 1
      if (alreadyInstalled) {
        // A present tool whose --version cannot be read reports `unknown` in the
        // doctor table; keep the same vocabulary rather than an empty pair of
        // parentheses.
        const probed = await installedVersion(ctx, "bun")
        const installed = probed === "" ? "version unknown" : probed
        if (ctx.dryRun) echo(`[dry-run] bun up to date (${installed})`)
        else verbose(`bun up to date (${installed})`)
      }
      return 0
    }
    default:
      err("toolchain ensure supports managed tools only (bun)")
      return 2
  }
}
