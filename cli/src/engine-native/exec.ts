/**
 * Child-process + PATH primitives. Golden rule: every external probe spawns
 * the intended binary with deterministic argv, and capture() mirrors command
 * substitution: stdout with trailing newlines stripped, empty on failure.
 */
import { spawnSync } from "node:child_process"
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"

/**
 * Engine paths are built with "/" because they appear verbatim in output
 * (dry-run lines, warns), where node:path.join would print "\" on Windows
 * and break the golden contract. fs accepts "/" on every platform.
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

// Change-detection primitives (Output Policy in DESIGN.md): operations report
// changed:boolean so unchanged repeat runs log at verbose instead of [ok].

/** Write only when the content differs; returns whether a write happened. */
export function writeFileIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false
  writeFileSync(path, content)
  return true
}

/** Copy only when dest differs from src; returns whether a copy happened. */
export function copyFileIfChanged(src: string, dest: string): boolean {
  if (existsSync(dest) && readFileSync(dest).equals(readFileSync(src))) return false
  copyFileSync(src, dest)
  return true
}

/** Recursive copy via copyFileIfChanged; returns whether anything changed. */
export function copyTreeIfChanged(srcDir: string, destDir: string): boolean {
  let changed = false
  for (const e of readdirSync(srcDir, { withFileTypes: true })) {
    const src = p(srcDir, e.name)
    const dest = p(destDir, e.name)
    if (e.isDirectory()) {
      if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true })
        changed = true
      }
      if (copyTreeIfChanged(src, dest)) changed = true
    } else if (copyFileIfChanged(src, dest)) {
      changed = true
    }
  }
  return changed
}
