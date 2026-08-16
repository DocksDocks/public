---
plan_contract: v2
title: Support Windows natively and prove macOS on real hosts
goal: docks-kit runs natively on Windows x64 and arm64, and every supported OS is proven by its own CI runner behind one host-OS module seam.
status: ongoing
created: "2026-08-16T00:34:37.186+00:00"
updated: "2026-08-16T00:47:00.000+00:00"
assignee: null
---

## Goal

docks-kit runs natively on Windows x64 and arm64, and every supported OS is proven by its own CI runner behind one host-OS module seam.

Mode: plan-and-implement

Three outcomes:

1. **macOS needs no port, only proof.** No OS-version gate exists anywhere in the kit, so the newest macOS already runs. What is missing is execution: no macOS runner, no executed darwin binary, and a test preload that pins every suite to Linux.
2. **Windows becomes a first-class host.** Per-OS facts move into `cli/src/engine-native/os/`, the admission gate opens, and the launcher, installer, release artifacts, and npm package all admit `win32`.
3. **Each OS proves itself.** A three-OS GitHub matrix compiles and executes the host-matching artifact on every supported host.

## Research

**macOS: the gap is coverage, not code.** Host admission reads `uname -s`/`uname -m` in the `docks-kit` launcher and `process.platform`/`process.arch` in `engine.ts` `requireSupportedHost`; neither reads an OS version, and no `sw_vers`, Darwin kernel number, or minimum-version comparison exists in the tree. Every darwin branch is a static fact lookup: four Homebrew install hints in `deps.ts`, the `os` field filter in `toolchain.ts`, the darwin `afplay` fast path in `SoT/.claude/bin/notify.mjs` `selectPlayer`, and the release artifact name. The newest macOS therefore needs no change. The reason nobody can assert that today is that `.github/workflows/parity.yml` runs `quality`, `golden-dryrun`, and `golden-mutation` on `ubuntu-24.04` only; `.github/workflows/release-cli.yml` cross-compiles the two darwin binaries on Ubuntu and never executes them; and `cli/test/lib/goldenPlatform.ts` pins `process.platform` to `linux` for every golden spawn. No suite on any host has ever executed the darwin branches, and no CI job has ever executed a darwin binary. Closing that gap requires building and running the host-matching compiled artifact on a macOS runner, not merely adding a macOS job.

**The notification branch has a second owner.** `selectPlayer` in `SoT/.claude/bin/notify.mjs` reads `process.platform` directly and takes the `afplay` path on darwin before falling through to `ffplay`. It is deployed content, embedded byte-for-byte in `cli/src/generated/sotPayload.ts`, so it is outside `cli/src/engine-native/` and untouched by an engine-only refactor. It already accepts an injected `options.platform` and already degrades to `ffplay`, so it is capability-driven in shape; what it must not do is become a second, drifting home for OS facts.

**Bun can target Windows.** The official executables target table lists `bun-windows-x64` and `bun-windows-arm64` alongside the four current targets, with a `-baseline` variant for Windows x64 only (<https://bun.sh/docs/bundler/executables>). Cross-compilation from a Linux runner is the documented mode, so `cli/build-binaries.sh` gains two entries without a Windows build machine.

**Windows cannot spawn `.cmd` the way the harness spawns everything else.** Node documents that a `.bat` or `.cmd` file runs only by setting the `shell` option, by using `exec()`, or by "spawning `cmd.exe` and passing the `.bat` or `.cmd` file as an argument" (<https://nodejs.org/api/child_process.html>). Passing `args` with `shell: true` is deprecated as DEP0190, so the explicit `cmd.exe /c <file>` form is the correct route. This is decisive for two places at once: the Windows executable candidates the PATH probe discovers, and the stub executables the golden harness plants on PATH. Discovering a `.cmd` is worthless unless the caller knows to invoke it through `cmd.exe`, so the invocation strategy is itself a per-OS fact and belongs in the seam beside the candidate list.

**Both agent CLIs support Windows natively, and both expose a concrete Windows configuration surface.** Claude Code documents Windows 10 1809+ and Server 2019+ with native PowerShell and CMD installers, and states that `~/.claude` resolves to `%USERPROFILE%\.claude` (<https://code.claude.com/docs/en/setup>, <https://code.claude.com/docs/en/settings>). The shell tool is conditional, not swapped: "Git for Windows is recommended on native Windows so Claude Code can use the Bash tool. If Git for Windows is not installed, Claude Code uses PowerShell as the shell tool instead", `defaultShell` accepts `"bash"` or `"powershell"`, `CLAUDE_CODE_USE_POWERSHELL_TOOL` forces either way, and `autoMode.classifyAllShell` "suspends every Bash and PowerShell allow rule", which confirms `PowerShell` is a real permission-rule tool name alongside `Bash`. The correct SoT change is therefore additive — carry both rule families — because a Windows machine may present either tool, and a `PowerShell(...)` rule is inert on a host where the tool is not enabled. Codex documents its Windows sandbox as a configuration surface verbatim: a `[windows]` table with `sandbox = "elevated"` or `"unelevated"`, `elevated` preferred, plus `allowed_sandbox_implementations` and `sandbox_private_desktop` (<https://learn.chatgpt.com/docs/windows/windows-sandbox>).

**The blocking surface in the engine is small and enumerable.** A full read of `cli/src/**` found exactly seven OS-dependent behaviours: the `engine.ts` host gate, the `docks-kit` launcher `uname` gate, the `platformName` mapping in `os.ts` that returns `unknown` for Windows, four install-hint lookups in `deps.ts`, the `os` visibility filter in `toolchain.ts`, and the Linux-only bubblewrap probe and install in `codexSync.ts`. Everything else is path and process plumbing. That is a small enough surface to formalize as one interface rather than scatter `if (platform === "win32")` across nine modules.

**Capability versus prediction.** `DESIGN.md` states the standing rule: "Symlink creation remains capability-driven: permission or filesystem failures fall back to copy without predicting the host." The per-OS modules must therefore own only facts that cannot be probed — install-hint text, command shapes, executable suffixes, invocation strategy, installer form, sandbox mechanism — while anything that can fail at runtime stays try-then-fallback. The per-OS module contributes the *order* of the fallback chain, never the prediction of its outcome.

**A real defect sits exactly there.** `DESIGN.md` claims try-then-fallback, but `skillsSync.ts` `linkOrCopy` never copies: a failed `symlinkSync` returns `false`, and `linkOrCopyWithWarnings` only emits a warning. The documented invariant is false on POSIX today and would be fatal on Windows, where unprivileged `symlinkSync` can fail outright. Node documents the fix: `type: "junction"` is Windows-only, normalizes the target to an absolute path automatically, and on NTFS points only to directories (<https://nodejs.org/api/fs.html>) — exactly the shape of `~/.claude/skills/<name>` pointing at `~/.agents/skills/<name>`. Because the chain is capability-driven, the plan does not need to resolve whether junction creation requires elevation; the runtime answers it.

**The golden harness is shell-bound, and the merge order is load-bearing.** `cli/test/lib/goldenExecution.ts` composes `bash -c` command strings with a POSIX single-quote `shellQuote`, and `runEngine` merges channels with `exec 2>&1`, so recorded snapshots carry true fd-level interleaving that concatenating two pipes would not reproduce. Node documents the escape: a positive integer in the `stdio` array "is interpreted as a file descriptor that is open in the parent process" and is shared with the child (<https://nodejs.org/api/child_process.html>). Spawning with `stdio: ["ignore", fd, fd]` against one temp file reproduces `2>&1` byte-for-byte with no shell on any OS. `goldenResources.ts` additionally writes `#!/bin/sh` stub executables, `goldenSnapshot.ts` builds tree keys from path separators, and `cli/test/unit/launcher.test.ts` creates and directly spawns Bash executables — so the unit lane, not only the golden lane, is currently unrunnable on Windows.

**CI: the free matrix wins outright.** This repository is public (`DocksDocks/public`, visibility PUBLIC), and GitHub states that "the use of standard GitHub-hosted runners is free: in public repositories", while "larger runners are always charged for, even when used by public repositories" (<https://docs.github.com/en/billing/concepts/product-billing/github-actions>). Standard `ubuntu-24.04`, `macos-26` (arm64 by default; `macos-26-intel` for x64), and `windows-2025` therefore cost nothing, whereas the same lanes on a private repository would bill macOS at $0.062 per minute against $0.006 for Linux. Docker cannot host a macOS or Windows-desktop guest from a Linux runner, and a Linux microVM service of the smolmachines class provides Linux guests only — neither can serve the two OSes actually missing, while both add cost and infrastructure to reproduce what the free matrix already gives. GitHub also advises against self-hosted runners on public repositories because fork pull requests can execute untrusted code on them. Verdict: a three-OS GitHub matrix on standard runners; no Docker layer, no larger runners, and no external VM host.

**npm currently refuses Windows.** `package.json` declares `"os": ["linux", "darwin"]`, so even a working Windows CLI could not be installed from the registry until `win32` joins that list.

**Two duplicated facts need containment.** Opening the gate means a PowerShell launcher twin beside the Bash `docks-kit`, because the launcher performs version-matched binary selection and Bun bootstrap before any TypeScript runs. Two facts would then live in four files: the host-to-artifact map and the verified Bun pin, which `cli/scripts/generate-sot-payload.ts` currently injects into the generated block of `docks-kit` and `install.sh` only. Both get one owner and one test: the map becomes `cli/src/engine-native/os/targets.ts` with an invariant test parsing all launchers and `cli/build-binaries.sh` against it, and the pin generator extends to both PowerShell twins with `cli/test/unit/payload.test.ts` covering them — the same technique `install.test.ts` already uses to read the verified Bun pin out of the manifest.

## Steps

| # | Id | Task | Files | Depends | Effect | Status | Done when |
|---:|---|---|---|---|---|---|---|
| 1 | host_os_seam | Replace `os.ts` with an `os/` package: a `HostOs` interface in `types.ts`, one module per OS, and a `platformName`-driven selector in `index.ts` that tests can call with an explicit id. Move the four install hints, the toolchain `os` filter, and the bubblewrap-support predicate behind it, and route the deployed notifier's darwin fast path through an injected platform instead of a second direct read. Behaviour-identical refactor; `windows.ts` is authored but unreachable while the admission gate stands | cli/src/engine-native/os.ts, cli/src/engine-native/os/types.ts, cli/src/engine-native/os/linux.ts, cli/src/engine-native/os/darwin.ts, cli/src/engine-native/os/windows.ts, cli/src/engine-native/os/index.ts, cli/src/engine-native/deps.ts, cli/src/engine-native/toolchain.ts, cli/src/engine-native/codexSync.ts, cli/src/engine-native/services.ts, SoT/.claude/bin/notify.mjs, cli/src/generated/sotPayload.ts, cli/src/engine-native/DESIGN.md | — | `local` | `done` | `bun run test:ci` passes with zero diff in `cli/test/goldens/`, and the only `process.platform` reads left under `cli/src/engine-native/` and `SoT/.claude/bin/` are the seam selector and the notifier's injected default |
| 2 | os_unit_tests | Add one host-independent unit suite per OS that asserts every `HostOs` member for its id, so Windows behaviour is provable from a Linux or macOS host | cli/test/unit/os/linux.test.ts, cli/test/unit/os/darwin.test.ts, cli/test/unit/os/windows.test.ts | 1 | `local` | `done` | The three suites pass on this host and together assert every member declared in `os/types.ts` |
| 3 | link_fallback | Implement the fallback chain `DESIGN.md` already promises: symlink, then Windows junction with an absolute target, then recursive copy, recording the copy so prune still removes it; accept a copied directory in the skills health check and correct the stale `DESIGN.md` claim | cli/src/engine-native/skillsSync.ts, cli/src/engine-native/os/types.ts, cli/src/engine-native/os/windows.ts, cli/src/engine-native/DESIGN.md, cli/src/manifests.ts, cli/test/unit/skillsSync.test.ts | 1 | `local` | `done` | A test that forces `symlinkSync` to throw leaves a populated copied directory, emits a warning naming the fallback used, and `DESIGN.md` states what the code does |
| 4 | windows_behaviors | Make the Windows module concrete: `.exe`/`.cmd` PATH candidates *paired with* a `cmd.exe /c` invocation strategy so a discovered `.cmd` is actually runnable, Windows Bun discovery and pinned bootstrap, install-path detection for `update`, shell-profile environment writes, and the statusline, notification, and failure-hook command shapes using forward slashes | cli/src/engine-native/exec.ts, cli/src/engine-native/deps.ts, cli/src/engine-native/bun.ts, cli/src/engine-native/claudeRuntime.ts, cli/src/engine-native/claudeSync.ts, cli/src/commands/update.ts, cli/src/engine-native/os/windows.ts, cli/src/engine-native/os/types.ts, cli/test/unit/os/windows.test.ts | 1, 2 | `local` | `done` | The Windows unit suite asserts that a `.cmd` candidate resolves to a `cmd.exe /c` argv rather than a bare path, alongside each other command and probe shape, and `bun run test:ci` stays green on this host |
| 5 | sot_windows | Apply the documented Windows configuration: add `PowerShell(...)` rules mirroring every existing `Bash(...)` rule, because native Windows presents the Bash tool with Git Bash and the PowerShell tool without it, and add the Codex `[windows]` table with `sandbox = "elevated"`; then regenerate the payload | SoT/.claude/settings.json, SoT/.codex/config.toml, cli/src/generated/sotPayload.ts, cli/test/unit/claudeSettingsTruth.test.ts, cli/test/unit/codexTomlMerge.test.ts | 4 | `local` | `done` | `bun run check:generated` exits 0 and unit assertions cover both the mirrored PowerShell rules and the `[windows]` sandbox table |
| 6 | harness_portability | Make the test harness shell-free before Windows is admitted: spawn argv directly instead of composing `bash -c`, reproduce `2>&1` by passing one shared temp-file descriptor as both stdout and stderr, plant stubs the host can actually execute, normalize snapshot tree-key separators, port the launcher suite off direct Bash spawning, and add a Windows mode to the runtime smoke | cli/test/lib/goldenExecution.ts, cli/test/lib/goldenResources.ts, cli/test/lib/goldenSnapshot.ts, cli/test/lib/goldenPlatform.ts, cli/test/unit/launcher.test.ts, cli/test/statusline-runtime-smoke.mjs, vitest.config.ts, package.json | 4 | `local` | `done` | `bun run golden:dryrun` and `bun run golden:mutation` pass with zero diff in `cli/test/goldens/`, both prove-red modes still exit non-zero, and no test file spawns `bash` to reach the CLI |
| 7 | open_gate | Admit Windows only once the suite can run there: extend `requireSupportedHost` and its rejection test, add `os/targets.ts` as the single host-to-artifact map, add `win32` to the npm `os` field, add the `docks-kit.ps1` and `install.ps1` twins with the Bun pin injected by the existing generator, add the two Bun Windows targets, and pin line endings so a Windows checkout cannot mangle scripts | cli/src/engine.ts, cli/test/unit/engine.test.ts, cli/src/engine-native/os/targets.ts, package.json, docks-kit, docks-kit.ps1, install.sh, install.ps1, cli/build-binaries.sh, cli/scripts/generate-sot-payload.ts, cli/test/unit/payload.test.ts, cli/test/unit/buildBinaries.test.ts, cli/test/unit/install.test.ts, .gitattributes | 5, 6 | `local` | `done` | An invariant test parses both launchers and `cli/build-binaries.sh` and asserts all four agree with `os/targets.ts`, the generated Bun pin is asserted in all four scripts, and the `win32` rejection assertion is replaced by an admission assertion |
| 8 | ci_matrix | Split CI into a portable lane on `ubuntu-24.04`, `macos-26`, and `windows-2025` that runs typecheck, unit, and a real native smoke — compiling the host-matching artifact and executing it for a dry run without the golden platform preload — and a snapshot lane that keeps the Linux-canonical goldens and prove-red on `ubuntu-24.04` alone | .github/workflows/parity.yml, .github/actions/setup-bun-cache/action.yml, package.json | 7 | `push` | `done` | The workflow run for the pushed head shows each of the three runners compiling and executing its own artifact, and the snapshot lane green on Ubuntu |
| 9 | release_windows | Publish Windows artifacts and state the support matrix: two Windows binaries plus checksums in the release workflow, and every live support contract updated, including the hard-coded platform summary the docs command prints | .github/workflows/release-cli.yml, cli/build-binaries.sh, cli/src/commands/docs.ts, cli/docs/platforms.md, cli/docs/install.md, cli/docs/toolchain.md, cli/docs/overview.md, README.md, AGENTS.md, CLAUDE.md, CHANGELOG.md | 8 | `release` | `done` | A `cli-v*` run publishes six binaries and a matching `SHA256SUMS`, and no live document or command output still says the kit supports only Linux and macOS |
| 10 | probe_lane | Add a targeted single-runner lane the owner asked for during implementation, so one host question costs one job instead of the whole six-job matrix: a workflow that runs one vitest filter on one runner label, dispatchable with a runner and filter input and triggered by a `probe/**` push | .github/workflows/probe.yml | 8 | `local` | `done` | A `probe/**` push runs exactly one job on one runner label, the golden-regression matrix stays the only acceptance gate, and the lane declares a shell per step so `actionlint` reads each body on its real host |

## Acceptance

| ID | Command | Expected |
|---|---|---|
| A1 | `bun run typecheck` | Exit 0 |
| A2 | `bun run test:unit` | Exit 0, including the three per-OS suites |
| A3 | `bun run check:generated` | Exit 0 |
| A4 | `bun run golden:dryrun` | Exit 0 |
| A5 | `bun run golden:mutation` | Exit 0 |
| A6 | `bun cli/test/golden-dryrun.ts --prove-red` | Exit 1 with a `prove-red OK` line |
| A7 | `bun cli/test/golden-mutation.ts --prove-red` | Exit 1 with a `prove-red OK` line |
| A8 | `bun run test:ci` | Exit 0 |
| A9 | `git diff --stat cli/test/goldens/` | No output; the shell-free harness rewrites no snapshot |
| A10 | `grep -rn "bash" cli/test/lib/goldenExecution.ts cli/test/unit/launcher.test.ts` | No match that spawns a shell to reach the CLI |
| A11 | `grep -rn "process.platform" cli/src/engine-native --include=*.ts` | Matches only in `os/index.ts` |
| A12 | `jq -c .os package.json` | Prints `["linux","darwin","win32"]` |
| A13 | `bunx vitest run cli/test/unit/buildBinaries.test.ts cli/test/unit/payload.test.ts` | Exit 0; launchers, build script, and generated Bun pin all agree with `os/targets.ts` |
| A14 | `bunx vitest run cli/test/unit/skillsSync.test.ts` | Exit 0; the forced-failure case proves the copy fallback |
| A15 | `bunx vitest run cli/test/unit/os/windows.test.ts` | Exit 0; a `.cmd` candidate resolves to a `cmd.exe /c` argv |
| A16 | `./docks-kit sync --dry-run` | Exit 0 on this host with no unsupported-host line |
| A17 | Native smoke on each matrix runner | The compiled host artifact reports the `package.json` version and completes a dry run with no golden platform preload |
| A18 | Workflow run for the pushed head | Portable lane green on `ubuntu-24.04`, `macos-26`, and `windows-2025`; snapshot lane green on `ubuntu-24.04` |

## Do not touch

- `docs/plans/finished/**` is byte-frozen history.
- `cli/test/goldens/*.json` is never hand-edited; only `--update-goldens` writes it, and step:harness_portability must produce zero diff.
- The removed bash engine stays removed: `DOCKS_KIT_ENGINE=bash` keeps failing with the removed-engine message.
- `SoT/.agents/skills.txt` stays empty; universal skills are out of scope.
- The Effect pins stay at `4.0.0-rc.109`; this plan bumps no dependency.
- `cli/test/lib/goldenPlatform.ts` stays a test-only preload. Production code gains no OS override environment variable.
- No install path floats: every new third-party Windows install is pinned to a `SoT/toolchain.json` `verified` value, never `@latest`. The kit's own PowerShell installer uses download-then-run, never `irm | iex`, even though upstream vendors ship that pattern.
- No Docker layer, no larger runners, and no self-hosted or third-party runner host is added.
- Existing `Bash(...)` permission rules are not replaced. Windows may present either shell tool, so the PowerShell rules are added beside them.
- No `bun-windows-x64-baseline` artifact. The release stays at six binaries, matching the modern-only convention already used for `bun-linux-x64` and `bun-darwin-x64`.

## Open questions

1. **Resolved 2026-08-15 — modern only.** The release ships no `bun-windows-x64-baseline`. `cli/build-binaries.sh` already ships modern-only `bun-linux-x64` and `bun-darwin-x64`, so Windows x64 matches the existing convention at six artifacts.
2. **Open.** Is the shared skills root on Windows `%USERPROFILE%\.agents`? Upstream documents `.claude` and `.codex` expansion but not `.agents`. The three-OS lane did not settle it: `SoT/.agents/skills.txt` is empty, so no Windows job installed a universal skill. Not blocking — `skillsSync.ts` derives the root from `ctx.agentsDir`, and step:link_fallback makes a wrong guess degrade to a copy rather than fail.
3. **Resolved 2026-08-15 — single runner configuration.** Windows CI does not force the Git Bash absent case. Step:sot_windows mirrors the PowerShell rules beside the Bash rules, so both tool families are permitted whichever the host presents, and a rule for an unenabled tool is inert.
4. **Resolved 2026-08-16 by owner decision — PowerShell-only launcher.** The Bash `docks-kit` launcher rejects Git Bash on Windows (`uname` reporting `MINGW64_NT-*`) and directs the user to `docks-kit.ps1`. Recovering the historical Git Bash path would invert two invariants this change asserts, and the three-runner lane executes PowerShell, not Git Bash. The rejection message names the supported route instead of claiming the kit supports Linux and macOS only.
5. **Resolved 2026-08-16 by owner decision — keep `@latest` for the kit's own package.** `install.sh` self-installs the kit with `bun add -g docks-kit@latest` and `install.ps1` mirrors it, because pinning the kit's own version inside its installer would install a fixed old kit forever. The exemption covers `docks-kit` alone and is now written into the pin rule in `AGENTS.md`.

## Review

### Plan review — 2026-08-15
Plan-review: repair
- [research_gap] `## Steps` row 1 — the enumerated notification branch is not in `claudeSync.ts`; it lives in `SoT/.claude/bin/notify.mjs` and is embedded in `cli/src/generated/sotPayload.ts`, so the claimed complete OS seam leaves a second `process.platform` owner untouched — add those files and remove or explicitly capability-drive that standalone branch.
- [research_gap] `## Steps` row 4 — discovering `.cmd` candidates does not make them executable through the current shell-free `spawn(cmd, args)`: Node documents that `.cmd`/`.bat` require a shell or explicit `cmd.exe`, and row 7's `.cmd` stubs have the same defect — add an OS-aware `.cmd` execution strategy or use real `.exe` shims before relying on those candidates.
- [research_gap] `## Steps` row 5 — both declared configuration unknowns are already answered by the cited current official docs: Claude rules use `PowerShell(...)`, and Codex uses `[windows] sandbox = "elevated" | "unelevated"` — replace the open questions with these documented keys and make the SoT changes explicit.
- [research_gap] `## Steps` row 6 — the bound files omit `cli/test/unit/engine.test.ts`, which currently asserts `win32` rejection, and omit `cli/scripts/generate-sot-payload.ts` plus `cli/test/unit/payload.test.ts`, which currently keep the Bun pin synchronized only in `docks-kit` and `install.sh` — add these owners and extend generated-pin coverage to both PowerShell twins.
- [research_gap] `## Steps` row 7 — Windows is admitted in row 6 before the suite is portable, while the omitted `cli/test/unit/launcher.test.ts` still creates and directly spawns Bash executables, so the row 8 Windows unit lane remains red — include and port that test, and make harness portability precede admission or combine the two changes atomically.
- [goal_fit] `## Steps` row 8 — "real native smoke" never requires building or executing the host-matching compiled artifact, so the plan does not close its stated macOS gap of an unexecuted darwin binary and the Linux-pinned preload can still mask host branches in unit runs — build and invoke the native artifact on each matrix runner without `goldenPlatform.ts`, including a real dry-run path.
- [research_gap] `## Steps` row 9 — the "wherever written down" file set omits live support contracts in `cli/docs/platforms.md`, `cli/docs/install.md`, `cli/docs/toolchain.md`, and the hard-coded summary in `cli/src/commands/docs.ts` — add and update those files so the done condition is reachable.

Disposition — all seven reproduced against the repository and upstream documentation; all seven fixed. One remedy was corrected on the evidence rather than applied as written.

- Finding 1 reproduced: `notify.mjs` `selectPlayer` reads `process.platform` and branches on `darwin` for `afplay`. Both files added to row 1 and the research paragraph now names the true owner.
- Finding 2 reproduced: Node states a `.bat` or `.cmd` runs only via the `shell` option, `exec()`, or spawning `cmd.exe` with the file as an argument, and DEP0190 deprecates `args` with `shell: true`. Rows 4 and 6 now pair candidate discovery with a `cmd.exe /c` invocation strategy, and A15 asserts it.
- Finding 3 reproduced for Codex verbatim: `[windows]` with `sandbox = "elevated" # or "unelevated"`. **Corrected for Claude:** the docs do not swap `Bash(...)` for `PowerShell(...)` on Windows. Git for Windows gives the Bash tool, its absence gives the PowerShell tool, `defaultShell` accepts either, and `autoMode.classifyAllShell` suspends "every Bash and PowerShell allow rule" — so row 5 mirrors the rules additively instead of replacing them, and `## Do not touch` forbids the replacement.
- Finding 4 reproduced: all three files exist and own exactly what the finding claims. Added to the gate step.
- Finding 5 reproduced: `launcher.test.ts` exists and spawns Bash. Added, and the ordering is inverted — harness portability is now row 6 and the gate is row 7, so admission never precedes a runnable suite.
- Finding 6 reproduced against this plan's own research, which states the darwin binaries are never executed. Row 8 now compiles and runs the host-matching artifact on each runner without the preload, and A17 is its proof.
- Finding 7 reproduced: all four paths exist, including the hard-coded platform summary in `docs.ts`. Added to row 9.

### Code review round 1 — 2026-08-16
Code-review: fixes-required
- MEDIUM · Security · SoT/.claude/settings.json:200 — a prompt can issue `Remove-Item -LiteralPath C:\ -Recurse -Force`; every new native delete deny assumes the flags precede `/`, `~`, or `$env:USERPROFILE`, so drive-root and path-before-flags forms bypass the hard-deny safety floor — deny recursive forced deletion independently of argument order and cover Windows drive roots, with matcher tests for both forms
- MEDIUM · Bug · cli/src/engine-native/deps.ts:175 — a first Windows sync with Claude or Codex absent prints `/tmp`, `mktemp`, `bash`, and `sh` installer commands that PowerShell cannot execute — move the Claude/Codex hints into `HostOs` and provide official Windows download-then-run instructions while retaining the POSIX forms
- MEDIUM · Bug · cli/src/engine-native/os/windows.ts:22 — `.cmd`/`.bat` paths and arguments are handed raw to `cmd.exe`; libuv leaves shell metacharacters such as `&` unquoted when no whitespace is present, so a valid path such as `C:\R&D\npx.cmd` is split into multiple commands — use a dedicated cmd command-line encoder (or an executable shim) and test spaces, metacharacters, apostrophes, and Unicode
- MEDIUM · Spec · cli/test/golden-dryrun.ts:91 — the plan says to make the harness shell-free and plant stubs the host can execute, but both golden entrypoints now exit 2 on Windows, so `golden:dryrun`, `golden:mutation`, and the advertised `test:ci` gate cannot run on a supported host — separate the physical stub launcher form from the Linux-canonical recording platform and execute golden/prove-red on Windows instead of rejecting it
- MEDIUM · Spec · cli/src/engine.ts:18 — the goal requires one host-OS module seam, but the production admission gate still reads `process.platform` and `process.arch` directly outside that seam — add a current-host target selector inside `os/` and route admission and diagnostics through it
- MEDIUM · Spec · cli/docs/toolchain.md:31 — the plan requires every live support contract to be updated, but this topic still says no kit-driven install ever uses `@latest`, contradicting both installers and the newly documented `docks-kit@latest` exemption — document the kit-self-install exception here while keeping third-party installs pinned
- MEDIUM · Maintainability · cli/src/engine-native/DESIGN.md:161 — the changed design record still says EngineNative supports only Linux/macOS, runtime hooks are POSIX-only, parity is Linux-only, and releases contain four binaries — update the platform, runtime-command, CI-matrix, and six-artifact contracts to match the implementation
- LOW · Spec · cli/src/commands/update.ts:95 — Step 4 assigns Windows update-path detection to the Windows module, but `update.ts` still branches on `host.id` and owns separator normalization itself — expose host path normalization/containment through `HostOs` and remove the consumer-side Windows branch
- LOW · Bug · install.ps1:137 — the printed PATH recovery command interpolates `$InstallBin` inside a PowerShell single-quoted literal without escaping apostrophes, so a home such as `C:\Users\O'Brien` produces unusable guidance — double embedded apostrophes before rendering the command or emit a safely encoded command
- LOW · Spec · .github/workflows/probe.yml:1 — this permanent `probe/**` push workflow is absent from every Steps `Files` cell and adds non-gating CI behavior unrelated to the requested three-OS acceptance matrix — remove it from this change or add an approved plan step with its purpose, trigger, and acceptance contract

Disposition — seven reproduced and fixed, two not reproduced, one accepted without change.

- Deny floor reproduced, and the real defect is worse than reported. PowerShell's idiomatic delete puts the path first, as in `Remove-Item C:\ -Recurse -Force`, so mirroring the flags-first Bash patterns missed the common form, and no pattern covered a drive root. Every delete verb now carries all four argument shapes against every root, and an ordinary recursive delete of a relative path still matches no deny rule.
- Install hints reproduced: the `claude` and `codex` hints were shell-shaped and stayed in `deps.ts` when the other four moved. Both now answer through `HostOs.installHint`, and the POSIX text is byte-identical because a golden snapshot records it.
- The `cmd.exe` quoting hole reproduced. It is the documented BatBadBut class: libuv does not quote an argument that carries a metacharacter without whitespace. The invocation now uses the documented safe form, and the Windows suite covers a space, an ampersand, an apostrophe, and a non-ASCII character.
- `cli/docs/toolchain.md` and `cli/src/engine-native/DESIGN.md` reproduced as stale live contracts and were corrected to the implemented state.
- The `install.ps1` apostrophe defect reproduced and was fixed by doubling the embedded apostrophe.
- The undeclared probe lane reproduced as a bookkeeping gap, not scope creep: the owner requested it during implementation. It is now step:probe_lane with its trigger and acceptance. `vitest.config.ts` joined step:harness_portability's files for the same reason.
- **Not reproduced — golden entrypoints on Windows.** The rejection is the approved design of step:ci_matrix: the snapshot lane is Linux-canonical and runs on `ubuntu-24.04` alone. The Windows job runs typecheck, the unit suite, `test:runtime:windows`, and `smoke:native`, and never runs `test:ci`, so no supported host is denied its acceptance path. Both guard messages now name the reason and the command to run instead.
- **Not reproduced — the admission gate.** `requireSupportedHost` reads `process.platform` and `process.arch` only to feed `targetForHost`, which is the seam's own selector, and A11 scopes the no-direct-read invariant to `cli/src/engine-native/`. Reading the host at the process boundary and answering through the seam is the seam's contract, not a breach of it.
- **Accepted without change — `update.ts`.** The consumer already receives a `HostOs` and uses it for the install-root facts. Moving separator normalization into the interface would add indirection with no behaviour change, so the branch stays.

### Code review round 2 — 2026-08-16
Code-review: fixes-required
- LOW · Bug · cli/test/unit/exec.test.ts:37, cli/test/unit/update.test.ts:191 — both "absent tool" cases resolve against the runner's inherited `PATH`, so a host that already has `docks-kit-absent-tool` (with `.exe`, `.cmd`, `.bat`, or no suffix) executes or mocks it and fails the asserted not-found result — set `PATH` to an isolated empty temporary directory for each case and restore it in `finally`.

Disposition — reproduced and fixed. Both files now build a temporary directory holding exactly the shims a case needs, none for the absent case, and restore `PATH` in `finally`; the same helper replaces the inline `PATH` dance the shim case carried. Planting `docks-kit-absent-tool`, `.cmd`, and `.exe` on `PATH` failed exactly those two cases before the fix and none after it, so the finding was proven rather than assumed.

### Code review round 3 — 2026-08-16
Code-review: fixes-required
- LOW · Bug · cli/test/unit/exec.test.ts:21, cli/test/unit/update.test.ts:167 — if `PATH` was originally absent, assigning `savedPath` back writes the string `"undefined"` under Node instead of restoring absence, so either helper can leak a synthetic `PATH` into later tests despite its `finally` block — in each `finally`, delete `process.env["PATH"]` when `savedPath === undefined`, otherwise restore `savedPath`.

Disposition — reproduced and fixed. Both helpers delete `PATH` when it was initially absent; otherwise they restore its saved value. The focused suites pass.

### Code review round 4 — 2026-08-16
Code-review: fixes-required
- LOW · Spec · docs/plans/active/cross-os-windows-support.md:165 — the round-3 disposition called the leak latent because the suite runs through `bunx`, but that launcher runs Node, so the defect was live.

Disposition — reproduced and corrected in the record; the code was already correct.

### Code review round 5 — 2026-08-16
Code-review: fixes-required
- LOW · Spec · docs/plans/active/cross-os-windows-support.md:165 — the disposition claimed Bun deletes the key on the same assignment, which Bun does not do.

Disposition — reproduced and corrected in the record; the code was already correct.

### Code review round 6 — 2026-08-16
Code-review: fixes-required
- LOW · Spec · docs/plans/active/cross-os-windows-support.md:165 — the disposition said "these are the suites that spawn children", but `update.test.ts` mocks `node:child_process`, so only the exec suite spawns a real child.

Disposition — reproduced and corrected. The disposition now states only what the helpers do and that the focused suites pass, so no runtime or child-process claim remains to be wrong.

## Verification Results

### Local host — darwin arm64, 2026-08-15/16

- A1 `bun run typecheck` — exit 0.
- A2 `bun run test:unit` — 42 files passed, 1 skipped; 369 tests passed, 7 skipped. The skips are the Windows-artifact cases, which report an explicit reason rather than passing vacuously.
- A3 `bun run check:generated` — exit 0.
- A4 `bun run golden:dryrun` — OK, 36 cases. A5 `bun run golden:mutation` — OK, 59 cases.
- A6 and A7 — both prove-red modes exit 1 and print `prove-red OK`.
- A8 `bun run test:ci` — exit 0 for the whole chain.
- A9 `git diff --stat cli/test/goldens/` — empty. The only golden change in the branch is step:sot_windows's intentional `mutation.json` rewrite, 42 insertions and 42 deletions, all `sha256` values for `.claude/settings.json`.
- A10 — no test file spawns a shell to reach the CLI. The remaining `bash` matches are data assertions and a launcher's own interpreter line.
- A11 — `process.platform` under `cli/src/engine-native/` appears only in `os/index.ts`.
- A12 — prints `["linux","darwin","win32"]`.
- A13, A14, A15 — exit 0 each.
- A16 `./docks-kit sync --dry-run` — exit 0 with no unsupported-host line.
- A17 on this host — `bun run smoke:native` compiled `docks-kit-darwin-arm64`, and the artifact reported the `package.json` version and completed a dry run with no golden preload.

### CI — three runners

- A18 — the golden-regression run for the pushed head is green in all six jobs: `portable (ubuntu-24.04)`, `portable (macos-26)`, `portable (windows-2025)`, `golden-dryrun`, `golden-mutation`, and `lint`.
- A17 on each runner — every portable job compiled its own host artifact and executed it for a dry run.

### Windows defects the three-OS lane found

The first Windows run reported 37 failures across 19 files while macOS and Ubuntu were green. Five fix waves reduced that to zero. Two were production defects, the rest were test-side host leakage.

1. **Production — profile parent directory.** `syncConnectorEnv` appended the connector line to `Documents/PowerShell/Microsoft.PowerShell_profile.ps1` without creating the parent directory, which does not exist in a fresh Windows home. Every POSIX candidate sits directly in the home directory, so the write site never needed a parent before.
2. **Production — statusline progress record.** The Windows statusline command emitted a CLIXML progress record to stderr when `Test-Path` auto-loaded its module. Restoring the historically proven `$ProgressPreference = 'SilentlyContinue'` prefix inside the encoded command fixed it; the failure-hook shape is untouched.
3. **Test leakage.** Case-insensitive `PROCESSOR_ARCHITECTURE` collision in the launcher fixture, Bash-only stub launchers the host could not execute, `homedir()` resolving from `USERPROFILE` while the fixture overrode `HOME` alone, a Linux-canonical replay guard, and bare exit-code assertions that hid the child's own output.
4. **Host-shaped budgets.** The runtime smoke keeps a per-host spawn ceiling, because Windows process creation genuinely costs more than a POSIX fork and exec. The vitest per-test ceiling went the other way: it is now one value for every host, since the cost is a cold Bun transpile per spawn and a cold `macos-26` runner crossed the old POSIX default too.
5. **Machine-level actor.** `setx` broadcast `WM_SETTINGCHANGE` from a headless runner and stalled the suite, so the golden stub set now covers `reg` and `setx`.

`.github/workflows/probe.yml` was added during this work: a targeted single-runner lane, dispatchable or triggered by a `probe/**` push, that runs one vitest filter on one host so a Windows question costs one job instead of six. It is never a gate.

### Round 2 — code-review fixes, 2026-08-16

Seven commits answer the review: the deny floor, the install hints and `cmd.exe` quoting, the `install.ps1` apostrophe, the three stale contracts, the plan record, and the per-test ceiling.

- Reviewing the deny fix itself caught a regression the fix introduced: root tokens carried a `*` suffix, so `Remove-Item C:\Users\me\repo\node_modules -Recurse -Force` matched `*:\*` and was hard-denied, and `~*` and `/*` did the same to descendants of home and root. The floor now matches the root as a whole argument, exactly as `Bash(rm -rf ~)` does, and the truth suite asserts five descendant and relative deletes match no deny rule at all. 216 native delete rules over 7 verbs, including the `rd` alias the first pass missed.
- A1 through A17 re-run on darwin arm64 after the wave: `bun run test:ci` exit 0 with 374 tests passed and 7 skipped, `golden:dryrun` OK 36 cases, `golden:mutation` OK 59 cases, `dryrun.json` byte-identical, `mutation.json` moving only the 21 settings hashes the deny rewrite implies, and `bun run smoke:native` compiling and running `docks-kit-darwin-arm64`.
- A18 re-proven on the fixed head: golden-regression run 31918822101 for commit `6ea5547` is green in all six jobs.
- One intermediate run failed and is worth the record: `macos-26` timed out at vitest's 5s default on a flag-less sync that takes about a second warm. It was a margin, not a defect, and the uniform ceiling removed it.

### Round 3 — Windows shim hardening, 2026-08-16

One commit answers the review's remaining Windows-argument finding, plus two hazards the review round surfaced by inspection.

- The `.cmd`/`.bat` encoder now ports cross-spawn's escaper: caret-escaping every metacharacter, doubling backslashes before a quote, and keeping the `node_modules/.bin/*.cmd` double-escape case. `/v:off` disables delayed expansion. `%`, CR, and LF are refused with the reason, because no quoting neutralizes them on a `cmd` command line — proven against Microsoft's `cmd` documentation and the BatBadBut disclosure.
- The interpreter resolves to an absolute path — ComSpec when absolute, otherwise rebuilt under `SystemRoot`. A bare `cmd.exe` would let `CreateProcess` and libuv search the parent's current directory before System32, so an untrusted checkout could answer. For the same reason `spawnProcess` and every `update` child now report an unresolvable tool as missing instead of spawning it by bare name.
- All six `spawnSync` sites in `update.ts` were dropping `windowsVerbatimArguments`, which lets libuv re-quote the command line the encoder prepared. They route through one helper now, so the flag cannot be separated from its argv. A prove-red confirmed the new regression test fails when the flag is removed.
- Two host-independence defects in my own tests were caught and fixed before landing: an assertion recomputing the implementation's own expression, and a POSIX-only spawn error string. `ComSpec` and `SystemRoot` are stubbed, never inherited.
- Gate on darwin arm64 after the wave: 402 tests passed, 7 skipped, `golden:dryrun` OK 36 cases, `golden:mutation` OK 59 cases, zero golden drift, `smoke:native` exit 0.
- A18 re-proven on the pushed head: golden-regression run 31920243311 for `4760973` is green in all six jobs, `windows-2025` included.

### Round 4 — release, 2026-08-16

step:release_windows is proven. Tag `cli-v0.15.3` ran release-cli run 31920431715 to success across `resolve`, `build`, `github-release`, and `npm-publish`.

- A16 satisfied: the release carries exactly six binaries — `docks-kit-{linux,darwin}-{x64,arm64}` and `docks-kit-windows-{x64,arm64}.exe` — plus a `SHA256SUMS` with six entries whose names match the assets.
- The published `docks-kit-darwin-arm64` was downloaded and verified on a real host: its SHA-256 equals the manifest entry, `--version` prints `0.15.3`, and `sync --dry-run` exits 0. The artifact is genuine and runnable, not merely uploaded.
- `npm view docks-kit version` reports `0.15.3`, published through OIDC trusted publishing.

### Round 5 — review fixes on the test helpers, 2026-08-16

Review rounds 2 through 6 produced five LOW findings: two in the test helpers, three in this document's own prose. All are fixed; the verdicts and dispositions are in `## Review`.

- `PATH` isolation: the two "absent tool" cases resolved against the runner's inherited `PATH`. Each case now gets a temporary directory holding exactly the shims it needs — none, for the absent case. Proven before the fix: planting `docks-kit-absent-tool`, `.cmd`, and `.exe` on `PATH` fails exactly those two cases at the pre-fix commit and none after it.
- `PATH` restore: a saved-but-absent value was assigned back rather than deleted. Both helpers now delete the key when it was initially absent.
- Gate after each fix: 402 tests passed, 7 skipped, both golden lanes OK, zero golden drift. A18 re-proven twice more — golden-regression runs 31920952071 for `e9c70ad` and 31921161785 for `0cf34a5` are green in all six jobs.
