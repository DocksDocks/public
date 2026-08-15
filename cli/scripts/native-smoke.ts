/// <reference types="bun" />

import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { targetForHost } from "../src/engine-native/os/targets"

const REPO_DIR = resolve(import.meta.dirname, "..", "..")
const DIST_DIR = join(REPO_DIR, "cli", "dist")

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

function main(): void {
  const target = targetForHost(process.platform, process.arch)
  if (!target) {
    fail(`unsupported native smoke host: ${process.platform}/${process.arch}`)
  }
  console.log(`[native-smoke] target: ${target.id}`)

  mkdirSync(DIST_DIR, { recursive: true })
  const artifactPath = join(DIST_DIR, target.artifact)
  const build = spawnSync(
    "bun",
    [
      "build",
      "--compile",
      "--minify",
      `--target=${target.bunTarget}`,
      join(REPO_DIR, "cli", "src", "main.ts"),
      "--outfile",
      artifactPath
    ],
    { cwd: REPO_DIR, encoding: "utf8" }
  )
  requireSuccess("native compile", build)
  console.log(`[native-smoke] compile: ${target.artifact}`)

  const packageJson = JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as {
    version: string
  }
  const versionRun = spawnSync(artifactPath, ["--version"], {
    cwd: REPO_DIR,
    encoding: "utf8"
  })
  requireSuccess("native --version", versionRun)
  const reportedVersion = versionRun.stdout.replace(/[\r\n]+$/, "")
  if (reportedVersion !== packageJson.version) {
    fail(`native --version mismatch: expected ${packageJson.version}, received ${JSON.stringify(reportedVersion)}`)
  }
  console.log(`[native-smoke] version: ${reportedVersion}`)

  const temporaryHome = mkdtempSync(join(tmpdir(), "docks-kit-native-smoke-"))
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: temporaryHome, USERPROFILE: temporaryHome }
    delete env.BUN_OPTIONS
    delete env.DOCKS_KIT_ENGINE
    delete env.NODE_OPTIONS

    const dryRun = spawnSync(artifactPath, ["sync", "--dry-run"], {
      cwd: REPO_DIR,
      encoding: "utf8",
      env
    })
    requireSuccess("native sync --dry-run", dryRun)
    const output = `${dryRun.stdout}\n${dryRun.stderr}`
    if (/unsupported host/i.test(output)) {
      fail("native sync --dry-run reported an unsupported host")
    }
    console.log(`[native-smoke] dry-run: exit ${dryRun.status}`)
  } finally {
    rmSync(temporaryHome, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`[native-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
