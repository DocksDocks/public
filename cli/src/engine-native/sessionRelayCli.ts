import { spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from "node:fs"
import { dirname, join } from "node:path"

import { isObject, parseJson, type Json } from "./jq"
import type { Ctx } from "./index"
import { ExitError } from "./parseArgs"
import { payloadText } from "../payload"

const VERSION = "0.12.0"
const REPOSITORY = "DocksDocks/docks"
const TAG = "session-relay--v0.12.0"
const PLUGIN_ID = "session-relay@docks"
const INSTALL_PATH = "~/.local/bin/session-relay"
const TARGETS = [
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin"
] as const

export type SessionRelayTarget = typeof TARGETS[number]

export interface SessionRelayManifest {
  readonly kind: "managed-release"
  readonly policy: "exact"
  readonly verified: typeof VERSION
  readonly repository: typeof REPOSITORY
  readonly tag: typeof TAG
  readonly plugin_id: typeof PLUGIN_ID
  readonly plugin_version: typeof VERSION
  readonly install_path: typeof INSTALL_PATH
  readonly assets: Readonly<Record<SessionRelayTarget, string>>
}

export interface SessionRelayInstallOps {
  readonly download: (url: string, destination: string) => boolean
  readonly chmod: (path: string, mode: number) => void
  readonly runVersion: (path: string) => { readonly ok: boolean; readonly stdout: string }
  readonly rename: (from: string, to: string) => void
  readonly uniqueSuffix: () => string
}

export interface SessionRelayInstallInput {
  readonly home: string
  readonly dryRun: boolean
  readonly platform: string
  readonly arch: string
  readonly manifestText: string
  readonly log: (line: string) => void
  readonly error?: (line: string) => void
}

function fail(input: SessionRelayInstallInput, message: string): never {
  input.error?.(message)
  const error = new ExitError(1)
  error.message = message
  throw error
}

function exactKeys(value: { [key: string]: Json }, expected: ReadonlyArray<string>, label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} violates the closed Session Relay manifest schema`)
  }
}

export function parseSessionRelayManifest(text: string): SessionRelayManifest {
  const value = parseJson(text)
  if (value === undefined || !isObject(value)) throw new Error("Session Relay manifest is not a JSON object")
  exactKeys(
    value,
    ["kind", "policy", "verified", "repository", "tag", "plugin_id", "plugin_version", "install_path", "assets"],
    "Session Relay manifest"
  )
  const expected = {
    kind: "managed-release",
    policy: "exact",
    verified: VERSION,
    repository: REPOSITORY,
    tag: TAG,
    plugin_id: PLUGIN_ID,
    plugin_version: VERSION,
    install_path: INSTALL_PATH
  } as const
  for (const [key, wanted] of Object.entries(expected)) {
    if (value[key] !== wanted) throw new Error(`Session Relay manifest ${key.replaceAll("_", " ")} must be ${wanted}`)
  }
  const assets = value["assets"]
  if (!isObject(assets)) throw new Error("Session Relay manifest assets must be an object")
  exactKeys(assets, TARGETS, "Session Relay manifest assets target set")
  const parsedAssets = {} as Record<SessionRelayTarget, string>
  for (const target of TARGETS) {
    const digest = assets[target]
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`Session Relay manifest digest for ${target} must be 64 lowercase hex characters`)
    }
    parsedAssets[target] = digest
  }
  return { ...expected, assets: parsedAssets }
}

function manifestEntry(): string {
  const document = parseJson(payloadText("SoT/toolchain.json"))
  const tools = document !== undefined && isObject(document) ? document["tools"] : undefined
  const entry = tools !== undefined && isObject(tools) ? tools["session-relay"] : undefined
  if (entry === undefined) throw new Error("Embedded toolchain manifest has no session-relay entry")
  return JSON.stringify(entry)
}

export function sessionRelayTarget(platform: string, arch: string): SessionRelayTarget {
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-musl"
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-musl"
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin"
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin"
  throw new Error(`Unsupported host for Session Relay CLI: ${platform}/${arch}; supported: linux|darwin x64|arm64`)
}

function trimOneLineEnding(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2)
  if (text.endsWith("\n")) return text.slice(0, -1)
  return text
}

function exactVersion(ops: SessionRelayInstallOps, path: string): boolean {
  const result = ops.runVersion(path)
  return result.ok && trimOneLineEnding(result.stdout) === `session-relay ${VERSION}`
}

function selectedChecksum(text: string, assetName: string): string {
  const selected = text.split("\n").filter((line) => line.endsWith(`  ${assetName}`))
  if (selected.length !== 1 || !new RegExp(`^[0-9a-f]{64}  ${assetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(selected[0]!)) {
    throw new Error(`SHA256SUMS must contain exactly one canonical row for ${assetName}`)
  }
  return selected[0]!.slice(0, 64)
}

const defaultOps: SessionRelayInstallOps = {
  download: (url, destination) => {
    const result = spawnSync("curl", ["-fL", "--retry", "2", "--connect-timeout", "10", "--output", destination, url], {
      stdio: "inherit"
    })
    return result.error === undefined && result.status === 0
  },
  chmod: chmodSync,
  runVersion: (path) => {
    const result = spawnSync(path, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return { ok: result.error === undefined && result.status === 0, stdout: result.stdout ?? "" }
  },
  rename: renameSync,
  uniqueSuffix: () => `${process.pid}-${randomBytes(8).toString("hex")}`
}

export function installSessionRelayCli(
  input: SessionRelayInstallInput,
  ops: SessionRelayInstallOps = defaultOps
): void {
  let manifest: SessionRelayManifest
  let target: SessionRelayTarget
  try {
    manifest = parseSessionRelayManifest(input.manifestText)
    target = sessionRelayTarget(input.platform, input.arch)
  } catch (error) {
    fail(input, error instanceof Error ? error.message : String(error))
  }

  if (input.dryRun) {
    input.log(
      `[dry-run] ensure Session Relay CLI ${manifest.verified} from ${manifest.repository}@${manifest.tag} (${target}) -> ${manifest.install_path}`
    )
    return
  }

  const stable = join(input.home, ".local", "bin", "session-relay")
  if (existsSync(stable) && exactVersion(ops, stable)) return

  const parent = dirname(stable)
  try {
    mkdirSync(parent, { recursive: true, mode: 0o755 })
    if (!statSync(parent).isDirectory()) {
      fail(input, `Session Relay install parent is not a directory: ${parent}`)
    }
  } catch (error) {
    if (error instanceof ExitError) throw error
    fail(input, `Cannot prepare Session Relay install directory ${parent}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const suffix = ops.uniqueSuffix()
  const stage = join(parent, `.session-relay.stage-${suffix}`)
  const checksumFile = join(parent, `.session-relay.checksums-${suffix}`)
  const assetName = `session-relay-${target}`
  const baseUrl = `https://github.com/${manifest.repository}/releases/download/${manifest.tag}`

  try {
    if (!ops.download(`${baseUrl}/${assetName}`, stage)) fail(input, `Failed to download pinned Session Relay asset ${assetName}`)
    if (!ops.download(`${baseUrl}/SHA256SUMS`, checksumFile)) fail(input, "Failed to download pinned Session Relay SHA256SUMS")

    let checksumDigest: string
    try {
      checksumDigest = selectedChecksum(readFileSync(checksumFile, "utf8"), assetName)
    } catch (error) {
      fail(input, error instanceof Error ? error.message : String(error))
    }
    const sourceDigest = manifest.assets[target]
    if (checksumDigest !== sourceDigest) fail(input, `Session Relay source pin does not match SHA256SUMS for ${assetName}`)
    const downloadedDigest = createHash("sha256").update(readFileSync(stage)).digest("hex")
    if (downloadedDigest !== sourceDigest) fail(input, `Downloaded Session Relay checksum mismatch for ${assetName}`)

    try {
      ops.chmod(stage, 0o755)
    } catch (error) {
      fail(input, `Failed to chmod staged Session Relay CLI: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!exactVersion(ops, stage)) fail(input, `Staged Session Relay CLI did not report exact version session-relay ${VERSION}`)
    try {
      ops.rename(stage, stable)
    } catch (error) {
      fail(input, `Failed to atomically replace Session Relay CLI: ${error instanceof Error ? error.message : String(error)}`)
    }
    input.log(`Session Relay CLI ready (${VERSION})`)
  } finally {
    try {
      rmSync(stage, { force: true })
    } catch {
      // A cleanup failure must not turn a successful atomic replacement into
      // an install failure or alter a pre-existing stable executable.
    }
    try {
      rmSync(checksumFile, { force: true })
    } catch {
      // Same failure-preservation rule as the staged executable above.
    }
  }
}

export function ensureSessionRelayCli(ctx: Ctx): number {
  installSessionRelayCli({
    home: ctx.home,
    dryRun: ctx.dryRun,
    platform: ctx.services.platform.raw(),
    arch: process.arch,
    manifestText: manifestEntry(),
    log: ctx.dryRun ? ctx.services.logger.echo : ctx.services.logger.change,
    error: ctx.services.logger.err
  })
  return 0
}
