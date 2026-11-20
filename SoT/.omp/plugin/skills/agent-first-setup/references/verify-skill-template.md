# Verify skill template

## Contents

| Section | What it holds |
|---|---|
| [Purpose](#purpose) | What a project `verify` skill does and when to create it |
| [Detect](#detect) | The read-only check for the skill and its unverified commands |
| [Create or re-verify](#create-or-re-verify) | The steps that write, verify, or extend the skill |
| [Rules for each command](#rules-for-each-command) | Speed, readiness, expected results, cleanup |
| [Template](#template) | The fill-in `SKILL.md` |
| [Surface recipes](#surface-recipes) | Start, drive, inspect, and stop for each kind of surface |
| [Worked example](#worked-example) | A filled skill for a small HTTP service |
| [Sources](#sources) | Official documentation for the tools that the recipes name |

## Purpose

A project `verify` skill tells an agent how to run the real product the way a user or another program does. It names the commands that start the surface, drive its main flows, inspect the observable results, and stop it. A unit test checks one part. The `verify` skill checks the whole surface after a change.

Create the skill when the project has a runnable surface: a web app, a mobile app, a desktop app, a CLI, a service with an API, or a hook or plugin that a host program calls. Do not create it for a repository that holds only documents, configuration, or a library without a runnable entry point.

The skill lives at `.agents/skills/verify/SKILL.md`, where omp finds project skills.

## Detect

The `docks-kit agent-docs verify-skill` command of the kit CLI runs the detection and the gates below. It needs docks-kit 0.26.0 or later; `docks-kit update` installs it. Run this command from the repository root. It only reads files:

```bash
docks-kit agent-docs verify-skill detect
```

It prints `verify skill: present` or `verify skill: missing`, and one `verify unverified: <n>:<line>` line for each line of the skill that holds `not observed:`. When it cannot read the skill, it prints `ERROR verify skill check failed: cannot read .agents/skills/verify/SKILL.md` and exits with status 2.

Read the lines as follows:

- A `verify unverified:` line is a command that has not shown its expected result: it failed (its mark ends in `; got <failure>`), or no run finished it.
- An `ERROR` line is a failed check, not a verified skill.

The skill is verified when the command prints `verify skill: present` and no `verify unverified:` or `ERROR` line.

## Create or re-verify

Run these steps from the repository root. Run the Detect command right before step 1, also when an earlier step of the run printed its output, because that step can have moved files. Ask each question with the question tool of the harness. An error, an empty result, or a default result is not an answer. When the harness has no question tool, stop at the question, and report the skill as blocked.

A plan step that runs these steps has the approval that the plan recorded for that step. That approval covers each write and each run. It does not answer a question about a missing fact, such as a start command or a test account.

Right before each write of these steps, run the write gate with each path that the step writes. Write only when the gate prints nothing and exits 0. A gate that prints a line or exits with a status other than 0 blocks the write: report the line or the status, write nothing, and stop.

```bash
docks-kit agent-docs verify-skill write-gate <path>...
```

The gate refuses a path that is a symlink, and a path that holds a `..` segment. It also refuses a path whose nearest existing folder cannot be entered, or resolves outside the repository through symlinks.

1. On an `ERROR` line, report it, write nothing, and stop.
2. On `verify skill: present` with a `verify unverified:` line, the skill is not verified yet. Print the unverified rows, and ask for approval to mark every result again and run every command again. After approval, run the write gate with `.agents/skills/verify/SKILL.md`. Before any command runs, write `not observed: expect <result>` on each result that holds no mark: each Prerequisites row, `Ready when:`, each flow, and `Clean when:`. An older mark with no `expect <result>` part lost its expected result: take that result from the git history of the skill or ask the user, and write `not observed: expect <result>; got <the old failure line>`. When neither supplies the expected result, leave the mark as it is, so the skill stays unverified, and report the row. Then run step 9 in full: the prerequisite checks, Start, every flow in order, and Stop. Do not run only the marked rows, because a flow can depend on an earlier flow.
3. On `verify skill: present` with no `verify unverified:` line, the skill is verified. Go to step 10 to add a flow; otherwise stop.
4. Steps 4 to 9 run only on `verify skill: missing`. Find each runnable surface. Read the root `AGENTS.md`, the build files (for example `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `compose.yaml`), and the entry points. Match each surface to a row of [Surface recipes](#surface-recipes).
5. If the repository has no runnable surface, write nothing, report "no runnable surface", and stop.
6. Fill the [Template](#template) for each surface. Use only commands that the repository defines or that the recipes name. Ask the user for a missing start command, port, or test account. No run has shown a result yet, so write each expected result as `not observed: expect <result>`: each Prerequisites row, `Ready when:`, each Drive and inspect row, and `Clean when:`.
7. Print the draft `SKILL.md`, with its `not observed: expect` marks. Ask for approval. The approval covers the write and one run of each command, the prerequisite checks included.
8. After approval, run the write gate with `.agents/skills/verify/SKILL.md`, and run this entry gate right before the write. Write only when both gates print nothing and exit 0. A gate that prints a line, for example a `target occupied` line, or exits with a status other than 0 blocks the write: report the line or the status, write nothing, and stop. The entry gate checks that a new skill overwrites nothing. It prints `target occupied: .agents/skills/verify exists` when an entry is there, a dangling symlink included:

   ```bash
   docks-kit agent-docs verify-skill write-gate .agents/skills/verify/SKILL.md
   docks-kit agent-docs verify-skill entry-gate
   ```

   Write `.agents/skills/verify/SKILL.md`.

9. Run each command of the skill once, in order: the check command of each Prerequisites row, Start, every flow, and Stop. Compare the output of each command with the `expect <result>` part of its mark. Only after the command shows that result, remove the mark, so that the expected result stays. If a command fails or shows another result:
   1. If Start ran, run the Stop and cleanup commands of the skill at once, before you report or ask. No process, port, or temporary folder from this run stays.
   2. Keep the failed command in the skill. Do not remove it. Keep the expected part of its mark and put the failure after it: `not observed: expect <result>; got <first line of the failure>`. A `got` part from an earlier run gets the new line. The commands after it keep their marks.
   3. Do not report the skill as verified. Name the failed command and its output in the report.
   4. Ask the user for the fix, for example a missing service, dependency, or test account.

   The skill is verified only when each command ran and showed its expected result, and the skill holds no `not observed:` entry. Go to step 10 to add a flow; otherwise stop.
10. To add a flow, for example the end-to-end check of a plan, write it in the format of the skill: a row of its Drive and inspect table, or a section like its other flows. Give it a command and the mark `not observed: expect <result>`. Keep each script that the flow runs in the repository, for example in `.agents/skills/verify/scripts/`, not in a temporary folder. Print the new flow, and ask for approval. After approval, run the write gate with `.agents/skills/verify/SKILL.md` and the path of each script. Then write `not observed: expect <result>` on each result of the skill that holds no mark, as step 2 says. Then add the flow, and run step 9 in full.

## Rules for each command

- Make each command fast. Prefer a command that finishes in seconds over a full test suite.
- Wait on a readiness signal: an open port, a health URL that returns 200, or a log line. Do not wait with a fixed `sleep`.
- Name the expected observable result: an exit code, an output line, an HTTP status and body field, element text, or a screenshot detail.
- Write each expected result as `not observed: expect <result>` until a run shows it. This covers each Prerequisites row, `Ready when:`, each Drive and inspect row, and `Clean when:`.
- Run, compare, and mark each command only as steps 2 and 9 of [Create or re-verify](#create-or-re-verify) say.
- Use test data, test accounts, and local ports only. Never point a command at production.
- Name each secret by its environment variable. Do not write a secret value into the skill, and do not print it.
- Stop every process that a command starts. Remove temporary files and free the ports.
- Put the log, the PID file, and other temporary files in a private folder that `mktemp -d` makes. Do not use a fixed path such as `/tmp/<project>.log`: on a shared host, another user can create that path first as a symlink to a file that you can write.
- Use only commands that the project root `AGENTS.md` or its build files already define, or the tools in [Surface recipes](#surface-recipes).

## Template

Replace each `<...>` value. Delete a row or a section that does not apply to the project. Keep each `not observed: expect` mark until a run of the command shows that result.

````markdown
---
name: verify
description: "Use when checking a change to <project> end to end: start <surface>, drive <main flows>, inspect <observable results>, and stop it. Not for unit tests (run <unit test command>), lint, or a release."
metadata:
  updated: "<YYYY-MM-DD>"
---

# Verify <project>

<One sentence: what the surface is and who drives it.>

## Prerequisites

| Need | Check command | Expected result |
|---|---|---|
| <tool and minimum version> | `<command>` | not observed: expect <output> |
| <environment variable> holds <what> | `test -n "$<VAR>" && echo set` | not observed: expect `set` |

## Start

```bash
run=$(mktemp -d)
echo "verify folder: $run"
<start command> > "$run/verify.log" 2>&1 &
echo $! > "$run/verify.pid"
<readiness command>
```

The Stop block reads `$run`. If the shell does not keep variables between blocks, set `run` to the printed folder before you stop.

Ready when: not observed: expect <the readiness command exits 0 | the log shows "<line>">.

## Drive and inspect

| Id | Flow | Command or tool action | Expected result |
|---|---|---|---|
| V1 | <main flow> | `<command>` | not observed: expect <observable result> |
| V2 | <error path> | `<command>` | not observed: expect <observable result> |

## Stop and clean up

```bash
kill "$(cat "$run/verify.pid")"
rm -r "$run"
```

Clean when: not observed: expect `<command>` shows no process and no open port.

## Failure signs

| Sign | Meaning | Next step |
|---|---|---|
| <output> | <cause> | <action> |
````

## Surface recipes

Pick the row for each surface that the project has. Copy its commands into Start, Drive and inspect, and Stop.

| Surface | Start | Drive | Inspect | Stop |
|---|---|---|---|---|
| Web app | Start the dev server in the background. Wait with `curl --silent --fail --retry 30 --retry-delay 1 --retry-connrefused <url>`. | Use the browser tool of the harness, for example Chrome DevTools MCP (`navigate_page`, `click`, `fill`, `wait_for`) or Playwright MCP. With no tool, start Chrome with `--remote-debugging-port=9222` and send Chrome DevTools Protocol commands. | Page text from `take_snapshot`, errors from `list_console_messages`, status codes from `list_network_requests`, a `take_screenshot` image. | Kill the server process and close the page. |
| iOS simulator | `xcrun simctl boot "<device>"`, then `xcrun simctl install booted <app path>`. | `xcrun simctl launch booted <bundle id>`; `xcrun simctl openurl booted <deep link>`. | `xcrun simctl io booted screenshot <file>.png`; app logs from `xcrun simctl spawn booted log show --last 1m`. | `xcrun simctl terminate booted <bundle id>`, then `xcrun simctl shutdown booted`. |
| Android emulator | `emulator -avd <name> -no-window &`, then `adb wait-for-device` and `adb install -r <apk>`. | `adb shell am start -n <package>/<activity>`; `adb shell input tap <x> <y>`; `adb shell input text <text>`. | `adb exec-out screencap -p > <file>.png`; `adb shell uiautomator dump`; `adb logcat -d`. | `adb emu kill`. |
| Desktop app | Launch the built app in the background. For an Electron app, add `--remote-debugging-port=9222`. | Electron: Chrome DevTools Protocol, as for a web app. Native: the accessibility automation of the operating system. | A screenshot, the app log, and the files that the app writes. | Kill the app process. |
| CLI | Build the binary. Make a temporary folder with `mktemp -d`. | Run the command with sample arguments inside the temporary folder. | The exit code, standard output, standard error, and the files that the command writes. | Remove the temporary folder. |
| Service with an API | Start the service with test configuration. Wait on its health URL with `curl --retry`. | Send requests with `curl --silent --show-error --fail-with-body`. | The HTTP status and the body fields, read with `jq`. | Kill the process, or run `docker compose down` for a container stack. |
| Hook or plugin | No start step. | Pipe a sample JSON payload to the hook on standard input. | The exit code and the JSON on standard output. | Remove any state file that the hook writes. |

## Worked example

A project `notes-api` is a Node HTTP service. Its `package.json` defines `npm start`, and it listens on the port in `PORT`. The filled skill after a full run, in which each command showed its expected result, so it holds no `not observed:` mark:

````markdown
---
name: verify
description: "Use when checking a change to notes-api end to end: start the service, create and read a note over HTTP, check the error path, and stop it. Not for unit tests (run npm test), lint, or a release."
metadata:
  updated: "2026-11-17"
---

# Verify notes-api

notes-api is an HTTP service. Client programs create and read notes through its JSON API.

## Prerequisites

| Need | Check command | Expected result |
|---|---|---|
| Node 22 or later | `node --version` | `v22.` or a later major |
| Dependencies | `npm ci` | exit 0 |

## Start

```bash
run=$(mktemp -d)
echo "verify folder: $run"
PORT=4010 DATABASE_URL=sqlite::memory: npm start > "$run/verify.log" 2>&1 &
echo $! > "$run/verify.pid"
curl --silent --fail --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:4010/health
```

The Stop block reads `$run`. If the shell does not keep variables between blocks, set `run` to the printed folder before you stop.

Ready when: the `curl` command prints `{"status":"ok"}` and exits 0.

## Drive and inspect

| Id | Flow | Command or tool action | Expected result |
|---|---|---|---|
| V1 | Create a note | `curl --silent --show-error --fail-with-body -X POST -H 'content-type: application/json' -d '{"text":"hello"}' http://127.0.0.1:4010/notes \| jq -r .id` | A note id, for example `n_1` |
| V2 | Read the note | `curl --silent --show-error --fail-with-body http://127.0.0.1:4010/notes/n_1 \| jq -r .text` | `hello` |
| V3 | Reject an empty note | `curl --silent -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"text":""}' http://127.0.0.1:4010/notes` | `400` |

## Stop and clean up

```bash
kill "$(cat "$run/verify.pid")"
rm -r "$run"
```

Clean when: `curl --silent http://127.0.0.1:4010/health` exits with code 7 (connection refused).

## Failure signs

| Sign | Meaning | Next step |
|---|---|---|
| `curl: (7)` after all retries | The service did not start | Read `$run/verify.log` |
| V3 prints `201` | The input check is missing | Fix the validation, then run V1 to V3 again |
````

## Sources

- Chrome DevTools MCP tool reference: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- iOS Simulator command line (`simctl`): https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device
- Android Debug Bridge: https://developer.android.com/tools/adb
- Android emulator command line: https://developer.android.com/studio/run/emulator-commandline
- curl options (`--retry-connrefused`, `--fail-with-body`): https://curl.se/docs/manpage.html
