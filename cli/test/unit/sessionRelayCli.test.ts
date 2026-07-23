import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  installSessionRelayCli,
  parseSessionRelayManifest,
  sessionRelayTarget,
  type SessionRelayInstallOps
} from "../../src/engine-native/sessionRelayCli"

const VERSION = "0.13.0"
const ASSET_BYTES = Buffer.from("#!/bin/sh\nprintf 'session-relay 0.13.0\\n'\n")
const ASSET_DIGEST = createHash("sha256").update(ASSET_BYTES).digest("hex")
const TARGETS = [
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin"
] as const

const roots: Array<string> = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function home(): string {
  const root = mkdtempSync(join(tmpdir(), "session-relay-cli-test-"))
  roots.push(root)
  return root
}

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "managed-release",
    policy: "exact",
    verified: VERSION,
    repository: "DocksDocks/docks",
    tag: `session-relay--v${VERSION}`,
    plugin_id: "session-relay@docks",
    plugin_version: VERSION,
    install_path: "~/.local/bin/session-relay",
    assets: Object.fromEntries(TARGETS.map((target) => [target, ASSET_DIGEST])),
    ...overrides
  })
}

interface OpsOptions {
  readonly assetBytes?: Buffer
  readonly checksumText?: string
  readonly downloadFailure?: "asset" | "checksums"
  readonly chmodFailure?: boolean
  readonly renameFailure?: boolean
  readonly stagedVersion?: string
  readonly stableVersion?: string
}

function ops(events: Array<string>, options: OpsOptions = {}): SessionRelayInstallOps {
  return {
    download: (url, destination) => {
      events.push(`download ${basename(url)}`)
      const checksums = basename(url) === "SHA256SUMS"
      if (options.downloadFailure === (checksums ? "checksums" : "asset")) return false
      if (checksums) {
        const target = "x86_64-unknown-linux-musl"
        writeFileSync(
          destination,
          options.checksumText ?? `${ASSET_DIGEST}  session-relay-${target}\n`
        )
      } else {
        writeFileSync(destination, options.assetBytes ?? ASSET_BYTES)
      }
      return true
    },
    chmod: (path, mode) => {
      events.push(`chmod ${mode.toString(8)}`)
      if (options.chmodFailure === true) throw new Error("injected chmod failure")
      chmodSync(path, mode)
    },
    runVersion: (path) => {
      const staged = basename(path).startsWith(".session-relay.stage-")
      events.push(`version ${staged ? "stage" : "stable"}`)
      const stdout = staged ? options.stagedVersion ?? `session-relay ${VERSION}` : options.stableVersion ?? "session-relay 0.11.0"
      return { ok: true, stdout }
    },
    rename: (from, to) => {
      events.push("rename")
      if (options.renameFailure === true) throw new Error("injected rename failure")
      renameSync(from, to)
    },
    uniqueSuffix: () => "fixed"
  }
}

function install(root: string, events: Array<string>, options: OpsOptions = {}, manifestText = manifest()): void {
  installSessionRelayCli(
    {
      home: root,
      dryRun: false,
      platform: "linux",
      arch: "x64",
      manifestText,
      log: (line) => events.push(`log ${line}`)
    },
    ops(events, options)
  )
}

describe("sessionRelayTarget", () => {
  it.each([
    ["linux", "x64", "x86_64-unknown-linux-musl"],
    ["linux", "arm64", "aarch64-unknown-linux-musl"],
    ["darwin", "x64", "x86_64-apple-darwin"],
    ["darwin", "arm64", "aarch64-apple-darwin"]
  ] as const)("maps %s/%s deterministically", (platform, arch, target) => {
    expect(sessionRelayTarget(platform, arch)).toBe(target)
  })

  it.each([["win32", "x64"], ["linux", "ia32"], ["freebsd", "arm64"]] as const)(
    "rejects unsupported %s/%s",
    (platform, arch) => expect(() => sessionRelayTarget(platform, arch)).toThrow(/unsupported.*session relay/i)
  )
})

describe("parseSessionRelayManifest", () => {
  it("accepts the closed source-pinned four-target contract with one canonical version", () => {
    const parsed = parseSessionRelayManifest(manifest())

    expect(parsed.verified).toBe(VERSION)
    expect(parsed.tag).toBe(`session-relay--v${VERSION}`)
    expect(parsed.plugin_version).toBe(VERSION)
    expect(parsed.assets).toEqual(
      Object.fromEntries(TARGETS.map((target) => [target, ASSET_DIGEST]))
    )
  })

  it.each([
    "0.13",
    "0.13.0-rc.1",
    "0.13.0+build.1",
    "00.13.0",
    "0.013.0",
    " 0.13.0"
  ])("rejects malformed or non-stable version %j", (verified) => {
    expect(() => parseSessionRelayManifest(manifest({ verified }))).toThrow(/verified|version/i)
  })

  it.each([
    [{ tag: "session-relay--v0.13.1" }, /tag/i],
    [{ plugin_version: "0.13.1" }, /plugin.*version/i]
  ])("rejects tag or plugin version that does not match verified", (override, error) => {
    expect(() => parseSessionRelayManifest(manifest(override))).toThrow(error)
  })

  it.each([
    [{ extra: true }, /unexpected|closed/i],
    [{ repository: "fork/docks" }, /repository/i],
    [{ assets: { "x86_64-unknown-linux-musl": ASSET_DIGEST } }, /assets|target/i]
  ])("rejects a noncanonical manifest", (override, error) => {
    expect(() => parseSessionRelayManifest(manifest(override))).toThrow(error)
  })
})

describe("installSessionRelayCli", () => {
  it("creates a fresh ~/.local/bin and installs only after checksum, chmod, and staged version smoke", () => {
    const root = home()
    const events: Array<string> = []

    install(root, events)

    const stable = join(root, ".local", "bin", "session-relay")
    expect(readFileSync(stable)).toEqual(ASSET_BYTES)
    expect(statSync(stable).mode & 0o777).toBe(0o755)
    expect(events).toEqual([
      "download session-relay-x86_64-unknown-linux-musl",
      "download SHA256SUMS",
      "chmod 755",
      "version stage",
      "rename",
      `log Session Relay CLI ready (${VERSION})`
    ])
    expect(existsSync(dirname(stable))).toBe(true)
  })

  it("returns without network access when the stable command is already exact", () => {
    const root = home()
    const stable = join(root, ".local", "bin", "session-relay")
    mkdirSync(dirname(stable), { recursive: true })
    writeFileSync(stable, ASSET_BYTES)
    chmodSync(stable, 0o755)
    const events: Array<string> = []

    install(root, events, { stableVersion: `session-relay ${VERSION}\n` })

    expect(events).toEqual(["version stable"])
  })

  it("performs no filesystem or network mutation during dry-run", () => {
    const root = home()
    const events: Array<string> = []

    installSessionRelayCli(
      {
        home: root,
        dryRun: true,
        platform: "linux",
        arch: "x64",
        manifestText: manifest(),
        log: (line) => events.push(line)
      },
      ops(events)
    )

    expect(existsSync(join(root, ".local"))).toBe(false)
    expect(events).toEqual([
      `[dry-run] ensure Session Relay CLI ${VERSION} from DocksDocks/docks@session-relay--v${VERSION} (x86_64-unknown-linux-musl) -> ~/.local/bin/session-relay`
    ])
  })

  it("fails unsupported hosts before creating the install parent", () => {
    const root = home()
    expect(() => installSessionRelayCli(
      {
        home: root,
        dryRun: false,
        platform: "win32",
        arch: "x64",
        manifestText: manifest(),
        log: () => undefined
      },
      ops([])
    )).toThrow(/unsupported.*session relay/i)
    expect(existsSync(join(root, ".local"))).toBe(false)
  })

  it("reports the manifest version and preserves the stable executable on staged smoke failure", () => {
    const root = home()
    const stable = join(root, ".local", "bin", "session-relay")
    const oldBytes = Buffer.from("old relay bytes")
    mkdirSync(dirname(stable), { recursive: true })
    writeFileSync(stable, oldBytes)
    chmodSync(stable, 0o711)

    expect(() => install(root, [], { stagedVersion: "session-relay 0.11.0" })).toThrow(
      `Staged Session Relay CLI did not report exact version session-relay ${VERSION}`
    )

    expect(readFileSync(stable)).toEqual(oldBytes)
    expect(statSync(stable).mode & 0o777).toBe(0o711)
    expect(existsSync(join(dirname(stable), ".session-relay.stage-fixed"))).toBe(false)
    expect(existsSync(join(dirname(stable), ".session-relay.checksums-fixed"))).toBe(false)
  })

  it.each([
    ["asset download", { downloadFailure: "asset" }],
    ["checksum download", { downloadFailure: "checksums" }],
    ["downloaded bytes checksum", { assetBytes: Buffer.from("tampered") }],
    ["source pin versus checksum row", { checksumText: `${"0".repeat(64)}  session-relay-x86_64-unknown-linux-musl\n` }],
    ["duplicate checksum row", { checksumText: `${ASSET_DIGEST}  session-relay-x86_64-unknown-linux-musl\n${ASSET_DIGEST}  session-relay-x86_64-unknown-linux-musl\n` }],
    ["chmod", { chmodFailure: true }],
    ["atomic rename", { renameFailure: true }]
  ] as const)("preserves an existing executable byte-for-byte on %s failure", (_label, failure) => {
    const root = home()
    const stable = join(root, ".local", "bin", "session-relay")
    const oldBytes = Buffer.from("old relay bytes")
    mkdirSync(dirname(stable), { recursive: true })
    writeFileSync(stable, oldBytes)
    chmodSync(stable, 0o711)
    const events: Array<string> = []

    expect(() => install(root, events, failure as OpsOptions)).toThrow()

    expect(readFileSync(stable)).toEqual(oldBytes)
    expect(statSync(stable).mode & 0o777).toBe(0o711)
    expect(existsSync(dirname(stable))).toBe(true)
    expect(existsSync(join(dirname(stable), ".session-relay.stage-fixed"))).toBe(false)
    expect(existsSync(join(dirname(stable), ".session-relay.checksums-fixed"))).toBe(false)
  })
})
