/**
 * Child-process + PATH primitives. Parity rule: every external probe spawns
 * the SAME binary with the SAME argv as the bash engine (the mutation
 * harness diffs recorded argv), and capture() mirrors `$(...)`: stdout with
 * trailing newlines stripped, empty on failure.
 */
import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"

/**
 * Engine paths are built with "/" like bash string concatenation — they
 * appear verbatim in output (dry-run lines, warns), where node:path.join
 * would print "\" on Windows and break byte parity. fs accepts "/" on
 * every platform.
 */
export function p(...parts: Array<string>): string {
  return parts.join("/")
}

export function capture(cmd: string, args: ReadonlyArray<string>): string {
  const res = spawnSync(cmd, args as Array<string>, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  if (res.error !== undefined || res.status !== 0) return ""
  return (res.stdout ?? "").replace(/[\r\n]+$/, "")
}

/** `command -v` — resolve a name on PATH (PATHEXT-aware on Windows). */
export function which(name: string): string {
  const exts = process.platform === "win32" ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";").concat("") : [""]
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue
    for (const ext of exts) {
      const cand = join(dir, name + ext.toLowerCase())
      if (isExecutable(cand)) return cand
    }
  }
  return ""
}

export function commandExists(name: string): boolean {
  return which(name) !== ""
}

export function isExecutable(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false
    if (process.platform !== "win32") accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function fileExists(p: string): boolean {
  return existsSync(p)
}
