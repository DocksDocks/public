---
name: host-platform-context
description: "Use when modifying cli/src/engine-native/exec.ts spawnHost, spawnProcess, capture, captureWithin, which, writeTextIfChanged; os/*.ts HostOs facts (invoke, executableSuffixes, environmentSetting, statusLineCommand, failureHookCommand, bunInstaller) or os/targets.ts HOST_TARGETS; deps.ts DEPENDENCIES, findBun, npmGlobalVersions, resolveVersionReading; services.ts makeDependencyManager or the cli/src/services.ts Effect layers; atomicWrite.ts replaceFile or removeStaleTemporaries; processes.ts processExited; or logger.ts terminal lease. Covers Windows cmd-shim encoding, pathless-spawn refusal, bounded process-group kills, version-probe time limits, symlink-preserving atomic writes and the cleanup of their killed-write leftovers, and the host support matrix. Not for golden harness rules (use engine-native-context) or toolchain pins and the doctor table (use toolchain-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/engine-native/exec.ts
      lines: "1-360"
    - path: cli/src/engine-native/deps.ts
      lines: "1-309"
    - path: cli/src/engine-native/os/types.ts
      lines: "1-75"
    - path: cli/src/engine-native/os/index.ts
      lines: "1-42"
    - path: cli/src/engine-native/os/posix.ts
      lines: "1-83"
    - path: cli/src/engine-native/os/linux.ts
      lines: "1-15"
    - path: cli/src/engine-native/os/darwin.ts
      lines: "1-16"
    - path: cli/src/engine-native/os/windows.ts
      lines: "1-184"
    - path: cli/src/engine-native/os/targets.ts
      lines: "1-77"
    - path: cli/src/engine-native/atomicWrite.ts
      lines: "1-224"
    - path: cli/src/engine-native/processes.ts
      lines: "1-16"
    - path: cli/src/engine-native/logger.ts
      lines: "1-196"
    - path: cli/src/engine-native/services.ts
      lines: "1-89"
    - path: cli/src/services.ts
      lines: "1-42"
  updated: "2026-11-07"
---

# Host Platform Layer

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

<constraint>
Start every synchronous child with `exec.ts spawnHost` and every asynchronous child with `exec.ts spawnProcess`. Never call `node:child_process` directly for a tool resolved by name. On a host with executable suffixes (Windows), both functions resolve the name to an absolute path with `which`. They refuse a name that `which` cannot resolve (verify: `bunx vitest run cli/test/unit/exec.test.ts -t "refuses a name a suffix host cannot resolve instead of spawning it"`). On a POSIX host, both functions pass the name unchanged, and the spawn looks it up on `PATH`. Unprobed: no unit test spawns a pathless name on a POSIX host (verify: `grep -n "resolvesSuffixes ?" cli/src/engine-native/exec.ts`). Both functions also shape a Windows shim invocation together with its argv.
</constraint>

<constraint>
Rewrite a user file through `atomicWrite.ts replaceFile`. It keeps a symlinked target as a link and keeps permission bits; a hand-written tmp+rename does neither.
</constraint>

<constraint>
Run an inherited-stdio child (installer, sudo prompt) inside `ctx.terminalLease?.withExclusive`. Do not nest `withExclusive`.
</constraint>

## When to Use

- Adding or changing a child-process call, a PATH probe, or a version probe.
- Adding a host fact, a supported host, or an install hint.
- Writing a deployed user file.
- Adding terminal output that must coexist with progress or prompts.

Output channels, change detection, the missing-dependency warn shape, and the list of allowed direct `process.platform` reads: `cli/src/engine-native/DESIGN.md` § Output Policy and § Platform seam (not repeated here).

## Core Patterns

| Need | Use | Anchor |
|---|---|---|
| Sync child | `spawnHost(cmd, args, overrides, host)` | `cli/src/engine-native/exec.ts` — `spawnHost` — resolves suffixes, applies `host.invoke`, and passes that invocation's `windowsVerbatimArguments`. Only a `.cmd`/`.bat` shim sets the flag (verify: `bunx vitest run cli/test/unit/os/windows.test.ts -t "normalizes and escapes the Windows command shim path"`; verify: `bunx vitest run cli/test/unit/os/windows.test.ts -t "invokes an executable directly with its arguments untouched"`). Unprobed: no unit test reads the options that `spawnHost` gives `spawnSync` (verify: `grep -n "windowsVerbatimArguments: invocation" cli/src/engine-native/exec.ts`) |
| Async child | `spawnProcess(cmd, args, { stdio, cwd, host, timeoutMs })` | `exec.ts` — `spawnProcess` — default stdio discards stderr; pass `["ignore","pipe","pipe"]` when the caller prints `processFailureSummary` |
| Bounded probe | `captureWithin(cmd, args, ms)` → `output`/`failed`/`timed-out` | `exec.ts` — `captureWithin`, `killProcessTree` — POSIX children lead their own group (`detached`) and die by negative pid; Windows runs `taskkill /T /F` from `SystemRoot\System32` (`C:\Windows` when unset; unlike `commandInterpreter`, the value is not checked for an absolute path) |
| Version read | `deps.resolveVersionReading` | `cli/src/engine-native/deps.ts` — `VERSION_PROBE_LIMIT_MS` — keeps "no answer in time" apart from "no version" (verify: `grep -n VERSION_PROBE_LIMIT_MS cli/src/engine-native/deps.ts`) |
| Presence | `ctx.services.deps.probe(id)` | `deps.ts` — `pathProbe`, `findBun` — Bun must resolve to an absolute path because it is persisted into hooks |
| Missing tool warning | `ctx.services.deps.warnMissing(id, logger, context)` | `cli/src/engine-native/services.ts` — `makeDependencyManager` — one warning per tool per manager |
| Host fact | `hostOs(ctx.services.platform.name())` | `cli/src/engine-native/os/types.ts` — `HostOs` — facts that cannot be probed only |
| Supported host | `HOST_TARGETS` | `cli/src/engine-native/os/targets.ts` — `HOST_TARGETS` — adding a row adds a host. `hostTargets.test.ts` checks the table against the Bash and PowerShell launcher maps, the default build target list, and the artifact names in `.github/workflows/release-cli.yml` (verify: `bunx vitest run cli/test/unit/hostTargets.test.ts -t "keeps the Bash launcher aligned with every POSIX host target"`; verify: `bunx vitest run cli/test/unit/hostTargets.test.ts -t "keeps the PowerShell launcher aligned with every Windows host target"`; verify: `bunx vitest run cli/test/unit/hostTargets.test.ts -t "builds exactly the four supported host targets by default"`; verify: `bunx vitest run cli/test/unit/hostTargets.test.ts -t "names every HOST_TARGETS artifact in release-cli.yml"`) |
| Atomic write | `replaceFile(target, content, { mode })` | `cli/src/engine-native/atomicWrite.ts` — `replaceFile` — keeps a symlinked target a link (verify, prints `true`: `bun -e 'import {mkdtempSync,writeFileSync,symlinkSync,lstatSync,rmSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";import {replaceFile} from "./cli/src/engine-native/atomicWrite";const d=mkdtempSync(join(tmpdir(),"rf-"));writeFileSync(join(d,"t"),"a");symlinkSync(join(d,"t"),join(d,"l"));replaceFile(join(d,"l"),"b");console.log(lstatSync(join(d,"l")).isSymbolicLink());rmSync(d,{recursive:true})'`). The temporary sibling is `<file>.<pid>.<16 hex>.tmp`, created with `wx`. When that name passes 255 bytes, it is the short `.<tag>.<pid>.<16 hex>.tmp` in the same folder, with `tag` = the first 16 hex of sha256(basename(file)) (verify: `bunx vitest run cli/test/unit/atomicWrite.test.ts -t "puts the PID in the short temporary name"`) |
| Leftovers of a killed write | `removeStaleTemporaries(dir, owns)` | `atomicWrite.ts` — `removeStaleTemporaries` — removes an entry only when its name parses from the right as a temporary name with a PID of 1 or more, `owns` accepts its target (a base name, or a tag for a short name), `lstat` shows a regular file, the PID is not this process, and `processes.ts processExited` is true (ESRCH). It ignores every error. `replaceFile` runs it for its own target after a successful rename; `replaceTextIfChanged` also runs it when the content already matches; `ompPlugins.ts pruneUpgradeLog` runs it for upgrade-event names (verify: `bunx vitest run cli/test/unit/atomicWrite.test.ts -t "replaceFile temporary files of a killed write"`; verify: `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "removes the temporary file of a dead event writer"`) |
| Process liveness | `processExited(pid)` | `cli/src/engine-native/processes.ts` — `processExited` — true only when `process.kill(pid, 0)` throws ESRCH. A live process, a process of another user (EPERM), and every other error give false, so a cleanup keeps a file when it is not sure. `atomicWrite.ts` and `tidy.ts darwinProcesses` use it; `hygiene.ts hasExited` is a copy, because the omp extension imports only `node:` modules |

### Windows command-shim encoding

`cli/src/engine-native/os/windows.ts` — `commandShimInvocation`, `escapeArgument`, `assertCommandLineValue`, `commandInterpreter`:

- A `.cmd`/`.bat` target runs as `<cmd.exe> /d /v:off /s /c "<line>"` with two caret layers per argument, because a shim that forwards `%*` parses again.
- `%`, CR, and LF cannot be escaped on a cmd line. The encoder throws. `spawnHost` then exits the process with code 2, while `spawnProcess` returns `{ error }`.
- The interpreter path is always absolute (`ComSpec` when absolute, else `SystemRoot\System32\cmd.exe`).

### Host-specific startup files

`os/posix.ts` — `environmentSetting, target` — zsh writes `.zshrc`, bash writes the first existing `bashTargets` entry (Linux `.bashrc`; macOS `.bash_profile`, `.bash_login`, `.profile`), any other shell writes `.profile`. Windows persists with `setx` after a `reg query` probe.

## Key Decisions

- Host modules contribute the order of a fallback chain, never the outcome; the runtime tries and falls back (`os/types.ts` header).
- An unknown platform reuses Linux facts with no toolchain-row filter and no bubblewrap (`os/index.ts` — `unknown`).
- The kill strategy follows the real platform (`exec.ts` — `WINDOWS_PROCESS`), while an injected `host` shapes only resolution and argv.
- Engine tests inject plain-object `EngineServices` and fake `ProbeExecutor`s; host modules are tested on every runner through `hostOs("<id>")`.

## Gotchas

| Good | Bad | Why |
|---|---|---|
| `spawnHost("git", ...)` | `spawnSync("git", ...)` | A pathless name lets Windows search the current directory first; `commands/sync.ts updateNudge` starts `git` through `spawnHost`, and `engine.ts engineCapture` spawns the absolute `process.execPath` (verify, prints nothing: `git grep -n 'spawnSync("' cli/src`; verify: `bunx vitest run cli/test/unit/syncUpdateNudge.test.ts -t "runs git through spawnHost"`) |
| `replaceFile(path, text, { mode: 0o600 })` | `writeFileSync(tmp); renameSync(tmp, path)` | The rename replaces a symlink with a regular file; `ompFastMode.ts toggleDeployedOpenAiFast` calls `replaceFile`, so a symlinked `config.yml` stays a link (verify: `bunx vitest run cli/test/unit/ompFastMode.test.ts -t "keeps a symlinked config.yml a link"`) |
| `removeStaleTemporaries(dir, owns)` with an `owns` that accepts only the targets the caller writes | A sweep of `*.tmp` by age, or of every dead-PID `*.tmp` in the folder | Another tool can use the same folder and a similar name; only the writer of a target knows which temporary names are its own |
| `p` used inside a function body in `os/windows.ts` | a top-level `p(...)` call in any `os/*.ts` module | `exec.ts` imports `./os`; `os/posix.ts` avoids importing `../exec` for this reason |
| `stdio: ["ignore","pipe","pipe"]` before `processFailureSummary` | the default stdio | The default discards stderr, so the summary loses git's `fatal:` line |

- `deps.ts DependencySpec` has no requirement class. A missing tool gets one `warnMissing` line (`cli/src/engine-native/DESIGN.md` § Missing dependencies); an abort on a missing tool needs its own check at the call site and a test (verify, prints `0`: `grep -ci requirement cli/src/engine-native/deps.ts`).
- `deps.ts bunInstallHint` renders the host's `HostOs.bunInstaller` at the `SoT/toolchain.json` Bun pin as one download-then-run line: POSIX saves the script in a `mktemp -d` folder before `bash` runs it; Windows saves `install.ps1` with `curl.exe` and runs it with `powershell.exe` only when the download succeeds. Keep every new install hint download-then-run (`AGENTS.md` `## Security`) (verify: `bunx vitest run cli/test/unit/deps.test.ts -t "gives a pinned download-then-run Bun hint on every host"`).
- `logger.ts` `err` writes immediately, also inside an exclusive section. `warn`, `change`, and `echo` stay in a buffer until the section ends.
- `cli/src/services.ts` builds the live services at module load. `LoggerTest`, `PlatformTest`, and `DependencyManagerTest` have no consumer (verify, prints only the three `cli/src/services.ts` definitions: `git grep -n -e LoggerTest -e PlatformTest -e DependencyManagerTest -- cli`).

## References

- `cli/src/engine-native/DESIGN.md` § Output Policy, § Platform seam, § Platform Support.
- `cli/test/unit/exec.test.ts`, `deps.test.ts`, `services.test.ts`, `logger.test.ts`, `atomicWrite.test.ts`, `cli/test/unit/os/*.test.ts`.
