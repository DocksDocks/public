/**
 * Filesystem resources shared by the golden regression suites.
 */
import {
  cpSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { hostOs, type PlatformName } from "../../src/engine-native/os"

export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
export const FIXTURES_DIR = join(REPO_DIR, "cli", "test", "fixtures")

const HARNESS_TEMP_PREFIXES = [
  "golden-bun-cache-",
  "golden-home-",
  "golden-stubs-",
  "golden-mask-",
  "golden-fixture-"
] as const
const STALE_TEMP_DIR_AGE_MS = 60 * 60 * 1000
const OWNER_PID_SUFFIX = ".owner-pid"
const TEMP_DIRS = new Set<string>()

/**
 * Heal externally killed runs by using recorded owner liveness.
 *
 * Current harness directories have a sibling marker that records the owner
 * process. We remove a directory only when `kill(pid, 0)` reports ESRCH.
 *
 * Older harness versions have no marker.
 * When marker data is unreadable or invalid, the sweep uses directory age.
 * This fallback heals old orphans while sparing young runs.
 *
 * A sibling marker survives fixture replacement and stays outside snapshots.
 * The sweep removes dead or old orphan markers after their directory disappears.
 */
export function sweepStaleTemporaryDirs(nowMs = Date.now()): void {
  // Windows has no numeric uid; its temp root is user-scoped, so owner
  // marker liveness and age remain the sweep boundary there.
  const ownerUid = process.getuid?.()
  const root = tmpdir()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      sweepOrphanOwnerMarker(root, entry.name, ownerUid, nowMs)
      continue
    }
    if (!HARNESS_TEMP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue
    const path = join(root, entry.name)
    try {
      const stat = lstatSync(path)
      if (ownerUid !== undefined && stat.uid !== ownerUid) continue
      if (TEMP_DIRS.has(path)) continue

      const ownerPath = `${path}${OWNER_PID_SUFFIX}`
      const ownerPid = readOwnerPid(ownerPath, ownerUid)
      if (ownerPid !== undefined) {
        if (ownerPid === process.pid || processIsAlive(ownerPid)) continue
      } else if (nowMs - stat.mtimeMs < STALE_TEMP_DIR_AGE_MS) {
        continue
      }

      try {
        rmSync(path, { recursive: true, force: true })
        rmSync(ownerPath, { force: true })
      } catch {
        // A protected directory must not stop the remaining stale sweep.
      }
    } catch {
      // An unreadable entry must not stop the remaining stale sweep.
    }
  }
}

function sweepOrphanOwnerMarker(
  root: string,
  entryName: string,
  ownerUid: number | undefined,
  nowMs: number
): void {
  if (!entryName.endsWith(OWNER_PID_SUFFIX)) return
  const directoryName = entryName.slice(0, -OWNER_PID_SUFFIX.length)
  if (!HARNESS_TEMP_PREFIXES.some((prefix) => directoryName.startsWith(prefix))) return

  const directoryPath = join(root, directoryName)
  try {
    lstatSync(directoryPath)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return
  }

  const ownerPath = join(root, entryName)
  try {
    const stat = lstatSync(ownerPath)
    if (ownerUid !== undefined && stat.uid !== ownerUid) return
    const ownerPid = readOwnerPid(ownerPath, ownerUid)
    if (ownerPid !== undefined) {
      if (ownerPid === process.pid || processIsAlive(ownerPid)) return
    } else if (nowMs - stat.mtimeMs < STALE_TEMP_DIR_AGE_MS) {
      return
    }

    try {
      rmSync(ownerPath, { force: true })
    } catch {
      // A protected marker must not stop the remaining stale sweep.
    }
  } catch {
    // An unreadable marker must not stop the remaining stale sweep.
  }
}

function readOwnerPid(ownerPath: string, ownerUid: number | undefined): number | undefined {
  try {
    if (ownerUid !== undefined && lstatSync(ownerPath).uid !== ownerUid) return undefined
    const ownerPid = Number(readFileSync(ownerPath, "utf8").trim())
    return Number.isSafeInteger(ownerPid) && ownerPid > 0 ? ownerPid : undefined
  } catch {
    return undefined
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

export function temporaryDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.add(dir)
  writeFileSync(`${dir}${OWNER_PID_SUFFIX}`, `${process.pid}\n`)
  return dir
}

export function registeredTemporaryDirs(): ReadonlyArray<string> {
  return [...TEMP_DIRS]
}

/**
 * Keep TEMP_DIRS path strings after deletion for snapshot normalization.
 * Cleanup removes each sibling owner marker after its directory.
 */
export function cleanupTemporaryDirs(): void {
  for (const dir of TEMP_DIRS) {
    rmSync(dir, { recursive: true, force: true })
    rmSync(`${dir}${OWNER_PID_SUFFIX}`, { force: true })
  }
}

function handleSigint(): void {
  try {
    cleanupTemporaryDirs()
  } finally {
    process.off("SIGINT", handleSigint)
    process.kill(process.pid, "SIGINT")
  }
}

function handleSigterm(): void {
  try {
    cleanupTemporaryDirs()
  } finally {
    process.off("SIGTERM", handleSigterm)
    process.kill(process.pid, "SIGTERM")
  }
}

sweepStaleTemporaryDirs()
process.on("exit", cleanupTemporaryDirs)
process.on("SIGINT", handleSigint)
process.on("SIGTERM", handleSigterm)

/**
 * Canned stub behavior. Each stub appends "<name>\t<args>" to
 * `GOLDEN_ARGV_LOG` and emits just enough output for the engine's probes to
 * take a deterministic branch. Bodies are JavaScript so one runner can back
 * both POSIX launchers and Windows `.cmd` launchers.
 */
const STUB_BODIES: Record<string, string> = {
  // node and jq are version-probed by `toolchain check` (presence-checked in
  // preflight/skills) but never do real work in the engine — pin them so the
  // goldens don't embed the recording machine's host versions.
  node: `if (args[0] === "--version") console.log("v22.23.1")`,
  git: `if (args[0] === "--version") console.log("git version 2.43.0")`,
  jq: `if (args[0] === "--version") console.log("jq-1.7.1")`,
  claude: `if (args[0] === "--version") console.log("2.1.204 (Claude Code)")`,
  codex: `if (args[0] === "--version") {
  console.log("codex-cli 0.144.4")
} else if (args[0] === "plugin" && args[1] === "list") {
  console.log('{"installed":[{"pluginId":"docks@docks","version":"0.12.5","installed":true,"enabled":true},{"pluginId":"effect-kit@docks","version":"0.3.0","installed":true,"enabled":true},{"pluginId":"plan-lifecycle@docks","version":"0.1.0","installed":true,"enabled":true}],"available":[]}')
}`,
  npx: ``,
  npm: `if (args[0] === "view") {
  console.log("0.0.1")
} else if (args[0] === "ls") {
  console.log('{"dependencies":{"intelephense":{"version":"1.18.5"}}}')
}`,
  bun: `if (args[0] === "--version") console.log("1.4.0")`,
  curl: ``,
  bwrap: `if (args[0] === "--version") console.log("bubblewrap 0.11.0")`,
  intelephense: ``,
  "typescript-language-server": `if (args[0] === "--version") console.log("5.3.0")`,
  tsc: `if (args[0] === "--version") console.log("Version 6.0.3")`,
  ffplay: `if (args[0] === "-version") console.log("ffplay version 6.1.1-3ubuntu5 Copyright (c) 2003-2023 the FFmpeg developers")`,
  unshare: ``,
  // Windows user-environment persistence. A real `setx` writes HKCU and then
  // broadcasts WM_SETTINGCHANGE, which blocks for seconds on a headless runner
  // and mutates the machine outside the fixture home; `reg` reports the value
  // as absent so the engine takes its apply branch deterministically.
  reg: `process.exitCode = 1`,
  setx: ``
}

/**
 * Inherit the caller's environment, then apply `overrides` so they actually
 * take effect. Windows environment names are case-insensitive but keep their
 * creation spelling, so a plain spread can leave an inherited `UserProfile`
 * beside an explicit `USERPROFILE`; the child then reads whichever the OS
 * happens to hand it and the override is silently lost. Drop every inherited
 * key that matches an override case-insensitively before applying it.
 */
export function childEnv(overrides: Record<string, string>): Record<string, string> {
  const shadowed = new Set(Object.keys(overrides).map((name) => name.toUpperCase()))
  const inherited: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || shadowed.has(name.toUpperCase())) continue
    inherited[name] = value
  }
  return { ...inherited, ...overrides }
}

/** The host a child runs as: native recording host, or Linux via the preload. */
export function childHostId(nativeHost: boolean): PlatformName {
  return nativeHost ? hostOs().id : "linux"
}

const STUB_HOST_MARKER = ".golden-stub-host"

export function readStubHost(stubDir: string): string {
  try {
    return readFileSync(join(stubDir, STUB_HOST_MARKER), "utf8").trim()
  } catch {
    return "unrecorded"
  }
}

/**
 * `overrides` replaces a stub's JavaScript body per test row; `null` omits the
 * stub entirely (tool missing). `opts.nativeHost` must match the run helper the
 * stubs are handed to: the launcher form is the host's, so a Linux-preloaded
 * child needs extensionless launchers even when recording on Windows.
 */
export function makeStubDir(
  overrides: Record<string, string | null> = {},
  opts: { readonly nativeHost?: boolean } = {}
): string {
  const unknownNames = Object.keys(overrides).filter((name) => !Object.hasOwn(STUB_BODIES, name)).sort()
  if (unknownNames.length > 0) {
    throw new Error(`Unknown golden stub override(s): ${unknownNames.join(", ")}`)
  }
  const hostId = childHostId(opts.nativeHost === true)
  const dir = temporaryDir("golden-stubs-")
  writeFileSync(join(dir, STUB_HOST_MARKER), `${hostId}\n`)
  const runnerPath = join(dir, "golden-stub-runner.mjs")
  const cases: Array<string> = []
  for (const [name, defaultBody] of Object.entries(STUB_BODIES)) {
    const body = name in overrides ? overrides[name] : defaultBody
    if (body === null || body === undefined) continue
    cases.push(`case ${JSON.stringify(name)}: {\n${body}\nbreak\n}`)
  }
  writeFileSync(
    runnerPath,
    `import { appendFileSync } from "node:fs"
const [name, ...args] = process.argv.slice(2)
const argvLog = process.env["GOLDEN_ARGV_LOG"]
if (argvLog !== undefined) appendFileSync(argvLog, \`\${name}\\t\${args.join(" ")}\\n\`)
switch (name) {
${cases.join("\n")}
default: throw new Error(\`unknown golden stub: \${String(name)}\`)
}
`
  )

  // A Linux-preloaded child resolves extensionless names even when recording on
  // Windows, so the launcher form follows the paired host, not this machine.
  const windows = hostId === "windows"
  const suffix = windows
    ? hostOs("windows").executableSuffixes.find((candidate) => candidate.toLowerCase() === ".cmd")
    : ""
  if (suffix === undefined) throw new Error("Windows host facts do not declare a .cmd executable suffix")

  for (const name of Object.keys(STUB_BODIES)) {
    if (name in overrides && overrides[name] === null) continue
    const path = join(dir, `${name}${suffix}`)
    if (windows) {
      // The engine resolves this suffix and host.invoke routes it through cmd.exe.
      writeFileSync(path, `@echo off\r\n"${process.execPath}" "${runnerPath}" "${name}" %*\r\n`)
    } else {
      writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${runnerPath}" "${name}" "$@"\n`)
      chmodSync(path, 0o755)
    }
  }
  return dir
}

/**
 * Write a fixture home variant on the fly (used by the TOML suite).
 * A `null` value deletes the path instead of writing it, so a case can opt out
 * of fixture artifacts that are noise for the invariant it asserts.
 */
export function materializeVariant(base: string, files: Record<string, string | null>): string {
  const dir = temporaryDir("golden-fixture-")
  rmSync(dir, { recursive: true })
  cpSync(join(FIXTURES_DIR, base), dir, { recursive: true })
  for (const [relative, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(dir, relative), { force: true })
      continue
    }
    mkdirSync(dirname(join(dir, relative)), { recursive: true })
    writeFileSync(join(dir, relative), content)
  }
  return dir
}
