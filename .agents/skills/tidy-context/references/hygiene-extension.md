# docks-kit-omp hygiene extension

`SoT/.omp/plugin/extensions/hygiene.ts` — `docksKitOmp` — the omp extension that exposes `docks-kit scratch` and `docks-kit tidy --report` as tools, records the resources that bash commands create, and starts the background sweep (verify: `grep -n "export default function docksKitOmp" SoT/.omp/plugin/extensions/hygiene.ts`).

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

## Module rules

- Import only `node:` modules; omp loads the file without a package install.
- Start every subprocess without a shell: `run` (`execFile`, `shell: false`) for the tools and the Docker checks, and `spawn` with `shell: false` for the sweep. A tool argument never reaches a shell.
- `resolveDocksKit` takes only an absolute PATH entry; on Windows only `docks-kit.exe`.
- Each event handler (`tool_result`, `session_stop`, `session_start`) catches its errors and returns `undefined`, so a hygiene failure never stops a session. A tool rethrows its error through `toError`, which maps ENOENT to the "not on PATH" message.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "passes shell syntax to the child as one literal argument"`.

## Tools

| Tool | Runs | Checks before the call |
|---|---|---|
| `scratch_new` | `docks-kit scratch new <label>`; records a `scratch` resource from `lastAbsoluteLine` | `LABEL_PATTERN` |
| `scratch_remove` | `docks-kit scratch remove <paths>` | non-empty, every path absolute |
| `tidy_report` | `docks-kit tidy --report` | none; read-only |

Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "registers the three tools and the three handlers"`.

## tool_result handler

1. Skip a non-bash or failed call.
2. Skip a command that `TRIGGER` does not match. Each detection rule needs a word in `TRIGGER`.
3. `detectResources(command, cwd, output, home)` splits the command with `scopedSegments` (the scoped form behind the exported `splitShellSegments`), applies `cd` and `DOCKER_*` state per subshell scope, and records `worktree`, `compose`, `container`, `scratch`, `tempDir`, `tempFile`, or `other` resources (`other` comes from `otherRules`).
4. A path or ID that is not literal in the command or in output that one command owns gives a generic note, not a ledger entry.
5. Return `creationReminder` lines as `additionalContext`.

Add a rule in this order: the `TRIGGER` word, the detection, a `detectResources` case, and a handler case through `bash()` in the "extension handlers" block. A `detectResources` case alone passes even when `TRIGGER` blocks the rule.

Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "reminds after"`.

## Docker targets

- `DockerTarget` keeps the daemon options and `DOCKER_*` variables of the creating command, so `cleanupCommand` and `stillExists` reach the same daemon.
- When the daemon selection is not literal (an unknown export, an `env -u` of a daemon variable, a `sudo` wrapper), detection records no stack; the cases with an unresolved target add the generic note.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "checks a Docker resource at stop on the daemon that created it"`.

## session_stop handler

- Skip when `stop_hook_active` is true.
- For each ledger entry not yet in `reminded`, `stillExists` checks the path or asks Docker (`dockerListsAny`, with a timeout).
- A gone resource leaves the ledger. A live one joins `reminded` and the `stopReminder` text, which ends with the keep sentence.
- `dockerListsAny` returns false on an error or a timeout, so an unreachable daemon drops the resource without a reminder.
- `reminded` lives for the omp process; each resource gets at most one stop reminder.
- The ledger is module state, so the main session sees resources that its subagents created.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "reminds at creation and again at stop while the directory exists"`.

## session_start handler (background sweep)

1. Skip a subagent session (`ctx.agent?.kind === "sub"`).
2. Read the mtime of `tidy.stamp` under `join(homedir(), ".cache", "docks-kit")`; stop unless `sweepDue`.
3. `resolveDocksKit`; a missing binary throws before the claim, so the stamp stays old and the next session tries again.
4. `claimSweep` takes `tidy.stamp.claim` (with a `tidy.stamp.takeover` mutex for a stale claim), reads the stamp again, writes it, and releases the claim. On Windows, `createOwned`, `removeIfPresent`, and `releaseOwned` treat EPERM and EBUSY as contention (`isWindowsContention`): another process deletes or holds the file. A create that fails this way gives no token for that attempt. When the claim is then stale or gone, the takeover path can still take it; otherwise `claimSweep` returns false and a later main session claims the due sweep. A delete or a release that fails this way removes nothing, and the file stays until it is stale. A real access denial on Windows also gives EPERM, and the rule then also counts it as contention, as `tidyLock.ts` does. On other platforms, these codes stay errors.
5. Spawn `docks-kit tidy --apply` detached, `stdio: "ignore"`, spawn errors ignored.

Consequences:

- The stamp is written before the sweep runs; a failed sweep waits a full interval. Its only trace is `tidy.log`.
- The cache directory is a literal copy of `scratch.ts kitCacheDir`. Change both together.
- The sweep never passes `--repo`; it uses the default worktree and scratch roots.
- No unit test covers the spawn; the tests cover `sweepDue`, `claimSweep` races, the Windows contention rule, and handler registration.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "lets exactly one of eight processes start the sweep"`.
- Probe: `bunx vitest run cli/test/unit/ompKitPluginExtension.test.ts -t "claimSweep on Windows while another process deletes a claim file"`.

## Interval and limits

Re-derive before you rely on a value: `grep -nE "^const [A-Z_]+(_MS|_BYTES|_LIMIT) =" SoT/.omp/plugin/extensions/hygiene.ts`.

## Shipping an edit

- `hygiene.ts` is part of the generated SoT payload (`cli/scripts/generate-sot-payload.ts` `TEXT_PAYLOAD_PATHS`). Follow the payload rule in the root `AGENTS.md` "Regenerate the payload" bullet under `## Engineering rules` (verify: `grep -n "Regenerate the payload" AGENTS.md`). `bun run check:generated`, which `bun run check` also runs, fails until you regenerate (verify: `grep -n '"check":' package.json`).
- Sync deploys the plugin; that path belongs to `omp-sync-context` (`ompKitPlugin.ts syncKitPlugin`, `ompPlugins.ts syncPlugins`).
- The run-time cleanup rules for agents live in `SoT/.omp/plugin/skills/workspace-hygiene/SKILL.md` and `SoT/.omp/plugin/commands/cleanup.md`.
