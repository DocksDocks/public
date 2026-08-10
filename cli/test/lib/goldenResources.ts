/**
 * Filesystem resources shared by the golden regression suites.
 */
import {
  cpSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
const TEMP_DIRS = new Set<string>()

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

/** Heal externally-killed runs without touching young/concurrent or unrelated temp dirs. */
export function sweepStaleTemporaryDirs(nowMs = Date.now()): void {
  const root = tmpdir()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!HARNESS_TEMP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue
    const path = join(root, entry.name)
    try {
      if (nowMs - lstatSync(path).mtimeMs < STALE_TEMP_DIR_AGE_MS) continue
      rmSync(path, { recursive: true, force: true })
    } catch (error) {
      if (!isMissingPath(error)) throw error
    }
  }
}

export function temporaryDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.add(dir)
  return dir
}

export function registeredTemporaryDirs(): ReadonlyArray<string> {
  return [...TEMP_DIRS]
}

/** Keep TEMP_DIRS path strings after deletion: snapshot normalization still needs them. */
export function cleanupTemporaryDirs(): void {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true })
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
 * Canned stub behavior. Each stub appends "<name>\t<args>" to $GOLDEN_ARGV_LOG
 * and emits just enough output for the engine's probes to take a
 * deterministic branch (versions match the SoT/toolchain.json pins so every
 * `ensure` lands on "up to date").
 */
const STUB_BODIES: Record<string, string> = {
  // node and jq are version-probed by `toolchain check` (presence-checked in
  // preflight/skills) but never do real work in the engine — pin them so the
  // goldens don't embed the recording machine's host versions (bit CI: the
  // runner's node differed from the machine that recorded the goldens).
  node: `case "$1" in --version) echo "v22.23.1";; esac`,
  git: `case "$1" in --version) echo "git version 2.43.0";; esac`,
  jq: `case "$1" in --version) echo "jq-1.7.1";; esac`,
  claude: `case "$1" in --version) echo "2.1.204 (Claude Code)";; esac`,
  codex: `case "$1" in
  --version) echo "codex-cli 0.144.4";;
  plugin) case "$2" in
    list) echo '{"installed":[{"pluginId":"docks@docks","version":"0.12.5","installed":true,"enabled":true},{"pluginId":"effect-kit@docks","version":"0.3.0","installed":true,"enabled":true},{"pluginId":"plan-lifecycle@docks","version":"0.1.0","installed":true,"enabled":true}],"available":[]}' ;;
    add) exit 0;;
  esac;;
esac`,
  npx: `exit 0`,
  npm: `case "$1" in
  view) case "$2" in
    effect-solutions) echo "0.5.3";;
    *) echo "0.0.1";;
  esac;;
  ls) echo '{"dependencies":{"intelephense":{"version":"1.18.5"}}}';;
esac`,
  bun: `case "$1" in
  --version) echo "1.3.14";;
  pm) [ "$2" = "-g" ] && { [ "$3" = "ls" ] && echo "effect-solutions@0.5.3"; [ "$3" = "bin" ] && echo "\${GOLDEN_STUB_DIR}"; };;
esac`,
  curl: `exit 0`,
  "effect-solutions": `exit 0`,
  bwrap: `case "$1" in --version) echo "bubblewrap 0.11.0";; esac`,
  intelephense: `exit 0`,
  "typescript-language-server": `case "$1" in --version) echo "5.3.0";; esac`,
  tsc: `case "$1" in --version) echo "Version 6.0.3";; esac`,
  ffplay: `case "$1" in -version) echo "ffplay version 6.1.1-3ubuntu5 Copyright (c) 2003-2023 the FFmpeg developers";; esac`,
  unshare: `exit 0`
}

/**
 * overrides: replace a stub's body per test row (exercising install/upgrade/
 * gate/failure branches); `null` omits the stub entirely (tool missing).
 */
export function makeStubDir(overrides: Record<string, string | null> = {}): string {
  const dir = temporaryDir("golden-stubs-")
  for (const [name, defaultBody] of Object.entries(STUB_BODIES)) {
    const body = name in overrides ? overrides[name] : defaultBody
    if (body === null || body === undefined) continue
    const script = `#!/bin/bash
printf '%s\\t%s\\n' "${name}" "$*" >> "\${GOLDEN_ARGV_LOG:-/dev/null}"
${body}
exit 0
`
    const path = join(dir, name)
    writeFileSync(path, script)
    chmodSync(path, 0o755)
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
