/// <reference types="bun" />

import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve, sep } from "node:path"

const REPO_DIR = resolve(import.meta.dirname, "..", "..")
const RECOVERY_COMMAND = "bun rm -g docks-kit && bun add -g docks-kit@latest"
const IGNORED_NODE_MODULES_ENTRIES: Record<string, true> = { ".bin": true, ".cache": true }
const TRUTHY_FLAG_VALUES: Record<string, true> = { "1": true, true: true, yes: true }
const KEEP_WORK_DIR = TRUTHY_FLAG_VALUES[(process.env.DOCKS_KIT_KEEP_SMOKE_DIR ?? "").toLowerCase()] === true

// An ambient BUN_OPTIONS, DOCKS_KIT_ENGINE or NODE_OPTIONS diverts the
// installed CLI, so a local override would look like a broken package.
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env }
delete CHILD_ENV.BUN_OPTIONS
delete CHILD_ENV.DOCKS_KIT_ENGINE
delete CHILD_ENV.NODE_OPTIONS

interface Manifest {
  readonly version: string
  readonly dependencies?: Record<string, string>
}

interface Pin {
  readonly name: string
  readonly range: string
}

function fail(message: string): never {
  throw new Error(message)
}

function requireSuccess(label: string, result: SpawnSyncReturns<string>): void {
  if (result.error) {
    fail(`${label} failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    const status = result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`
    fail(`${label} failed with ${status}${output ? `:\n${output}` : ""}`)
  }
}

function readManifest(path: string, label: string): Manifest {
  if (!existsSync(path)) {
    fail(`${label} is missing at ${path}`)
  }
  return JSON.parse(readFileSync(path, "utf8")) as Manifest
}

function displayPath(consumerDir: string, path: string): string {
  return relative(consumerDir, path).split(sep).join("/")
}

// A caller that already holds a proved tarball supplies it, so the smoke
// installs those exact bytes instead of repacking the working tree. Only an
// unsupplied run packs, which is what a local check and the parity lane want.
function resolveTarball(workDir: string, version: string): string {
  const expectedName = `docks-kit-${version}.tgz`
  const supplied = process.argv[2] ?? process.env.DOCKS_KIT_SMOKE_TARBALL
  if (supplied) {
    const suppliedPath = resolve(supplied)
    if (!existsSync(suppliedPath)) {
      fail(
        `assertion "the supplied tarball exists" failed: observed no file at ${suppliedPath}. ` +
          `Repair: pass the path of a packed ${expectedName}, or pass nothing so the smoke packs the working tree.`
      )
    }
    if (basename(suppliedPath) !== expectedName) {
      fail(
        `assertion "the supplied tarball carries the root version" failed: observed ${basename(suppliedPath)}, ` +
          `expected ${expectedName}. Repair: pass the tarball packed from this tree, or align the root package.json ` +
          `version with the tarball you want to smoke.`
      )
    }
    console.log(`[package-smoke] tarball: ${suppliedPath} (supplied, not repacked)`)
    return suppliedPath
  }

  const pack = spawnSync("bun", ["pm", "pack", "--destination", workDir], {
    cwd: REPO_DIR,
    encoding: "utf8",
    env: CHILD_ENV
  })
  requireSuccess("bun pm pack", pack)
  const packedPath = join(workDir, expectedName)
  if (!existsSync(packedPath)) {
    fail(
      `assertion "bun pm pack produced the versioned tarball" failed: observed no file at ${packedPath}. ` +
        `Repair: run "bun pm pack --destination <dir>" from the repository root and check the prepack gate.`
    )
  }
  console.log(`[package-smoke] tarball: ${expectedName} (packed from the working tree)`)
  return packedPath
}

// The consumer project carries no lockfile, so the registry resolves the
// tarball's declared ranges exactly as a global install does. That is the only
// way to catch a caret over a prerelease pulling in a mismatched transitive.
function installConsumer(workDir: string, tarball: string): string {
  const consumerDir = join(workDir, "consumer")
  mkdirSync(consumerDir, { recursive: true })
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify({ name: "docks-kit-package-smoke", version: "0.0.0", private: true }, null, 2)}\n`
  )
  const install = spawnSync("bun", ["add", tarball], { cwd: consumerDir, encoding: "utf8", env: CHILD_ENV })
  requireSuccess("consumer bun add", install)
  return consumerDir
}

// One level of `@scope` directories is expanded, because a scoped package sits
// one directory deeper than an unscoped one and would otherwise be scanned as
// if the scope itself were the package.
function installedPackageDirs(nodeModulesDir: string): ReadonlyArray<string> {
  const dirs: Array<string> = []
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (IGNORED_NODE_MODULES_ENTRIES[entry.name]) {
      continue
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue
    }
    const entryPath = join(nodeModulesDir, entry.name)
    if (!entry.name.startsWith("@")) {
      dirs.push(entryPath)
      continue
    }
    for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
      if (!scoped.isDirectory() && !scoped.isSymbolicLink()) {
        continue
      }
      dirs.push(join(entryPath, scoped.name))
    }
  }
  return dirs
}

function assertPinnedVersions(consumerDir: string, pins: ReadonlyArray<Pin>): void {
  for (const pin of pins) {
    const installedPath = join(consumerDir, "node_modules", pin.name, "package.json")
    if (!existsSync(installedPath)) {
      fail(
        `assertion "${pin.name} is installed" failed: observed no package at ${displayPath(consumerDir, installedPath)}. ` +
          `Repair: declare "${pin.name}": "${pin.range}" in the root package.json dependencies and refresh bun.lock.`
      )
    }
    const installed = readManifest(installedPath, `installed ${pin.name} package.json`)
    if (installed.version !== pin.range) {
      fail(
        `assertion "${pin.name} matches the root pin" failed: observed ${installed.version}, expected ${pin.range}. ` +
          `Repair: pin "${pin.name}": "${pin.range}" in the root package.json dependencies so a fresh resolution cannot ` +
          `drift away from the pinned set.`
      )
    }
    console.log(`[package-smoke] ${pin.name}: ${installed.version} (root pin ${pin.range})`)
  }
}

// A nested copy is the shape the caret-over-prerelease bug takes: the pinned
// version stays hoisted while a dependent keeps its own newer copy, so the two
// halves of the same release load side by side.
function assertNoNestedDuplicates(consumerDir: string, pins: ReadonlyArray<Pin>): void {
  const nodeModulesDir = join(consumerDir, "node_modules")
  const packageDirs = installedPackageDirs(nodeModulesDir)
  for (const packageDir of packageDirs) {
    for (const pin of pins) {
      const nestedPath = join(packageDir, "node_modules", pin.name)
      if (!existsSync(nestedPath)) {
        continue
      }
      const nested = readManifest(join(nestedPath, "package.json"), `nested ${pin.name} package.json`)
      fail(
        `assertion "no nested ${pin.name} duplicate" failed: observed ${nested.version} at ` +
          `${displayPath(consumerDir, nestedPath)}, expected the hoisted ${pin.range} to be the only copy. ` +
          `Repair: keep "${pin.name}": "${pin.range}" pinned in the root package.json dependencies so every dependent ` +
          `dedupes to it, then rebuild a broken install from scratch with "${RECOVERY_COMMAND}".`
      )
    }
  }
  console.log(
    `[package-smoke] nested duplicates: none of ${pins.length} pinned names under ${packageDirs.length} installed packages`
  )
}

function assertBinaryVersion(consumerDir: string, expected: string): void {
  const binaryPath = join(consumerDir, "node_modules", ".bin", "docks-kit")
  if (!existsSync(binaryPath)) {
    fail(
      `assertion "installed binary exists" failed: observed no executable at ${displayPath(consumerDir, binaryPath)}. ` +
        `Repair: keep the "docks-kit" bin entry in the root package.json and keep cli/src inside package.json files.`
    )
  }
  const versionRun = spawnSync(binaryPath, ["--version"], { cwd: consumerDir, encoding: "utf8", env: CHILD_ENV })
  requireSuccess("installed docks-kit --version", versionRun)
  const reportedVersion = versionRun.stdout.trim()
  if (reportedVersion !== expected) {
    fail(
      `assertion "installed binary reports the packaged version" failed: observed ${JSON.stringify(reportedVersion)}, ` +
        `expected ${expected}. Repair: rebuild the tarball from a clean tree so the packed cli/src matches the root ` +
        `package.json version.`
    )
  }
  console.log(`[package-smoke] docks-kit --version: ${reportedVersion}`)
}

function smoke(workDir: string, manifest: Manifest, pins: ReadonlyArray<Pin>): void {
  const tarball = resolveTarball(workDir, manifest.version)
  const consumerDir = installConsumer(workDir, tarball)
  console.log(`[package-smoke] consumer install: ${consumerDir}`)

  assertPinnedVersions(consumerDir, pins)
  assertNoNestedDuplicates(consumerDir, pins)
  assertBinaryVersion(consumerDir, manifest.version)
}

function main(): void {
  if (process.platform === "win32") {
    fail(
      `the package smoke runs on POSIX hosts only: observed platform win32, where bun writes a different bin shim ` +
        `than node_modules/.bin/docks-kit. Repair: run "bun run smoke:package" on Linux or macOS.`
    )
  }

  const manifest = readManifest(join(REPO_DIR, "package.json"), "repository package.json")
  const pins: ReadonlyArray<Pin> = Object.entries(manifest.dependencies ?? {}).map(([name, range]) => ({
    name,
    range
  }))
  if (pins.length === 0) {
    fail(
      `assertion "root package.json declares dependencies" failed: observed an empty dependency set. ` +
        `Repair: declare the runtime dependencies with exact pins in the root package.json.`
    )
  }
  console.log(`[package-smoke] root pins: ${pins.map((pin) => `${pin.name}@${pin.range}`).join(", ")}`)

  // An exported but empty RUNNER_TEMP is not a directory: joining it would
  // build the clean-room tree relative to the current working directory.
  const runnerTemp = process.env.RUNNER_TEMP
  const workRoot = runnerTemp !== undefined && runnerTemp.length > 0 ? runnerTemp : tmpdir()
  const workDir = mkdtempSync(join(workRoot, "docks-kit-package-smoke-"))
  try {
    smoke(workDir, manifest, pins)
  } finally {
    if (KEEP_WORK_DIR) {
      console.log(`[package-smoke] retained work directory: ${workDir}`)
    } else {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
  console.log("[package-smoke] clean-room consumer install passed")
}

try {
  main()
} catch (error) {
  console.error(`[package-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
