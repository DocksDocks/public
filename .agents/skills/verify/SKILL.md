---
name: verify
description: "Use when checking a change to docks-kit end to end: run the CLI the way a user does (sync dry run, toolchain doctor, removed target and flag), the dry-run goldens, the real omp on the kit trigger rules, and the kit plugin smoke in an isolated omp state, and inspect exit codes and output lines. Not for unit tests (run `bun run test:unit`), lint, or a release."
metadata:
  updated: "2026-11-20"
---

# Verify docks-kit

docks-kit is a CLI that a user runs from the checkout (`./docks-kit`) or from the global install. Flows V1 to V4 run it from the repository root and read its exit code and output. V5 runs the real omp on the kit trigger rules. V6 links the kit plugin into the real omp in an isolated state. No flow writes to the home folder outside a docks-kit scratch folder: `sync --dry-run` plans the deploy only, the golden suite runs each case in its own temporary home, `omp ttsr test --rule` tests one rule file without loading other rules, and V6 writes only to its scratch folder and removes it at the end.

Hosts: the commands below are POSIX shell for Linux and macOS. On Windows, run `.\docks-kit.ps1` in place of `./docks-kit` for V1 and V4 and read the exit code from `$LASTEXITCODE`; for V2, read the omp row of `.\docks-kit.ps1 toolchain check`. V3 does not run on Windows: `cli/test/golden-dryrun.ts` exits 2 on a host whose executables need a suffix, because the snapshots are Linux-canonical. On Windows, run `bun run typecheck`, `bun run test:unit`, and `bun run smoke:native` instead. V6 does not run on Windows: omp reads the home folder from `HOME` only on Linux and macOS, so `omp-smoke.ts` prints `FAIL omp-smoke.ts runs on Linux and macOS only` and exits 2.

## Prerequisites

| Need | Check command | Expected result |
|---|---|---|
| Bun at the CI pin | `bun --version` | `1.4.4` |
| omp at the toolchain floor | `omp --version` | `omp/19.0.0` |
| Dependencies installed | `test -d node_modules && echo present` (PowerShell: `if (Test-Path node_modules) { 'present' }`) | `present` |
| docks-kit on PATH (V6 scratch folder) | `docks-kit --version` | One version line |

## Drive and inspect

| Id | Flow | Command or tool action | Expected result |
|---|---|---|---|
| V1 | omp sync plan | `./docks-kit sync --dry-run; echo "exit $?"` | Lines that start with `[dry-run]` and name only omp, `~/.pi/agent/intercom`, and `~/.docks-kit/omp-plugin` paths, never `~/.agents` or `~/.claude`; then `--- Sync complete ---`, a `Repo:` line, an `omp:` line, and `exit 0`. The kit plugin is one line, `[dry-run] sync embedded:SoT/.omp/plugin/ -> <home>/.docks-kit/omp-plugin`, not one `cp` line for each file. Then `[dry-run] omp plugin uninstall --scope user docks@docks` and `[dry-run] omp plugin uninstall --scope user plan-lifecycle@docks`, and `[dry-run] omp plugin marketplace remove docks` only when an omp registry lists the `docks` marketplace. No `omp plugin install` line names `docks@docks` or `plan-lifecycle@docks`. Observed 2026-11-20 on Linux x64 with omp 19.0.1, on a home whose registry lists `docks`: 9 `[dry-run]` lines (`cp embedded:SoT/.omp/...` for the 3 agent-folder files that differ, `sync embedded:SoT/.omp/plugin/ -> /home/<user>/.docks-kit/omp-plugin`, `omp plugin uninstall --scope user docks@docks`, `omp plugin uninstall --scope user plan-lifecycle@docks`, `omp plugin marketplace remove docks`, `omp install pi-intercom@0.14.0`, `omp plugin link /home/<user>/.docks-kit/omp-plugin`), a blank line, `--- Sync complete ---`, `Repo:     <checkout>`, `omp:      /home/<user>/.omp/agent`, `exit 0` |
| V2 | Toolchain doctor | `./docks-kit toolchain check 2>&1 \| grep -E '^omp '` | One omp row whose INSTALLED, FLOOR, and VERIFIED columns are equal and whose STATUS is `ok` |
| V3 | Dry-run goldens through the engine and the public CLI | `bun run golden:dryrun` | A line `golden-dryrun: OK (<n> case(s))` and exit 0 |
| V4 | Removed sync target and flag | `./docks-kit sync omp --dry-run; echo "exit $?"; ./docks-kit sync --dry-run --prune; echo "exit $?"` | First the sync help on stdout, then `ERROR` and `Unexpected positional argument: "omp"` on stderr, and `exit 1`. Then `unknown flag --prune for 'sync'` and `exit 2`. Observed 2026-11-19 on Linux x64: exactly these lines |
| V5 | Trigger rules on a large tool call, in the real omp | `bun .agents/skills/verify/scripts/ttsr-snippet.ts big-reset \| omp ttsr test --rule SoT/.omp/plugin/rules/git-safety.md --source tool --tool eval --file -`, then the same command with `big-quiet` | For `big-reset`, `Triggered (1)` and a `git-safety` line within a few seconds. For `big-quiet`, `No rules triggered. (evaluated 1)`. The `big-reset` snippet is a 21 KB eval cell with many `\"` escapes that ends with `sh("git reset --hard HEAD")`. The rules of 0.22.29 stayed quiet on it after 4.7 s: JavaScriptCore stopped at its match limit and reported no match, so the rule failed open |
| V6 | Kit plugin in the real omp, isolated | `bun .agents/skills/verify/scripts/omp-smoke.ts; echo "exit $?"`, then `bun .agents/skills/verify/scripts/omp-smoke.ts hooks; echo "exit $?"` | The load mode prints `docks-kit-omp -> <checkout>/SoT/.omp/plugin`, `skills: 33`, `agents: code-reviewer,plan-reviewer`, `warnings: 0`, and `exit 0`. The `hooks` mode prints the 18 `ok` lines of the V6 section below and `exit 0`. Observed 2026-11-20 on Linux x64 with omp 19.0.1: exactly these lines; the load mode took 2 s and the `hooks` mode 3 s |

## V6 — Kit plugin smoke in an isolated omp state

`omp-smoke.ts` creates a docks-kit scratch folder and makes all omp state of the run live there. omp gets only `PATH`, `USER`, `LANG`, `LC_*`, and `TERM` from the environment, so no credential and no omp session variable reaches it. It also gets `HOME` set to a home folder in the scratch folder, `PI_CONFIG_DIR` set to a config root relative to that home, and `XDG_STATE_HOME` and `TMPDIR` set to scratch folders. The scratch home holds a fresh `.cache/docks-kit/tidy.stamp`, so the session-start sweep of `hygiene.ts` (`docks-kit tidy --apply`) is not due and does not start. The script starts a fake local OpenAI-compatible model, runs `omp plugin link <checkout>/SoT/.omp/plugin`, and finds the package through the npm row `docks-kit-omp` of `omp plugin list --json`. It removes the scratch folder at the end, also after a failure. The run writes nothing outside the scratch folder: the real `~/.omp`, the real `~/.cache/docks-kit`, and the real `verify-gate.jsonl` stay unchanged. Use `--repo <path>` to test another checkout.

The load mode reads `omp skill list --json` and the task tool of one `omp -p` session. It counts the skills whose file is inside the linked plugin folder (the 32 skills moved from DocksDocks/docks and `workspace-hygiene`), and it lists the plugin agents that the task tool offers. The `hooks` mode makes a scratch git repository with its own git config. The repository holds a root `AGENTS.md`, a root `README.md`, `notes.txt`, and the nested node `scripts/AGENTS.md` with `scripts/ci.mjs`. The fake model plays scripted tool calls in `omp -p --mode json` sessions, and the script reads the JSON event stream, `git log`, and the `verify-gate.jsonl` log of each session. Each session has its own `XDG_STATE_HOME` in the scratch folder. Expected output of the `hooks` mode, in order:

```text
ok install
ok gate-enforce-1-blocked
ok gate-enforce-2-blocked
ok gate-enforce-3-allowed
ok gate-enforce-trailer-allowed
ok gate-observe-commit-runs
ok gate-observe-log
ok gate-off-commit-runs
ok gate-off-no-log
ok gate-log-no-text
ok nudge-node-edit
ok nudge-root-edit-none
ok nudge-failed-edit-none
ok nudge-url-write-none
ok extensions-loaded
ok sessions
ok isolated
ok real-state
exit 0
```

| Line | Session and tool calls | Expected result |
|---|---|---|
| `gate-enforce-1-blocked`, `gate-enforce-2-blocked` | `DOCKS_VERIFY_GATE=enforce`: `bash` `git commit -m 'docs: fix typo'`, two times | Each call is blocked. Its tool result is an error with the reason that names the `Verified:` trailer. |
| `gate-enforce-3-allowed` | Same session: the same commit a third time | The gate allows the commit after two denials in one session. `git log` holds one new `docs: fix typo` commit. |
| `gate-enforce-trailer-allowed` | Same session: `git commit --allow-empty -m 'x' -m 'Verified: none - probe'` | The commit runs, and the last commit holds the trailer. |
| `gate-observe-commit-runs`, `gate-observe-log` | `DOCKS_VERIFY_GATE` unset (observe): one bare commit | The commit runs. The log holds one line with only the fields `time`, `session_id`, `cwd`, `mode` (`observe`), and `message_sources` (`["-m"]`). |
| `gate-off-commit-runs`, `gate-off-no-log` | `DOCKS_VERIFY_GATE=off`: one bare commit | The commit runs. The log holds no line. |
| `gate-log-no-text` | The logs of all gate sessions | No line holds the command or the message text (`git commit`, `fix typo`, `Verified`, `probe`). |
| `nudge-node-edit` | `edit` of `scripts/ci.mjs` | The edit succeeds. After the tool result, the event stream holds a separate added-context message (role `developer`) with `Edited files inside context-tree node(s): scripts`. The tool result itself does not hold that text. |
| `nudge-root-edit-none` | `edit` of the root `README.md` | The edit succeeds. No added-context message follows. |
| `nudge-failed-edit-none` | `edit` of `scripts/ci.mjs` with the stale snapshot tag of the first read | The edit fails. No added-context message follows. |
| `nudge-url-write-none` | `write` to `local://notes.md`; the session folder is inside the `scripts` node | The write succeeds. No added-context message follows. |
| `extensions-loaded` | All sessions | omp reported no warning that names the linked plugin folder or `docks-kit-omp`, and no `Failed to load extension` record for a plugin file, `hygiene.ts` included. |
| `isolated` | The whole run | The `tidy.stamp` of the scratch home kept its modification time, so no hygiene sweep started. |
| `real-state` | The whole run | The real omp registry files kept their modification times. The real `verify-gate.jsonl` has no new line with a `cwd` inside the scratch folder. Lines that other omp sessions add during the run do not count. |

A `FAIL <reason>` line in the load mode, or a `FAIL <name>: <reason>` line in the `hooks` mode, and `exit 1` mean that the check failed; the reason tells what the run saw. A warning count above 0 is a failure, and the `FAIL` line names each warning. `install` and `sessions` fail when an omp command exits with a status other than 0. `FAIL could not remove scratch folder <path>` and `exit 1` mean that the folder stays; remove it with `docks-kit scratch remove <path>`.

## Failure signs

| Sign | Meaning | Next step |
|---|---|---|
| `ignoring stale cli/dist/docks-kit-...; running from source` | The launcher found an old binary and runs the source instead | No action for a flow; run `bun run build:binaries` only when you test the binary |
| `=== GOLDEN MISMATCH` in V3 | The CLI output changed | Read the diff; when the change is intended, run `bun cli/test/golden-dryrun.ts --update-goldens`, then `bun run format` |
| omp row status `below-floor` or `above-verified` in V2 | The installed omp differs from `SoT/toolchain.json` | Check the omp release against the kit before you move the pin |
| V5 prints `No rules triggered.` for `big-reset`, or takes seconds | A condition scans the buffer in more than linear time, or hits the JavaScriptCore match limit | Run `bunx vitest run cli/test/unit/ompTriggerRules.test.ts` and fix the condition that its shape guard or Bun backstop names (`cli/docs/command-guards.md`, omp trigger rules) |
| V6 prints `skills:` other than `33`, or misses an agent | omp did not load a skill or agent file of `SoT/.omp/plugin`, or a folder moved | Check the folders under `SoT/.omp/plugin/skills/` and `SoT/.omp/plugin/agents/`, and the `name` frontmatter of each `SKILL.md` and agent file |
| V6 prints `FAIL extensions-loaded` or `warnings:` above `0` with `Failed to load extension` | A kit extension throws when omp loads it | Fix the file that the `FAIL` line names in `SoT/.omp/plugin/extensions/` |
| V6 prints a `FAIL gate-` or `FAIL nudge-` line | The gate or the nudge acted on the wrong command, path, or node | Check `checkCommand` in `SoT/.omp/plugin/extensions/verify-gate-core.mjs` or `nudgeText` in `SoT/.omp/plugin/extensions/context-tree-core.mjs`, and their adapters `verify-gate.ts` and `context-tree-nudge.ts` |
