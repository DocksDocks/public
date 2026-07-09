/**
 * Verified-version-floor layer over SoT/toolchain.json. Probe/install commands
 * spawn deterministic argv arrays and are covered by golden regression cases.
 */
import { readFileSync, readSync } from "node:fs"

import { capture, commandExists, isExecutable, p } from "./exec"
import type { Ctx } from "./index"
import { compareCodepoints, isObject, parseJson, type Json } from "./jq"
import { echo, log, warn } from "./output"

type InstallFn = (mode: "install" | "upgrade", version: string) => number

function manifest(ctx: Ctx): { [k: string]: Json } {
  const doc = parseJson(readFileSync(p(ctx.repoDir, "SoT", "toolchain.json"), "utf8"))
  const tools = doc !== undefined && isObject(doc) ? doc["tools"] : undefined
  return tools !== undefined && isObject(tools) ? tools : {}
}

export function field(ctx: Ctx, tool: string, name: string): string {
  const entry = manifest(ctx)[tool]
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

export function present(ctx: Ctx, tool: string): boolean {
  if (tool === "bun") {
    return (
      commandExists("bun") ||
      isExecutable(p(process.env["BUN_INSTALL"] ?? p(ctx.home, ".bun"), "bin", "bun")) ||
      isExecutable(p(ctx.home, ".bun", "bin", "bun"))
    )
  }
  return commandExists(tool)
}

function firstLineField(out: string, index: number): string {
  const fields = (out.split("\n")[0] ?? "").trim().split(/[ \t]+/)
  return fields[index === -1 ? fields.length - 1 : index] ?? ""
}

export function installedVersion(ctx: Ctx, tool: string): string {
  if (!present(ctx, tool)) return ""
  switch (tool) {
    case "rtk":
      return firstLineField(capture("rtk", ["--version"]), 1)
    case "claude":
      return firstLineField(capture("claude", ["--version"]), 0)
    case "codex":
      return firstLineField(capture("codex", ["--version"]), -1)
    case "bun":
      return commandExists("bun") ? capture("bun", ["--version"]) : capture(p(ctx.home, ".bun", "bin", "bun"), ["--version"])
    case "agent-browser":
      return firstLineField(capture("agent-browser", ["--version"]), -1)
    case "effect-solutions": {
      const bunbin = commandExists("bun") ? "bun" : p(ctx.home, ".bun", "bin", "bun")
      if (bunbin !== "bun" && !isExecutable(bunbin)) return ""
      const m = /effect-solutions@([0-9][0-9.]*)/.exec(capture(bunbin, ["pm", "-g", "ls"]))
      return m?.[1] ?? ""
    }
    case "git":
      return firstLineField(capture("git", ["--version"]), 2)
    case "node":
      return capture("node", ["--version"]).replace(/^v/, "")
    case "npm":
      return capture("npm", ["--version"])
    case "jq":
      return capture("jq", ["--version"]).replace(/^jq-/, "")
    case "curl":
      return firstLineField(capture("curl", ["--version"]), 1)
    case "tsc":
      return firstLineField(capture("tsc", ["--version"]), 1)
    default:
      return ""
  }
}

export function latestVersion(tool: string): string {
  switch (tool) {
    case "rtk": {
      const body = capture("curl", ["-fsSL", "--max-time", "5", "https://api.github.com/repos/rtk-ai/rtk/releases/latest"])
      const doc = parseJson(body)
      const tag = doc !== undefined && isObject(doc) && typeof doc["tag_name"] === "string" ? doc["tag_name"] : ""
      return tag.replace(/^v/, "")
    }
    case "agent-browser":
    case "effect-solutions":
      return commandExists("npm") ? capture("npm", ["view", tool, "version"]) : ""
    default:
      return ""
  }
}

/** Blocking TTY prompt matching bash `read -r -p` (prompt on stderr). */
function promptLine(prompt: string): string {
  process.stderr.write(prompt)
  const buf = Buffer.alloc(1)
  let line = ""
  for (;;) {
    let n: number
    try {
      n = readSync(0, buf, 0, 1, null)
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
  const verified = field(ctx, tool, "verified")
  const pinnable = field(ctx, tool, "pinnable")

  if (verified === "" || !isNewer(latest, verified)) return { proceed: true, target: "" }

  if (ctx.assumeYes) {
    warn(`${tool} ${latest} is newer than kit-verified ${verified} — proceeding (--yes)`)
    return { proceed: true, target: "" }
  }

  if (process.stdin.isTTY === true) {
    process.stderr.write(`\x1b[1;33m[warn]\x1b[0m ${tool} ${latest} is not kit-verified (verified: ${verified}).\n`)
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

export function ensure(ctx: Ctx, tool: string, installFn: InstallFn): number {
  const policy = field(ctx, tool, "policy")

  if (!present(ctx, tool)) {
    const latest = latestVersion(tool)
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
    return installFn("install", target !== "" ? target : latest)
  }

  const installed = installedVersion(ctx, tool)
  const installedLabel = installed !== "" ? installed : "version unknown"

  if (policy !== "track") {
    if (ctx.dryRun) {
      echo(`[dry-run] ${tool} present (${installedLabel})`)
      return 0
    }
    log(`${tool} present (${installedLabel})`)
    return 0
  }

  const latest = latestVersion(tool)
  if (latest === "") {
    if (ctx.dryRun) {
      echo(`[dry-run] ${tool} present (${installedLabel}); latest unknown (offline?) — no action`)
      return 0
    }
    log(`${tool} present (${installedLabel}; latest unknown — no action)`)
    return 0
  }

  if (installed === "" || isNewer(latest, installed)) {
    if (ctx.dryRun) {
      echo(`[dry-run] would upgrade ${tool} (${installed !== "" ? installed : "unknown"} -> ${latest}, gated by toolchain.json verified pin)`)
      return 0
    }
    const g = gate(ctx, tool, "upgrade", latest)
    if (!g.proceed) return 0
    return installFn("upgrade", g.target !== "" ? g.target : latest)
  }

  if (ctx.dryRun) {
    echo(`[dry-run] ${tool} up to date (${installed})`)
    return 0
  }
  log(`${tool} up to date (${installed})`)
  return 0
}

function row(cells: [string, string, string, string, string, string]): string {
  const widths = [28, 9, 14, 9, 9]
  return cells.map((c, i) => (i < widths.length ? c.padEnd(widths[i]!) : c)).join(" ")
}

export function report(ctx: Ctx): void {
  echo(row(["TOOL", "KIND", "INSTALLED", "FLOOR", "VERIFIED", "STATUS"]))
  const platformOs =
    process.platform === "linux" ? "linux" : process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : ""
  for (const tool of Object.keys(manifest(ctx)).sort(compareCodepoints)) {
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
    if (present(ctx, tool)) {
      installed = installedVersion(ctx, tool)
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
