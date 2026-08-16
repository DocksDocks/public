/**
 * Child-process + PATH primitives. Golden rule: every external probe spawns
 * the intended binary with deterministic argv, and capture() mirrors command
 * substitution: stdout with trailing newlines stripped, empty on failure.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { accessSync, constants, existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { delimiter, extname, isAbsolute, join } from "node:path"
import { hostOs } from "./os"

/** Keep engine paths slash-separated so rendered output is host-stable. */
export function p(...parts: Array<string>): string {
  return parts.join("/")
}

export interface AsyncProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

export interface AsyncProcessOptions {
  readonly stdio?: SpawnOptions["stdio"]
}

export function spawnProcess(
  cmd: string,
  args: ReadonlyArray<string>,
  options: AsyncProcessOptions = {}
): Promise<AsyncProcessResult> {
  const { promise, resolve } = Promise.withResolvers<AsyncProcessResult>()
  const host = hostOs()
  const executablePath = host.executableSuffixes.some((suffix) => suffix !== "")
    ? (which(cmd, host.executableSuffixes) || cmd)
    : cmd
  const invocation = host.invoke(executablePath, args)
  let child: ChildProcess
  try {
    child = spawn(invocation.command, [...invocation.args], {
      stdio: options.stdio ?? ["ignore", "pipe", "ignore"],
      windowsVerbatimArguments: invocation.windowsVerbatimArguments
    })
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    resolve({ exitCode: null, stdout: "", stderr: "", error })
    return promise
  }
  let stdout = ""
  let stderr = ""
  let error: Error | undefined

  if (child.stdout !== null) {
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stdout.on("error", (cause) => {
      error ??= cause
    })
  }
  if (child.stderr !== null) {
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.stderr.on("error", (cause) => {
      error ??= cause
    })
  }
  child.once("error", (cause) => {
    error ??= cause
  })
  child.once("close", (exitCode) => {
    resolve({ exitCode, stdout, stderr, ...(error !== undefined ? { error } : {}) })
  })
  return promise
}

export async function capture(cmd: string, args: ReadonlyArray<string>): Promise<string> {
  const res = await spawnProcess(cmd, args, { stdio: ["ignore", "pipe", "ignore"] })
  if (res.error !== undefined || res.exitCode !== 0) return ""
  return res.stdout.replace(/[\r\n]+$/, "")
}

/** `command -v` — resolve an executable name on PATH. */
export function which(name: string, suffixes: ReadonlyArray<string> = hostOs().executableSuffixes): string {
  const runnableCandidate = (base: string): string => {
    for (const suffix of suffixes) {
      const candidate = `${base}${suffix}`
      if (isExecutable(candidate, suffixes)) return candidate
    }
    return ""
  }

  if (isAbsolute(name) || name.includes("/")) return runnableCandidate(name)
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue
    const candidate = runnableCandidate(join(dir, name))
    if (candidate !== "") return candidate
  }
  return ""
}

export function commandExists(name: string): boolean {
  return which(name) !== ""
}

export function isExecutable(path: string, suffixes: ReadonlyArray<string> = hostOs().executableSuffixes): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (suffixes.some((suffix) => suffix !== "")) {
      const lowerPath = path.toLowerCase()
      return suffixes.some((suffix) =>
        suffix === "" ? extname(path) === "" : lowerPath.endsWith(suffix.toLowerCase())
      )
    }
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Change-detection primitives (Output Policy in DESIGN.md): operations report
// changed:boolean so unchanged repeat runs log at verbose instead of [ok].

/** Write only when the content differs; returns whether a write happened. */
export function writeTextIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false
  writeFileSync(path, content)
  return true
}

export function writeBytesIfChanged(path: string, content: Uint8Array): boolean {
  const bytes = Buffer.from(content)
  if (existsSync(path) && readFileSync(path).equals(bytes)) return false
  writeFileSync(path, bytes)
  return true
}

export function writeFileIfChanged(path: string, content: string): boolean {
  return writeTextIfChanged(path, content)
}
