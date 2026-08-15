/**
 * Host modules own only facts that cannot be probed. Anything that can fail at
 * runtime stays try-then-fallback at the call site; a host module contributes
 * only the order of that fallback chain.
 */

export type PlatformName = "linux" | "darwin" | "windows" | "unknown"
/** Directory-link mechanisms, tried in order before the copy fallback. */
export type DirectoryLinkKind = "symlink" | "junction"
/** Tools whose install command differs per host OS. */
export type HintedTool = "git" | "jq" | "curl" | "ffplay"

/** A command plus argv, already shaped for how this host must invoke it. */
export interface Invocation {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/** The two steps that fetch and run a pinned Bun installer. */
export interface BunInstaller {
  readonly scriptPath: string
  readonly download: Invocation
  readonly run: Invocation
}

export interface HostOs {
  readonly id: PlatformName
  /** `SoT/toolchain.json` `os` field this host matches; "" matches every row. */
  readonly toolchainOs: string
  /** Bubblewrap is the Linux-only Codex sandbox runtime. */
  readonly supportsBubblewrap: boolean
  /** Directory-link mechanisms tried in order before `skillsSync.ts linkOrCopy` copies. */
  readonly directoryLinkKinds: ReadonlyArray<DirectoryLinkKind>
  /** One-line install command for a tool whose package differs per OS. */
  readonly installHint: (tool: HintedTool) => string
  /** Filename suffixes tried in order when resolving a bare tool name on PATH. */
  readonly executableSuffixes: ReadonlyArray<string>
  /** Shape the argv that actually runs a resolved executable on this host. */
  readonly invoke: (executablePath: string, args: ReadonlyArray<string>) => Invocation
  /** Bun executable filename inside `<bunRoot>/bin`. */
  readonly bunExecutableName: string
  /** Download-then-run installer for a pinned Bun version placed in `directory`. */
  readonly bunInstaller: (pin: string, directory: string) => BunInstaller
  /** Home-relative profile files scanned for an existing environment setting. */
  readonly profileCandidates: ReadonlyArray<string>
  /** Home-relative profile file that receives the environment write. */
  readonly profileTarget: (shell: string | undefined) => string
  /** One profile line exporting an environment variable in this host's syntax. */
  readonly environmentExport: (name: string, value: string) => string
  /** Claude `statusLine.command` for a resolved bun executable and script. */
  readonly statusLineCommand: (bun: string, script: string) => string
  /** Reshape the SoT `PostToolUseFailure` command for this host's shell. */
  readonly failureHookCommand: (command: string) => string
}
