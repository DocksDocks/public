/**
 * Port of the model-catalog helpers in lib/common.sh
 * (common::_models_from_manifest / print_models / _validate_claude_model /
 * _validate_codex_model). Message strings are byte-exact.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isObject, parseJson, type Json } from "./jq"
import { warn } from "./output"

function catalog(repoDir: string): Json | undefined {
  try {
    return parseJson(readFileSync(join(repoDir, "SoT", "models.json"), "utf8"))
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

export function printModels(repoDir: string, tool: string): void {
  const entry = toolEntry(repoDir, tool)
  if (entry === undefined) {
    warn(`Model catalog unavailable (${join(repoDir, "SoT", "models.json")})`)
    return
  }
  const verified = typeof entry["verified"] === "string" ? entry["verified"] : "?"
  const lines = [`Available ${tool} models (kit-verified ${verified} — SoT/models.json):`]
  for (const m of modelEntries(repoDir, tool)) {
    const note = typeof m["note"] === "string" ? `  — ${m["note"]}` : ""
    lines.push(`  ${String(m["id"] ?? "")}${note}`)
  }
  if (tool === "claude") lines.push("  (full claude-* model IDs outside the catalog are accepted with a warning)")
  if (tool === "codex") lines.push("  (well-formed IDs outside the catalog are accepted with a warning)")
  process.stderr.write(`${lines.join("\n")}\n`)
}

export function validateClaudeModel(repoDir: string, m: string): boolean {
  if (m === "") return false
  if (modelsFromManifest(repoDir, "claude").includes(m)) return true
  if (m.startsWith("claude-")) {
    warn(`Claude model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway`)
    return true
  }
  return false
}

export function validateCodexModel(repoDir: string, m: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(m)) return false
  if (!modelsFromManifest(repoDir, "codex").includes(m)) {
    warn(
      `Codex model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway (check ~/.codex/config.toml if Codex rejects it)`
    )
  }
  return true
}
