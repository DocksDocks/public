/**
 * Verified-version-floor layer over SoT/toolchain.json. Probe commands spawn
 * deterministic argv arrays and are covered by golden regression cases.
 */
import type { ToolId } from "./deps"
import type { Ctx } from "./index"
import { compareCodepoints, isObject, parseJson, type Json } from "./jq"
import { payloadText } from "../payload"
import { hostOs } from "./os"

function manifest(): { [k: string]: Json } {
  const doc = parseJson(payloadText("SoT/toolchain.json"))
  const tools = doc !== undefined && isObject(doc) ? doc["tools"] : undefined
  return tools !== undefined && isObject(tools) ? tools : {}
}

export function field(ctx: Ctx, tool: string, name: string): string {
  const entry = manifest()[tool]
  if (entry === undefined || !isObject(entry)) return ""
  const v = entry[name]
  return v === undefined || v === null ? "" : String(v)
}

/** toolchain::_is_newer — numeric per dotted field, GNU-sort last-resort tie-break. */
export function isNewer(a: string, b: string): boolean {
  if (a === "" || b === "" || a === b) return false
  const fa = a.split(".")
  const fb = b.split(".")
  for (let i = 0; i < 3; i++) {
    const na = parseInt(fa[i] ?? "", 10) || 0
    const nb = parseInt(fb[i] ?? "", 10) || 0
    if (na !== nb) return na > nb
  }
  return compareCodepoints(a, b) > 0
}

export function present(ctx: Ctx, tool: ToolId): boolean {
  return ctx.services.deps.probe(tool).state === "present"
}

function firstLineField(out: string, index: number): string {
  const fields = (out.split("\n")[0] ?? "").trim().split(/[ \t]+/)
  return fields[index === -1 ? fields.length - 1 : index] ?? ""
}

export async function installedVersion(ctx: Ctx, tool: ToolId): Promise<string> {
  const version = () => ctx.services.deps.version(tool)
  switch (tool) {
    case "claude":
      return firstLineField(await version(), 0)
    case "codex":
      return firstLineField(await version(), -1)
    case "git":
      return firstLineField(await version(), 2)
    case "node":
      return (await version()).replace(/^v/, "")
    case "jq":
      return (await version()).replace(/^jq-/, "")
    case "curl":
    case "tsc":
      return firstLineField(await version(), 1)
    case "bun":
    case "omp":
    case "npm":
      return await version()
    case "bwrap":
      return firstLineField(await version(), 1)
    case "ffplay":
      return firstLineField(await version(), 2).replace(/-.*$/, "")
    case "intelephense":
    case "typescript-language-server":
      return (await version()).trim()
    default:
      return ""
  }
}

function row(cells: [string, string, string, string, string, string]): string {
  const widths = [28, 9, 14, 9, 9]
  return cells.map((c, i) => (i < widths.length ? c.padEnd(widths[i]!) : c)).join(" ")
}

export async function report(ctx: Ctx): Promise<void> {
  const { echo } = ctx.services.logger
  echo(row(["TOOL", "KIND", "INSTALLED", "FLOOR", "VERIFIED", "STATUS"]))
  const pn = ctx.services.platform.name()
  const platformOs = hostOs(pn).toolchainOs
  for (const tool of Object.keys(manifest()).sort(compareCodepoints)) {
    const os = field(ctx, tool, "os")
    if (os !== "" && platformOs !== "" && os !== platformOs) continue
    const kind = field(ctx, tool, "kind")
    const floor = field(ctx, tool, "floor")
    const verified = field(ctx, tool, "verified")
    const dash = (v: string): string => (v !== "" ? v : "-")
    if (kind === "pin") {
      const via = field(ctx, tool, "via")
      echo(row([tool, kind, `(${via !== "" ? via : "npx"})`, dash(floor), dash(verified), "pinned"]))
      continue
    }
    let installed: string
    let status: string
    const toolId = tool as ToolId
    if (present(ctx, toolId)) {
      installed = await installedVersion(ctx, toolId)
      status = installed === "" ? "unknown" : "ok"
      if (floor !== "" && installed !== "" && isNewer(floor, installed)) {
        status = "below-floor"
      } else if (verified !== "" && installed !== "" && isNewer(installed, verified)) {
        status = "above-verified"
      }
      installed = installed !== "" ? installed : "?"
    } else {
      installed = "-"
      status = "missing"
    }
    echo(row([tool, dash(kind), installed, dash(floor), dash(verified), status]))
  }
}
