# docks-kit-omp hygiene extension

`SoT/.omp/plugin/extensions/hygiene.ts` — `docksKitOmp` — the omp extension that exposes `docks-kit scratch` and `docks-kit tidy --report` as tools, records the resources that bash commands create, and starts the background sweep (verify: `grep -n "export default function docksKitOmp" SoT/.omp/plugin/extensions/hygiene.ts`).

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

## Module rules

- Import only `node:` modules; omp loads the file without a package install.
- Start every subprocess without a shell: `run` (`execFile`, `shell: false`) for the tools, the Docker checks, and the git stash reads, and `spawn` with `shell: false` for the sweep. A tool argument never reaches a shell.
- `resolveDocksKit` takes only an absolute PATH entry; on Windows only `docks-kit.exe`.
- Each event handler (`tool_call`, `tool_result`, `tool_execution_end`, `session_stop`, `session_start`) catches its errors or cannot throw, so a hygiene failure never stops a session. omp blocks a call when a `tool_call` handler throws, so that catch is required. `session_start` keeps the message of a caught error, except a missing launcher, for the next main-session tool result (see `session_start` handler). A tool rethrows its error through `toError`, which maps ENOENT to the "not on PATH" message.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "passes shell syntax to the child as one literal argument"`.

## Tools

| Tool | Runs | Checks before the call |
|---|---|---|
| `scratch_new` | `docks-kit scratch new <label>`; records a `scratch` resource from `lastAbsoluteLine` | `LABEL_PATTERN` |
| `scratch_remove` | `docks-kit scratch remove <paths>` | non-empty, every path absolute |
| `tidy_report` | `docks-kit tidy --report` | none; read-only |

Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "registers the three tools and the five handlers"`.

## tool_result handler

1. `resourceLines` takes the stash snapshot of the call out of `stashSnapshots`, then skips a non-bash call. A failed call with a snapshot still gets the stash comparison (`git stash push -q && false` adds an entry); a failed call records nothing else.
2. It skips a command that `TRIGGER` does not match. Each detection rule needs a word in `TRIGGER`.
3. `detectResources(command, cwd, output, home)` splits the command with `scopedSegments` (the scoped form behind the exported `splitShellSegments`), applies `cd` and `DOCKER_*` state per subshell scope, and records `worktree`, `compose`, `container`, `scratch`, `tempDir`, `tempFile`, or `other` resources (`other` comes from `otherRules`). It stays pure. It also returns `stashes`: the directories where a `git stash` command that can add an entry ran (`stashDirectory`).
4. A path or ID that is not literal in the command or in output that one command owns gives a generic note, not a ledger entry.
5. `createdStashes` records a `stash` resource for each entry in the `git stash list` of a `stashes` directory that the snapshot does not hold (see Git stash entries).
6. `resourceLines` returns the `creationReminder` lines. An error there gives no lines.
7. In the main session, the handler adds `docks-kit sweep did not start: <message>` once when `session_start` kept a sweep error. This step runs for every tool, also for a failed call. A subagent result neither shows nor clears the message.
8. Return the lines as `additionalContext`.

Add a rule in this order: the `TRIGGER` word, the detection, a `detectResources` case, and a handler case through `bash()` in the "extension handlers" block. A `detectResources` case alone passes even when `TRIGGER` blocks the rule.

Probes: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "reminds after"`; `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "shows a sweep error once, on the next tool result of the main session"`.

## Git stash entries

- The command text and the output cannot prove that a `git stash` command added an entry. `git stash push -q` prints nothing, and with nothing to save it adds no entry while `refs/stash` still names an older entry, which can belong to the user.
- The `tool_call` handler (`stashesBefore`) runs before the command. For each `stashes` directory, it keeps the IDs of `git -C <dir> stash list` in `stashSnapshots`, keyed by tool call ID. The read delays the command, so its timeout is 1 second (`STASH_SNAPSHOT_TIMEOUT_MS`). A directory whose list git cannot read in that time gets no snapshot.
- omp sends no `tool_result` for a call that it blocks or that the user denies after `tool_call`. It sends `tool_execution_end` for each call, after the `tool_result` of a call that ran, so the `tool_execution_end` handler removes the snapshot of that call.
- `createdStashes` reads the list again after the command. Only an entry that is not in the snapshot becomes a `stash` resource. It keeps the full ID, the short ID, the reflog message, and the common git directory from `git rev-parse --git-common-dir`. With no snapshot or a failed read, it records nothing.
- An unknown directory (for example `cd "$X"`) gives no stash directory, so nothing is recorded and no note shows.
- The user or another session can add an entry between the two reads, and that entry also counts. A default message (`WIP on <branch>: <commit>`) does not prove the owner either, because two sessions on one branch make the same message. So the reminder names the short ID, the message, and the directory, and tells the agent to pop the entry only when its message is a unique message that the agent gave with `-m`. Otherwise the agent must not pop or drop it and names it in the final answer. The reminder never says to apply "the stash", and the extension takes no automatic action.
- When the worktree of the entry is gone, `cleanupCommand` gives the read-only `git --git-dir=<common dir> stash list --format='%h %gd %gs'`, which needs no worktree, and `cleanupAction` says that the worktree was removed and asks only to name the entry. It suggests no pop: a pop in another worktree would put the changes into a checkout of the user or of another task. The extension never picks another worktree.
- At stop, `stillExists` reads `git --git-dir=<common dir> stash list`, so the read also works after the worktree of the command is gone. A failed read gives no reminder, the same as `dockerListsAny`.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "git stash entries"`.

## Docker targets

- `DockerTarget` keeps the daemon options and `DOCKER_*` variables of the creating command, so `cleanupCommand` and `stillExists` reach the same daemon.
- When the daemon selection is not literal (an unknown export, an `env -u` of a daemon variable, a `sudo` wrapper), detection records no stack; the cases with an unresolved target add the generic note.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "checks a Docker resource at stop on the daemon that created it"`.

## session_stop handler

- Skip when `stop_hook_active` is true.
- For each ledger entry not yet in `reminded`, `stillExists` checks the path, asks Docker (`dockerListsAny`, with a timeout), or reads the stash list (`stashList`, with a timeout).
- A gone resource leaves the ledger. A live one joins `reminded` and the `stopReminder` text, which ends with the keep sentence.
- `dockerListsAny` returns false on an error or a timeout, so an unreachable daemon drops the resource without a reminder.
- `reminded` lives for the omp process; each resource gets at most one stop reminder.
- The ledger is module state, so the main session sees resources that its subagents created.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "reminds at creation and again at stop while the directory exists"`.

## session_start handler (background sweep)

1. Skip a subagent session (`ctx.agent?.kind === "sub"`).
2. Read the mtime of `tidy.stamp` under `join(homedir(), ".cache", "docks-kit")`; stop unless `sweepDue`.
3. `resolveDocksKit`; a missing binary ends the handler before the claim, with no line. The stamp stays old, and the next session tries again. A checkout user who runs `./docks-kit` has no launcher on PATH, so a line would show in each session.
4. `claimSweep` first removes the probe files of exited processes (`removeExitedProbes`, see below). It then takes `tidy.stamp.claim` (with a `tidy.stamp.takeover` mutex for a stale claim), reads the stamp again, writes it, and releases the claim.
5. Spawn `docks-kit tidy --apply` detached, `stdio: "ignore"`, spawn errors ignored.
6. Any other error in steps 2 to 5, such as an error of the claim files or the stamp, keeps its message in `sweepError`. The next main-session tool result shows it once (see `tool_result` handler). A missing `docks-kit` gives no line.

The claim limits load; it does not protect files (`acquireClaim` comment). A stale takeover can still let two sessions claim the same sweep. Each one starts `tidy --apply`. The second one finds `tidy-lock.db` held and stops, or plans from the current state after the first one ends (`commands/tidy.ts runTidy`, see the SKILL `### Lock`).

Windows contention (`isWindowsContention`), used by `createOwned`, `removeIfPresent`, and `releaseOwned` for the `wx` create, the unlink, and the release read:

- EBUSY is contention. libuv gives EBUSY only for a sharing or lock violation.
- EPERM runs a probe (`probeSucceeds`). Windows gives `ERROR_ACCESS_DENIED` (EPERM) both for a "delete pending" name and for a folder that denies the operation. The probe creates `<path>.<pid>.<16 hex>.probe` with `wx`, closes it, and removes it. When both steps succeed, the EPERM is contention. When either step fails, for any reason, the caller throws the original EPERM.
- On contention, a create gives no token for that attempt. When the claim is then stale or gone, the takeover path can still take it; otherwise `claimSweep` returns false and a later main session claims the due sweep. A delete or a release removes nothing, and the file stays until it is stale.
- A process that stops between the probe create and its removal leaves a `.probe` file with its PID. `removeExitedProbes` removes a `tidy.stamp.claim.*.probe` or `tidy.stamp.takeover.*.probe` file when `hasExited` reports its PID (ESRCH). It keeps the file of a live process.
- `removeExitedProbes` unlinks with a best-effort `unlinkSync` that ignores errors and makes no probe. A folder that denies deletes keeps the dead probe file and gets no nested probe file on each due session.
- Residual: a deny ACL on the claim file itself, not on the folder, still reads as contention.
- On other platforms, EPERM and EBUSY stay errors.

Consequences:

- The stamp is written before the sweep runs; a failed sweep waits a full interval. Its only trace is `tidy.log`. A sweep that does not start because of a claim or stamp error shows one `docks-kit sweep did not start` line.
- The cache directory is a literal copy of `scratch.ts kitCacheDir`. Change both together.
- The sweep never passes `--repo`; it uses the default worktree and scratch roots.
- No unit test covers the spawn; the tests cover `sweepDue`, `claimSweep` races, the Windows contention rule and its probe, the probe cleanup, the sweep error line, and handler registration.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "lets exactly one of eight processes start the sweep"`.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "claimSweep on Windows while another process deletes a claim file"`.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "when the create of the probe fails with EPERM"`.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "removes the probe files of an exited process"`.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "makes no probe for an exited probe file that the folder does not let it remove"`.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "shows no sweep error and makes no claim when docks-kit is not on PATH"`.

## Interval and limits

Re-derive before you rely on a value: `grep -nE "^const [A-Z_]+(_MS|_BYTES|_LIMIT) =" SoT/.omp/plugin/extensions/hygiene.ts`.

## Shipping an edit

- `hygiene.ts` is part of the generated SoT payload: `cli/scripts/generate-sot-payload.ts` `payloadSourcePaths` takes every file under `SoT/.omp/plugin/`. Follow the payload rule in the root `AGENTS.md` "Regenerate the payload" bullet under `## Engineering rules` (verify: `grep -n "Regenerate the payload" AGENTS.md`). `bun run check:generated`, which `bun run check` also runs, fails until you regenerate (verify: `grep -n '"check":' package.json`).
- Sync deploys the plugin; that path belongs to `omp-sync-context` (`ompKitPlugin.ts syncKitPlugin`, `ompPlugins.ts syncPlugins`).
- The run-time cleanup rules for agents live in `SoT/.omp/plugin/skills/workspace-hygiene/SKILL.md`, `SoT/.omp/plugin/commands/cleanup.md`, and the trigger rule files in `SoT/.omp/plugin/rules/` (`temp-and-background.md`, `worktree-location.md`, `remote-cleanup.md`).
