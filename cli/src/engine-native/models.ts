/**
 * Model-catalog helpers: manifest listing plus Claude/Codex model validation.
 * Message strings are covered by the golden suites.
 */
import { p } from "./exec"
import { readFileSync } from "node:fs"

import type { Ctx } from "./index"
import { isObject, parseJson, type Json } from "./jq"

function catalog(repoDir: string): Json | undefined {
  try {
    return parseJson(readFileSync(p(repoDir, "SoT", "models.json"), "utf8"))
  } catch {
    return undefined
  }
}

function toolEntry(repoDir: string, tool: string): { [k: string]: Json } | undefined {
  const doc = catalog(repoDir)
  if (doc === undefined || !isObject(doc)) return undefined
  const entry = doc[tool]
  return entry !== undefined && isObject(entry) ? entry : undefined
}

function modelEntries(repoDir: string, tool: string): Array<{ [k: string]: Json }> {
  const entry = toolEntry(repoDir, tool)
  const models = entry?.["models"]
  return Array.isArray(models) ? models.filter(isObject) : []
}

export function modelsFromManifest(repoDir: string, tool: string): Array<string> {
  return modelEntries(repoDir, tool)
    .map((m) => m["id"])
    .filter((id): id is string => typeof id === "string")
}

export function printModels(ctx: Ctx, tool: string): void {
  const { echo, warn } = ctx.services.logger
  const entry = toolEntry(ctx.repoDir, tool)
  if (entry === undefined) {
    warn(`Model catalog unavailable (${p(ctx.repoDir, "SoT", "models.json")})`)
    return
  }
  const verified = typeof entry["verified"] === "string" ? entry["verified"] : "?"
  const lines = [`Available ${tool} models (kit-verified ${verified} — SoT/models.json):`]
  for (const m of modelEntries(ctx.repoDir, tool)) {
    const note = typeof m["note"] === "string" ? `  — ${m["note"]}` : ""
    lines.push(`  ${String(m["id"] ?? "")}${note}`)
  }
  if (tool === "claude") lines.push("  (full claude-* model IDs outside the catalog are accepted with a warning)")
  if (tool === "codex") lines.push("  (well-formed IDs outside the catalog are accepted with a warning)")
  for (const line of lines) echo(line)
}

export function validateClaudeModel(ctx: Ctx, m: string): boolean {
  if (m === "") return false
  if (modelsFromManifest(ctx.repoDir, "claude").includes(m)) return true
  if (m.startsWith("claude-")) {
    ctx.services.logger.warn(`Claude model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway`)
    return true
  }
  return false
}

export function validateCodexModel(ctx: Ctx, m: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(m)) return false
  if (!modelsFromManifest(ctx.repoDir, "codex").includes(m)) {
    ctx.services.logger.warn(
      `Codex model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway (check ~/.codex/config.toml if Codex rejects it)`
    )
  }
  return true
}
