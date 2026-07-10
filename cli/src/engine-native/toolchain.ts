/**
 * Verified-version-floor layer over SoT/toolchain.json. Probe/install commands
 * spawn deterministic argv arrays and are covered by golden regression cases.
 */
import { readSync } from "node:fs"

import type { ToolId } from "./deps"
import type { Ctx } from "./index"
import { compareCodepoints, isObject, parseJson, type Json } from "./jq"
import type { EngineServices } from "./services"
import { payloadText } from "../payload"

type InstallFn = (mode: "install" | "upgrade", version: string, services: EngineServices) => number

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

export function installedVersion(ctx: Ctx, tool: ToolId): string {
  const version = (): string => ctx.services.deps.version(tool)
  switch (tool) {
    case "rtk":
      return firstLineField(version(), 1)
    case "claude":
      return firstLineField(version(), 0)
    case "codex":
    case "agent-browser":
      return firstLineField(version(), -1)
    case "git":
      return firstLineField(version(), 2)
    case "node":
      return version().replace(/^v/, "")
    case "jq":
      return version().replace(/^jq-/, "")
    case "curl":
    case "tsc":
      return firstLineField(version(), 1)
    case "bun":
    case "effect-solutions":
    case "npm":
      return version()
    default:
      return ""
  }
}

export function latestVersion(ctx: Ctx, tool: ToolId): string {
  return ctx.services.deps.latest(tool)
}

/** Blocking TTY prompt matching bash `read -r -p` (prompt on stderr). */
export function promptLine(
  prompt: string,
  write: (chunk: string) => void = (chunk) => void process.stderr.write(chunk),
  readByte: (buffer: Buffer) => number = (buffer) => readSync(0, buffer, 0, 1, null)
): string {
  write(prompt)
  const buf = Buffer.alloc(1)
  let line = ""
  for (;;) {
    let n: number
    try {
      n = readByte(buf)
    } catch {
      break
    }
    if (n === 0) break
    const ch = buf.toString("utf8")
    if (ch === "\n") break
    line += ch
  }
  return line.replace(/\r$/, "")
}

/** toolchain::_gate — { proceed, target } ("" target = latest). */
function gate(ctx: Ctx, tool: string, mode: "install" | "upgrade", latest: string): { proceed: boolean; target: string } {
  const { warn } = ctx.services.logger
  const verified = field(ctx, tool, "verified")
  const pinnable = field(ctx, tool, "pinnable")

  if (verified === "" || !isNewer(latest, verified)) return { proceed: true, target: "" }

  if (ctx.assumeYes) {
    warn(`${tool} ${latest} is newer than kit-verified ${verified} — proceeding (--yes)`)
    return { proceed: true, target: "" }
  }

  if (process.stdin.isTTY === true) {
    ctx.services.logger.warn(`${tool} ${latest} is not kit-verified (verified: ${verified}).`)
    const answer = promptLine(`Install ${tool} ${latest} anyway? [y/N] `)
    if (/^[yY]/.test(answer)) return { proceed: true, target: "" }
  }

  if (mode === "install" && pinnable === "true") {
    warn(`installing kit-verified ${tool} ${verified} instead of ${latest}`)
    return { proceed: true, target: verified }
  }
  warn(
    `skipping ${tool} ${mode} (latest ${latest} is above kit-verified ${verified}; pass --yes to accept, or update SoT/toolchain.json after testing)`
  )
  return { proceed: false, target: "" }
}

export function ensure(ctx: Ctx, tool: ToolId, installFn: InstallFn): number {
  const { echo, verbose, warn } = ctx.services.logger
  const policy = field(ctx, tool, "policy")

  if (!present(ctx, tool)) {
    const latest = latestVersion(ctx, tool)
    if (ctx.dryRun) {
      echo(`[dry-run] would install ${tool} (${latest !== "" ? latest : "latest"}, gated by toolchain.json verified pin)`)
      return 0
    }
    let target: string
    if (latest === "") {
      target = field(ctx, tool, "verified")
      if (target !== "" && field(ctx, tool, "pinnable") === "true") {
        warn(`${tool} latest version unknown (offline?) — installing kit-verified ${target} instead`)
      } else {
        target = ""
        warn(`${tool} latest version unknown (offline?) and not pinnable — installing latest unverified`)
      }
    } else {
      const g = gate(ctx, tool, "install", latest)
      if (!g.proceed) return 0
      target = g.target
    }
    return installFn("install", target !== "" ? target : latest, ctx.services)
  }

  const installed = installedVersion(ctx, tool)
  const installedLabel = installed !== "" ? installed : "version unknown"

  if (policy !== "track") {
    if (ctx.dryRun) {
      echo(`[dry-run] ${tool} present (${installedLabel})`)
      return 0
    }
    verbose(`${tool} present (${installedLabel})`)
    return 0
  }

  const latest = latestVersion(ctx, tool)
  if (latest === "") {
    if (ctx.dryRun) {
      echo(`[dry-run] ${tool} present (${installedLabel}); latest unknown (offline?) — no action`)
      return 0
    }
    verbose(`${tool} present (${installedLabel}; latest unknown — no action)`)
    return 0
  }

  if (installed === "" || isNewer(latest, installed)) {
    if (ctx.dryRun) {
      echo(`[dry-run] would upgrade ${tool} (${installed !== "" ? installed : "unknown"} -> ${latest}, gated by toolchain.json verified pin)`)
      return 0
    }
    const g = gate(ctx, tool, "upgrade", latest)
    if (!g.proceed) return 0
    return installFn("upgrade", g.target !== "" ? g.target : latest, ctx.services)
  }

  if (ctx.dryRun) {
    echo(`[dry-run] ${tool} up to date (${installed})`)
    return 0
  }
  verbose(`${tool} up to date (${installed})`)
  return 0
}

function row(cells: [string, string, string, string, string, string]): string {
  const widths = [28, 9, 14, 9, 9]
  return cells.map((c, i) => (i < widths.length ? c.padEnd(widths[i]!) : c)).join(" ")
}

export function report(ctx: Ctx): void {
  const { echo } = ctx.services.logger
  echo(row(["TOOL", "KIND", "INSTALLED", "FLOOR", "VERIFIED", "STATUS"]))
  const pn = ctx.services.platform.name()
  const platformOs = pn === "unknown" ? "" : pn
  for (const tool of Object.keys(manifest()).sort(compareCodepoints)) {
    const os = field(ctx, tool, "os")
    if (os !== "" && platformOs !== "" && os !== platformOs) continue
    const kind = field(ctx, tool, "kind")
    const floor = field(ctx, tool, "floor")
    const verified = field(ctx, tool, "verified")
    const dash = (v: string): string => (v !== "" ? v : "-")
    if (kind === "pin") {
      echo(row([tool, kind, "(npx)", dash(floor), dash(verified), "pinned"]))
      continue
    }
    let installed: string
    let status: string
    const toolId = tool as ToolId
    if (present(ctx, toolId)) {
      installed = installedVersion(ctx, toolId)
      status = "ok"
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
