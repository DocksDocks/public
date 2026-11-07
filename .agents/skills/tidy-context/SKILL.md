---
name: tidy-context
description: "Use when modifying the docks-kit agent-leftover sweep or checked temporary-path removal: tidy.ts planTidy, applyTidy, agentRoots, checkWorktree, isLocalDockerEndpoint, localDocker, resolveProcessCwds, or isProtectedProcess; kitLock.ts acquireKitLock and the tidy-lock.db apply lock; processes.ts processExited; tidyReport.ts buildTidyReport; scratch.ts createScratchDir, allowedRemovalRoots, or removeTemporaryPath; commands tidy.ts runTidy and scratch.ts (docks-kit tidy --apply, --repo, --report; docks-kit scratch new and remove); or the omp extension hygiene.ts with scratch_new, scratch_remove, tidy_report, detectResources, claimSweep over tidy.stamp.claim, and its Windows EPERM probe. Not for agent cleanup conduct inside a session (use workspace-hygiene) or deployment and linking of the docks-kit-omp plugin (use omp-sync-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/engine-native/tidy.ts
      lines: "1-1279"
    - path: cli/src/engine-native/tidyReport.ts
      lines: "1-509"
    - path: cli/src/engine-native/kitLock.ts
      lines: "1-121"
    - path: cli/src/engine-native/processes.ts
      lines: "1-16"
    - path: cli/src/engine-native/scratch.ts
      lines: "1-206"
    - path: cli/src/commands/tidy.ts
      lines: "1-148"
    - path: cli/src/commands/scratch.ts
      lines: "1-75"
    - path: SoT/.omp/plugin/extensions/hygiene.ts
      lines: "1-2051"
    - path: cli/test/unit/tidy.test.ts
      lines: "1-639"
    - path: cli/test/unit/kitLock.test.ts
      lines: "1-398"
    - path: cli/test/unit/tidyReport.test.ts
      lines: "1-168"
    - path: cli/test/unit/scratch.test.ts
      lines: "1-187"
    - path: cli/test/unit/ompKitPluginExtension.test.ts
      lines: "1-1332"
    - path: cli/test/lib/gitSandbox.ts
      lines: "1-181"
  updated: "2026-11-07"
---

# Tidy, Scratch, and Hygiene Context

EngineNative owns the agent-leftover sweep (`docks-kit tidy`), the checked
temporary-path removal (`docks-kit scratch`), and the omp extension that calls both.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

<constraint>
1. Fail closed. A check that cannot prove a candidate safe keeps it, with a reason in `TidyPlan.kept` or `TidyPlan.notes`. An `lstat` error, a missing process list, or a non-local Docker endpoint never counts as "absent" or "idle".
2. Send every tidy Docker call through `tidy.ts localDocker`. Never call `host.docker` directly; the runner checks `isLocalDockerEndpoint` again and puts `--host <endpoint>` first.
3. Delete leftover files and directories only through `scratch.ts removeTemporaryPath` (scratch entries) and `git worktree remove` without `--force` (worktrees). Container, volume, and network removal goes through `tidy.ts localDocker` (constraint 2). Never add `rmSync`, `rm -rf`, or `--force` on a worktree removal to tidy.
4. Policy facts have one home. Read the `cli/AGENTS.md` module-layout rows for `scratch.ts` and `tidy.ts`, and the root `AGENTS.md` owner-decision bullet that every workstation resource is development; point at them and do not copy them.
</constraint>

## When to Use

| Change | Start at |
|---|---|
| A new leftover class, keep reason, or threshold | `cli/src/engine-native/tidy.ts` — `planTidy`, `checkWorktree` |
| Apply order, signals, Docker or git removal calls | `cli/src/engine-native/tidy.ts` — `applyTidy` |
| The apply lock: when it is taken, what a held lock prints | `cli/src/commands/tidy.ts` — `runTidy`; `cli/src/engine-native/kitLock.ts` — `acquireKitLock` |
| `--report` sections, hints, process filters | `cli/src/engine-native/tidyReport.ts` — `buildTidyReport` |
| Scratch creation, removal roots, path trust | `cli/src/engine-native/scratch.ts` — `createScratchDir`, `removeTemporaryPath` |
| CLI flags, output lines, exit status | `cli/src/commands/tidy.ts` — `runTidy`, `tidyCommand`; `cli/src/commands/scratch.ts` — `scratchCommand` |
| omp tools, reminders, the background sweep | `SoT/.omp/plugin/extensions/hygiene.ts`; see `references/hygiene-extension.md` |

## Core Patterns

### Module map

- `cli/src/engine-native/tidy.ts` — `planTidy` — read-only plan; it runs only listing commands. Unprobed: no unit test asserts the kind of each command. Read each `runDocker` and `host.git` call that `planTidy` reaches (verify: `grep -n -e "runDocker(\[" -e "host.git(\[" cli/src/engine-native/tidy.ts`)
- `cli/src/engine-native/tidy.ts` — `applyTidy` — performs a `TidyPlan` and appends to `tidy.log`; its caller holds `tidy-lock.db` (verify: `bunx vitest run cli/test/unit/tidy.test.ts -t "containers first, then the worktree"`)
- `cli/src/engine-native/tidy.ts` — `TidyHost`, `defaultTidyHost` — the injection seam for `git`, `docker`, `dockerEndpoint`, `run`, `processes`, `now` (verify: `grep -n "export interface TidyHost" cli/src/engine-native/tidy.ts`)
- `cli/src/commands/tidy.ts` — `runTidy` — `tidyCommand` resolves the inputs and calls it. With `--apply`, it takes `tidy-lock.db` before `planTidy` and releases it before `--report` runs (verify: `bunx vitest run cli/test/unit/tidy.test.ts -t "plans only under the lock"`)
- `cli/src/engine-native/kitLock.ts` — `acquireKitLock`, `releaseKitLock` — the SQLite lock of `tidy --apply` and of sync. It imports only `node:` modules, so a test child can load it alone (verify: `grep -n 'from "' cli/src/engine-native/kitLock.ts`)
- `cli/src/engine-native/processes.ts` — `processExited` — true only when `process.kill(pid, 0)` throws ESRCH. `tidy.ts darwinProcesses` (the macOS cwd probe) uses it to tell an exited PID from an unreadable cwd. Unprobed: no unit test runs the macOS probe (verify: `grep -n "processExited(pid)" cli/src/engine-native/tidy.ts`)
- `cli/src/engine-native/tidyReport.ts` — `buildTidyReport` — read-only sections; reuses `tidy.ts` helpers (verify: `grep -n 'from "./tidy"' cli/src/engine-native/tidyReport.ts`)
- `cli/src/engine-native/scratch.ts` — `kitCacheDir`, `scratchRoot`, `tidyApplyLockPath`, `syncLockPath` — owner of `~/.cache/docks-kit`, its `scratch/` child, and the lock files `tidy-lock.db` and `sync-lock.db` (verify: `grep -n -e "export function kitCacheDir" -e "LockPath(home" cli/src/engine-native/scratch.ts`)

### Plan model

- `TidyAction` has five kinds; `actionVerb` maps them to `stop` or `remove`. List them, do not copy them (verify: `grep -n 'readonly kind: "\(remove\|stop\)-' cli/src/engine-native/tidy.ts`).
- `TidyPlan` holds `actions`, `kept`, `notes`, and `docker`. `docker` is the `DockerAccess` that the plan resolved once; `applyTidy` and `buildTidyReport` reuse it.
- `planTidy` returns actions in a fixed order: stop processes, remove worktrees, stop containers, remove containers, remove scratch.
- The CLI prints `<verb> <subject>: <reason>`, `keep <subject>: <reason>`, and `note: <note>`. Keep reason strings stable; tests assert them verbatim.

### Roots guard

- `agentRoots` normalizes the worktree root and the scratch root through `normalizePath` (real path when it exists) and drops a root that equals or contains the home directory.
- `agentWorktreeRoot` uses an absolute `XDG_DATA_HOME`, else `~/.local/share`, plus `agent-worktrees`.
- Probe: `bunx vitest run cli/test/unit/tidy.test.ts -t "refuses a root that contains the home directory"` must fail if `agentRoots` stops calling `isSameOrInside(path, home)`.

### Worktree checks

`checkWorktree` runs these checks in order; the first failed check keeps the worktree.

1. The path contains the home directory: keep.
2. The admin directory from the `.git` file is missing: keep `main repository is missing`.
3. Admin `locked` file: keep `locked`.
4. `git status --porcelain -z` fails or lists a path: keep.
5. No `origin/HEAD`, `origin/main`, or `origin/master` (`defaultBranchRef`): keep.
6. `HEAD` is not an ancestor of that ref: keep `not merged into <ref>`.
7. Admin `HEAD`, `index`, `logs/HEAD` are younger than the worktree idle threshold: keep `active N h ago`.
8. A process cwd is inside: keep `in use by a running process`; no process list: keep `process list unavailable`.
9. `worktreeRepository` cannot prove a linked worktree of `<common>/worktrees`: keep.

Probe: `bunx vitest run cli/test/unit/tidy.test.ts -t "removes the merged idle worktree"` must fail when a check moves after the removal verdict.

`--repo <path>` takes candidates from `git worktree list --porcelain` of that repository at any location, drops the main worktree and prunable entries, and adds the candidate paths to the container territory. Its dry-run hint repeats `--repo`, because a bare `--apply` performs a different plan.

### Container rules

- `resolveDockerAccess` reads `docker context inspect`; only `unix:///...` or `npipe:////./pipe/...` passes `isLocalDockerEndpoint`.
- `missing` docker: note only; the worktree rule still runs. `not-local` endpoint or a failed `docker ps`: every removable worktree stays (`containersUnknown`).
- A container group inside a removable worktree joins that `remove-worktree` action (no separate idle check).
- A group in the territory whose directory `lstat` reports absent: `remove-containers`. An unknown `lstat` state keeps it with a note.
- A running group in a present directory needs an owner (linked worktree or first-level scratch entry), an idle owner, and no process cwd inside: `stop-containers`.
- Probes: `bunx vitest run cli/test/unit/tidy.test.ts -t "no container action, and every removable worktree stays"`; `bunx vitest run cli/test/unit/tidy.test.ts -t "fails each container action when the plan carries no local endpoint"`.

### Orphan process rule

- A process row qualifies when all of these are true:
  - Its parent is in `orphanParents` (PID 1 or a user `systemd`).
  - Its age reaches the stack idle threshold.
  - Its cwd is readable and inside the worktree root or the scratch root.
  - `isProtectedProcess` is false.
- `resolveProcessCwds` drops an exited PID, keeps a known service with an unreadable cwd (`UNREADABLE_CWD_NAMES`) without a cwd, and returns `undefined` for any other unreadable cwd.
- Apply sends SIGTERM only; ESRCH counts as stopped.
- Probe: `bunx vitest run cli/test/unit/tidy.test.ts -t "returns undefined when any other live process has an unreadable cwd"`.

### Scratch rule

- Each first-level entry of the scratch root: a symbolic link is kept; activity is the latest `lstat` mtime of the entry and its immediate children (`entryActivity`).
- Idle past the scratch threshold and no process cwd inside: `remove-scratch`.
- `applyTidy` checks activity again before removal and removes through `removeTemporaryPath(path, [scratchRoot], home)`.
- Probe: `bunx vitest run cli/test/unit/tidy.test.ts -t "keeps an old scratch entry whose children it cannot list"`.

### Apply order

1. `runTidy` takes `tidy-lock.db` with `waitMs: 0`, then runs `planTidy`. When another run holds the lock, it prints only `another docks-kit tidy run holds <path>`, with no plan and no report, and leaves the exit code unset.
2. `applyTidy` sends SIGTERM to each `stop-process` PID.
3. Each `remove-worktree`: `docker rm --force --volumes` its containers, remove its compose networks, then `git worktree remove -- <path>`; then `git worktree prune` once per touched repository.
4. `docker stop` for `stop-containers`; `docker rm --force --volumes` plus networks for `remove-containers`.
5. Scratch removals; append all lines to `tidy.log` (rotated to `tidy.log.1` past the byte limit).
6. `runTidy` releases the lock (`Effect.acquireUseRelease`), then runs `--report` when it is set.

Probes: `bunx vitest run cli/test/unit/tidy.test.ts -t "containers first, then the worktree"` asserts the order, the `--host` prefix, and no git `--force`. `bunx vitest run cli/test/unit/tidy.test.ts -t "prints the held line and plans nothing while another run holds the lock"` asserts step 1.

### Temporary-path removal

`removeTemporaryPath` removes a path only when all checks pass. It runs the checks in this order and refuses at the first failed check:

1. The path exists.
2. It is not a symbolic link, also with trailing separators.
3. Its real path is strictly inside one root and is not a root.
4. It does not contain home.
5. On POSIX, the user owns it, and no other user can change a directory on its path (`untrustedParent`).
6. It is on the filesystem of its root.

`allowedRemovalRoots` takes the scratch root and `tmpdir()`. Except on Windows, it also takes `/tmp` and `/var/tmp`. It drops a root that does not resolve, a duplicate, a filesystem root, and a root that contains home. It also drops an untrusted root (`isTrustedRoot`). A root is untrusted when one of these is true:

- Neither the user nor root owns it.
- Group or others can write it, and it has no sticky bit.
- It is below a directory that another user can change.

Probes: `bunx vitest run cli/test/unit/scratch.test.ts -t "refuses a symbolic link and a link escape"`; `bunx vitest run cli/test/unit/scratch.test.ts -t "drops a root that others can write without the sticky bit"`.

### Lock

- `kitLock.ts acquireKitLock(path, { waitMs })` makes the directory (mode 0700), opens `DatabaseSync(path)`, and sets `busy_timeout = 0`. It tries `BEGIN IMMEDIATE` every `POLL_MS` until it succeeds or `waitMs` ends. It returns `{ kind: "acquired", lock }` or `{ kind: "held" }`.
- The lock is the RESERVED lock of that transaction, and only one connection can hold RESERVED. `BEGIN EXCLUSIVE` is wrong here: two racers that each hold SHARED while they move up can both fail at `waitMs: 0`.
- At most one connection, in any process, holds the lock. The OS releases it when the holder process ends for any reason. A paused holder keeps it. No staleness rule and no takeover exist.
- A module-level set keeps each held connection, so the garbage collector cannot close a lock that a caller dropped.
- `releaseKitLock` runs `ROLLBACK`, closes the connection, and removes it from the set.
- The database stays in rollback journal mode. Never set WAL on a lock file.
- Lock files: `scratch.ts tidyApplyLockPath` gives `~/.cache/docks-kit/tidy-lock.db` (`tidy --apply`). `syncLockPath` gives `sync-lock.db` (sync and model writes; see `sync-orchestration-context`). `folderSyncLockPath` gives `<folder>/.docks-kit-sync-lock.db` in a Codex or agents folder that a sync writes. These locks keep the folder mode (`privateDirectory: false`). A legacy text `tidy.lock` is not a database, and no code reads it.
- Probes: `bunx vitest run cli/test/unit/kitLock.test.ts -t "lets exactly one of 8 racing processes"`; `bunx vitest run cli/test/unit/kitLock.test.ts -t "lets exactly one of 4 racers that start at the same moment"`; `bunx vitest run cli/test/unit/kitLock.test.ts -t "lets a contender take the lock after the holder process gets SIGKILL"`; `bunx vitest run cli/test/unit/kitLock.test.ts -t "keeps the lock across a forced garbage collection"`.

### Report

- Linux and macOS only. Each section runs alone; a throw becomes `unavailable: <message>`; an empty section is dropped.
- The process section lists old orphans whose argument file names match `DEV_PROCESS`, plus old processes in agent or temporary roots, never a protected process.
- Docker data comes from `docker system df` through `localDocker` with the plan's access.
- List the sections: `grep -n 'section("' cli/src/engine-native/tidyReport.ts`.
- Probe: `bunx vitest run cli/test/unit/tidyReport.test.ts -t "never calls Docker through an endpoint that is not local"`.

### Volatile thresholds

Re-derive before you rely on a value.

| Constant | Meaning | Verify |
|---|---|---|
| `WORKTREE_IDLE_MS`, `STACK_IDLE_MS`, `SCRATCH_IDLE_MS` | Worktree, container/orphan, and scratch idle thresholds | `grep -n -e "WORKTREE_IDLE_MS =" -e "STACK_IDLE_MS =" -e "SCRATCH_IDLE_MS =" cli/src/engine-native/tidy.ts` |
| `LOG_ROTATE_BYTES` | `tidy.log` size that triggers rotation | `grep -n "LOG_ROTATE_BYTES =" cli/src/engine-native/tidy.ts` |
| `POLL_MS` | Time between two lock tries | `grep -n "POLL_MS =" cli/src/engine-native/kitLock.ts` |
| `REPORT_PROCESS_AGE_MS`, `RECENT_MS` | Report process age and "recent" window | `grep -n -e "REPORT_PROCESS_AGE_MS =" -e "RECENT_MS =" cli/src/engine-native/tidyReport.ts` |
| `SWEEP_INTERVAL_MS`, `CLAIM_STALE_MS` | Background sweep interval and claim staleness | `grep -n -e "SWEEP_INTERVAL_MS =" -e "CLAIM_STALE_MS =" SoT/.omp/plugin/extensions/hygiene.ts` |

## Key Decisions

| Decision | Why | Probe |
|---|---|---|
| Plan and apply are separate; the CLI is a dry run without `--apply` | The user and the agent see every action and keep reason first | `bunx vitest run cli/test/unit/tidy.test.ts -t "plans without the lock in a dry run"` |
| `--apply` plans under the lock | A plan made outside the lock can wait behind another apply and then act on stale worktrees and PIDs | `bunx vitest run cli/test/unit/tidy.test.ts -t "plans only under the lock"` |
| Docker endpoint verified once per run and carried in `TidyPlan.docker` | `DOCKER_HOST` or a context can send a plain `docker` call to a remote host; a compose label does not prove a local daemon | `bunx vitest run cli/test/unit/tidy.test.ts -t "fails each container action when the plan carries no local endpoint"` |
| No process list keeps every in-use-dependent candidate | An unreadable cwd could belong to a process in an agent directory | `bunx vitest run cli/test/unit/tidy.test.ts -t "process list is unavailable"` |
| Worktree removal never uses `--force` | git refuses a dirty or locked worktree, a second guard after `checkWorktree` | `bunx vitest run cli/test/unit/tidy.test.ts -t "containers first, then the worktree"` |
| Scratch removal reuses `removeTemporaryPath` | One checked deletion path for the CLI, the omp tool, and tidy | `bunx vitest run cli/test/unit/scratch.test.ts -t "removeTemporaryPath"` |
| An SQLite lock with no takeover | A file lock with a stale reclaim kept a window where two runs held it, and a takeover could remove the lock of a live run. The OS releases an SQLite lock when its holder ends, so no staleness rule is necessary | `bunx vitest run cli/test/unit/kitLock.test.ts -t "lets a contender take the lock after the holder process gets SIGKILL"` |
| The workstation sweep runs without a question | Owner decision; read it in the root `AGENTS.md` owner-decision bullet, not here | `grep -n "resources on the workstation are always development" AGENTS.md` |

## Gotchas

| Gotcha | Failure scenario | Guard or probe |
|---|---|---|
| `entryActivity` reads only the entry and its immediate children | An agent appends to `scratch/run-x/out/deep/log.txt` for days with no cwd inside; the entry looks idle and is removed | Put a process cwd in the entry, or touch the entry; a deeper scan changes the rule, so update the scratch test first |
| Worktree activity ignores git-ignored files | A stack that writes only to an ignored `dist/` does not refresh activity; a merged clean worktree is removed | `checkWorktree` runs `git status --porcelain -z` without `--ignored`: `grep -n -e '"--porcelain", "-z"' cli/src/engine-native/tidy.ts` |
| Containers in a removable worktree skip the container idle rule | A running container with an anonymous volume is removed with `docker rm --force --volumes` | Docker documents `--force` as SIGKILL and `--volumes` as anonymous-volume removal: https://docs.docker.com/reference/cli/docker/container/rm |
| `missing` docker is not `containersUnknown` | With no `docker` CLI, worktrees are still removed | `bunx vitest run cli/test/unit/tidy.test.ts -t "keeps the worktree rule when docker is not installed"` |
| Silent skips | A container group outside the territory, a stopped group in a present directory, a vanished scratch entry, or an orphan with no cwd gets no `keep` line | Read `planTidy` before you claim "everything is listed" |
| Windows has no process list | Every worktree and scratch entry stays, and the orphan rule is off | `grep -n "process.platform ===" cli/src/engine-native/tidy.ts` |
| A held lock exits 0 | A script reads "another docks-kit tidy run holds" as success | `runTidy` leaves the exit code unset when the lock is held; `bunx vitest run cli/test/unit/tidy.test.ts -t "prints the held line and plans nothing while another run holds the lock"` |
| `applyTidy` does not take the lock | A new caller that skips `runTidy` applies a plan with no lock, next to a running sweep | Call `applyTidy` only through `runTidy`: `grep -rn "applyTidy(" cli/src` |
| A paused or hung holder keeps the lock | A stopped `tidy --apply` (SIGSTOP, a hung `git` or `docker` call) makes every later apply print the held line until it ends | End the holder process; the OS then releases the lock |
| A second acquire in one process gets `held` | A nested call that takes the same lock again waits the full bound, then reports the lock as held | Take each lock once per run: `bunx vitest run cli/test/unit/kitLock.test.ts -t "refuses a second acquire in the same process"` |
| Any read of a lock file in the holder process drops the lock | POSIX ends every lock of a process when the process closes any descriptor of the file (https://www.sqlite.org/howtocorrupt.html, section 2.2); another run then takes the lock while the first still holds its transaction | Only `kitLock.ts` opens a lock file: `git grep -n -e "tidy-lock.db" -e "sync-lock.db" -- cli/src/engine-native` names only `scratch.ts` |
| `isSameOrInside(parent, child)` order | A swapped call reverses a guard without a type error | `bunx vitest run cli/test/unit/tidy.test.ts -t "refuses a root that contains the home directory"` |
| `isProtectedProcess` matches `/.omp/` or `/tern/` anywhere in `args` | An orphan started with a config path under `~/.omp/` is never stopped | `bunx vitest run cli/test/unit/tidyReport.test.ts -t "lists old orphaned tools"` |
| `removeProjectNetworks` ignores a failed `network rm` | A network that another container uses stays with no `failed` line | By design; do not count it as a failure |
| `hygiene.ts` copies `kitCacheDir`, `LABEL_PATTERN`, and `processes.ts processExited` (as `hasExited`) | A change on one side splits `tidy.stamp` from `tidy-lock.db`, lets the tool accept a label that the CLI rejects, or makes the probe cleanup and the CLI disagree on when a PID has exited | `grep -n -e "kitCacheDir" -e "LABEL_PATTERN =" -e "function hasExited" -e "function processExited" SoT/.omp/plugin/extensions/hygiene.ts cli/src/engine-native/scratch.ts cli/src/engine-native/processes.ts` |
| Untested paths | Network removal, log rotation, `--repo` listing, the apply-time scratch recheck, the `tidyCommand` input resolution, and the `session_start` spawn have no unit test | Add a should-fail case with any change there |

## References

- `references/hygiene-extension.md` — omp tools, reminders, the ledger, the `TRIGGER` gate, the sweep claim, and payload regeneration.
- `cli/AGENTS.md` — `### Module layout` rows for `scratch.ts` and `tidy.ts` (verify: `grep -n -e "engine-native/scratch.ts" -e "engine-native/tidy.ts" cli/AGENTS.md`).
- `AGENTS.md` — the owner-decision bullet on development resources (verify: `grep -n "resources on the workstation are always development" AGENTS.md`).
- `cli/docs/flags.md` — the `scratch` and `tidy` section: user-facing flag effects and on-disk paths (verify: `grep -n -e "scratch new" -e "tidy --apply" cli/docs/flags.md`).
- `SoT/.omp/plugin/skills/workspace-hygiene/SKILL.md` — agent conduct for cleanup at run time.
- `cli/test/lib/gitSandbox.ts` — `createGitSandbox`: the worktree fixture behind the tidy and report tests (`SandboxWorktrees` names each worktree).
