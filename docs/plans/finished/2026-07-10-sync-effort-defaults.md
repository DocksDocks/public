---
title: Add sync modifiers and harden packaged CLI metadata
goal: Add validated effort/advisor sync overrides, switch Claude to Fable/high defaults, generate the CLI version, and verify Bun's blocked-script warning.
status: finished
created: "2026-07-10T13:15:37-03:00"
updated: "2026-07-10T16:50:23-03:00"
ship_commit: e22cd6e41ff9e42bb2c3e8986d5937c9a8b35086
started_at: "2026-07-10T13:53:31-03:00"
assignee: null
tags: [cli, sync, claude, codex]
affected_paths:
  - AGENTS.md
  - CLAUDE.md
  - SoT/.claude/settings.json
  - SoT/models.json
  - cli/docs/flags.md
  - cli/docs/install.md
  - cli/docs/models.md
  - cli/docs/modifiers.md
  - cli/docs/sync-layers.md
  - cli/src/commands/sync.ts
  - cli/src/efforts.ts
  - cli/src/engine-native/claudeModel.ts
  - cli/src/engine-native/claudeSettingsModifiers.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/codexToml.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/generated/sotPayload.ts
  - cli/src/main.ts
  - cli/scripts/generate-sot-payload.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/efforts.test.ts
  - cli/test/unit/bun.test.ts
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/payload.test.ts
  - .github/workflows/windows-entrypoints.yml
  - docs/plans/active/sync-effort-defaults.md
related_plans: []
review_status: passed
planned_at_commit: 671831c1a8cd74b0980b4487bce5d6e5f3961edb
---

## Goal

Ship three deploy-time modifier surfaces through the typed public CLI and EngineNative: Claude and Codex effort overrides with tool-specific validation, plus a Claude advisor toggle. A flag-less sync must restore Claude effort to its revised SoT value (`high`), Codex effort to `xhigh`, and disable the Claude advisor, while the Claude SoT model becomes `fable` without changing the alias inventory. Also replace the hard-coded CLI version with a generated `package.json` version that survives compilation, and prove/document that Bun's expected blocked `@parcel/watcher` install script does not impair the global CLI. The work is complete only when public-parser behavior, raw-engine behavior, deployed JSON/TOML mutations, generated metadata/payload parity, consumer-install behavior, docs, golden snapshots, and prove-red legs all pass.

## Context & rationale

The existing model modifier is a two-layer contract: `cli/src/commands/sync.ts` parses and forwards public CLI options, then `cli/src/engine-native/parseArgs.ts` validates target applicability before each tool sync applies its modifier after the base SoT merge. That ordering makes overrides machine-local and lets a later flag-less sync reassert the SoT.

The Claude settings merge is additive for keys absent from the SoT. Therefore, removing `advisorModel` from `SoT/.claude/settings.json` alone would leave the previously kit-owned key on existing machines. Add `advisorModel` to `claudeSync.ts`'s baseline removed manifest, which is the repository's deliberate migration path for retired kit-owned settings keys. When any explicit `--claude-advisor=on|off|default` value is present, exclude only `advisorModel` from that run's removal-key list and let the later modifier own the set/delete action; when the flag is absent, the removal pass enforces the advisor-off SoT. This avoids duplicate dry-run actions and delete/re-add/restart churn.

The official Codex docs currently disagree: the configuration reference still lists `minimal|low|medium|high|xhigh`, while the current subagent guide lists `none|minimal|low|medium|high|xhigh|max|ultra`. Current `openai/codex` main resolves the conflict: its parser names all eight levels and permits future non-empty custom strings. This feature deliberately validates the eight currently named values because the user requested an exact, discoverable enum; actual support remains model-dependent. The live GPT-5.6 catalog on the implementation host advertises `low` through `ultra` for Sol, `low` through `ultra` for Terra, and `low` through `max` for Luna as of 2026-07-10.

The shipped CLI version has a separate generation defect: `cli/src/main.ts` hard-codes `0.1.0` while `package.json` is `0.4.0`. Runtime lookup is not acceptable because standalone binaries do not ship `package.json`. Extend the existing payload generator to read and validate the package version at generation time, emit it beside the payload constants, and let the existing byte-comparison `--check` path catch package/generated drift. This follows the same authoring-input-to-generated-output contract as the launcher's Bun pin.

A disposable consumer install of the local `0.4.0` tarball with pinned Bun `1.3.14` installed 37 packages and printed exactly `Blocked 1 postinstall. Run \`bun pm -g untrusted\` for details.` The untrusted report named only `@parcel/watcher @2.5.6`; `esbuild` was absent because it is dev-only through Vitest/Vite, and `msgpackr-extract` was present but is on Bun's built-in default-trusted list. `@parcel/watcher` is a production transitive of `@effect/platform-bun`, but its install script only invokes `node-gyp` when `npm_config_build_from_source=true`, and supported-platform prebuilt optional packages are already installed. The isolated global CLI successfully ran `--version`, `models claude`, and `toolchain check` with the script blocked. Dropping/replacing the Bun Effect runtime layer would be a high-risk dependency redesign for a benign warning, so this round documents the exact warning and turns the existing Windows bun-shim smoke into an explicit blocked-script regression assertion.

### Verbatim requirements

> 1. `sync` gains per-tool EFFORT deploy-time modifier flags mirroring the existing model flags: `--claude-effort=<level>` (writes the effort key in deployed ~/.claude/settings.json) and `--codex-effort=<level>` (writes `model_reasoning_effort` in ~/.codex/config.toml). Same UX family as --claude-model/--codex-model: value validation with clear error, `default` reverts to the SoT value, warn-if-ignored when that target isn't selected, bare flag prints the valid catalog. RESEARCH the current valid effort enums per tool from official documentation — the GPT-5.6 frontier models added levels up to `ultra`; verify what Claude Code's effortLevel accepts today and what Codex's model_reasoning_effort accepts today (web research; also read the docks capability-tuning skill at ~/.claude/plugins/cache/docks/docks/*/skills/engineering/capability-tuning/ if present for prior grounded knowledge — but official docs win). Encode per-tool valid sets exactly; do not assume they're identical. SoT default effort stays xhigh for BOTH tools.
>
> 2. SoT deployed Claude default model becomes `fable` (today `docks-kit model claude` reports `SoT: opus` — trace where that default comes from: SoT/.claude/settings.json model key and/or SoT/models.json alias mapping — and change the default to fable while keeping the alias catalog intact).
>
> 3. Advisor OFF by default in the deployed Claude settings, with a sync flag to enable it per machine (shape it consistently with the other modifier flags, e.g. --claude-advisor=on|off with `default` semantics). RESEARCH the actual Claude Code settings key that controls the advisor feature in current official docs — do NOT invent a key. If no documented settings key exists, record that with evidence as an ## Open question (options: env var? not-possible?) instead of guessing. Codex side: only if a real equivalent exists; otherwise explicitly N/A with one-line evidence.
>
> 4. Everything stays per-tool-appropriate (claude flags affect only the claude target, codex flags only codex — same warn discipline the model flags use).

### Verbatim relay refinements (supersede conflicts above)

> Important refinement for the plan: now that the Claude default model becomes fable, the Claude SoT effort default should change from xhigh to HIGH (SoT/.claude/settings.json effortLevel: "high"). Codex SoT default stays xhigh. Flags/validation unchanged; `default` reverts to each tool's SoT (Claude high, Codex xhigh). Revise Context verbatim, Interfaces, relevant Step, and golden ledger (settings bytes shift). Still no implementation until explicit go-ahead.

> Add the `--version` bug to required plan scope: `cli/src/main.ts:62` hardcodes version `"0.1.0"` while package.json is `0.4.0`. Bake the version from package.json at GENERATION time because compiled binaries cannot read package.json at runtime; follow the BUN_PIN precedent in `cli/scripts/generate-sot-payload.ts`; `main.ts` imports the generated constant; generator `--check` fails on package.json/generated drift; add a unit test that the CLI-reported version equals package.json. Add its own step and executable acceptance `docks-kit --version == package.json version`.

> Investigate precisely which script-bearing packages land in a CONSUMER production install and whether runtime works when Bun blocks them. Choose dependency-graph slimming if cheap/safe; otherwise document the benign warning in `cli/docs/install.md` with exact Bun output and only verified trust guidance. If feasible, add a CI assertion in the bun-shim job that the CLI survives blocked postinstalls. Do not invent trust instructions.

Research result for requirement 3: Claude officially documents `advisorModel`; any configured model enables advisor and unsetting the key disables it. Fable-main + Fable-advisor is an accepted pairing. Codex advisor is **N/A**: the current official `config.toml` key table has no `advisor*` setting; `review_model` only overrides `/review`, and Codex's separate secondary-agent mechanism is subagents/multi-agent rather than an advisor toggle.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`.
- Branch: `codex/sync-effort-defaults`, based on `main` at `671831c1a8cd74b0980b4487bce5d6e5f3961edb`.
- Runtime/package manager: Bun, using the repository-pinned dependencies and scripts.
- Do not run mutation smoke tests against the real `~/.claude` or `~/.codex`. The golden harness creates disposable fixture homes; public manual smoke checks must be `--dry-run` only.
- Before editing after a pause, run the drift check:

  ```bash
  git diff --stat 671831c1a8cd74b0980b4487bce5d6e5f3961edb..HEAD -- AGENTS.md CLAUDE.md SoT cli
  ```

  Stop and reconcile this plan if an in-scope path changed unexpectedly.

- Regenerate embedded SoT after authoring changes, then prove it is current:

  ```bash
  bun cli/scripts/generate-sot-payload.ts
  bun cli/scripts/generate-sot-payload.ts --check
  ```

- Prove the generated version on source and the current-target compiled path (the build stays under ignored `cli/dist/`):

  ```bash
  expected="$(jq -r .version package.json)"
  test "$(bun cli/src/main.ts --version)" = "$expected"
  bash cli/build-binaries.sh linux-x64
  test "$(cli/dist/docks-kit-linux-x64 --version)" = "$expected"
  test "$(./docks-kit --version)" = "$expected"
  ```

- Reproduce the consumer production install without touching the real Bun-global prefix. Do not clean the probe with a destructive command; `/tmp` lifecycle owns it:

  ```bash
  probe="$(mktemp -d /tmp/docks-kit-consumer.XXXXXX)"
  version="$(jq -r .version package.json)"
  bun pm pack --destination "$probe"
  install_out="$(env HOME="$probe/home" BUN_INSTALL="$probe/bun" NO_COLOR=1 bun add -g "$probe/docks-kit-$version.tgz" 2>&1)"
  printf '%s\n' "$install_out"
  grep -Fx 'Blocked 1 postinstall. Run `bun pm -g untrusted` for details.' <<<"$install_out"
  untrusted="$(env HOME="$probe/home" BUN_INSTALL="$probe/bun" NO_COLOR=1 bun pm -g untrusted)"
  printf '%s\n' "$untrusted"
  grep -F './node_modules/@parcel/watcher @2.5.6' <<<"$untrusted"
  grep -F '» [install]: node scripts/build-from-source.js' <<<"$untrusted"
  ! env HOME="$probe/home" BUN_INSTALL="$probe/bun" NO_COLOR=1 bun pm -g ls --all | grep -F esbuild
  env HOME="$probe/home" BUN_INSTALL="$probe/bun" NO_COLOR=1 "$probe/bun/bin/docks-kit" --version
  env HOME="$probe/home" BUN_INSTALL="$probe/bun" NO_COLOR=1 "$probe/bun/bin/docks-kit" models claude
  env HOME="$probe/home" BUN_INSTALL="$probe/bun" NO_COLOR=1 "$probe/bun/bin/docks-kit" toolchain check
  ```

  All assertions/commands must exit `0`; `--version` must equal `$version`. The probe intentionally does not run `bun pm trust`.

- Update golden files only through their generators, inspect the diff, then run the normal and prove-red legs:

  ```bash
  bun run golden:dryrun --update-goldens
  bun run golden:mutation --update-goldens
  bun run golden:dryrun
  bun run golden:mutation
  bun run golden:dryrun --prove-red
  bun run golden:mutation --prove-red
  ```

  Each prove-red command must exit `1` and print its matching `prove-red OK:` marker; exit `0` is a failure.

  Use this assertion form rather than treating any non-zero result as success:

  ```bash
  for suite in dryrun mutation; do
    set +e
    out="$(bun run "golden:${suite}" --prove-red 2>&1)"
    code=$?
    set -e
    test "$code" -eq 1
    grep -F "prove-red OK: golden-${suite}" <<<"$out"
  done
  ```

## Interfaces & data shapes

### Public flag grammar

| Flag | Accepted values | Deployed mutation | `default` meaning |
|---|---|---|---|
| `--claude-effort=<level>` | `low`, `medium`, `high`, `xhigh`, `default` | Top-level `effortLevel` string in `~/.claude/settings.json` | Write the embedded SoT value, revised to `high` |
| `--codex-effort=<level>` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, `default` | Top-level `model_reasoning_effort = "<level>"` in `~/.codex/config.toml` | Write the embedded SoT value, currently `xhigh` |
| `--claude-advisor=<state>` | `on`, `off`, `default` | `on` writes top-level `advisorModel: "fable"`; `off` deletes `advisorModel` | Delete `advisorModel`, matching the advisor-off SoT |

The upstream effort values above exclude the kit's `default` pseudo-value. Claude's persisted `effortLevel` does not accept session-only `max` or `ultracode`. Codex accepts the eight currently named values at parse/config level, but the active model may expose only a subset; the kit validates the vocabulary, not model/entitlement compatibility.

### UX and exit contract

- Bare `--claude-effort`, `--codex-effort`, or `--claude-advisor` prints the relevant valid-value catalog, a clear `requires a value` error, and exits `2` without touching the home tree. Preserve the existing model-family channel split: EngineNative/raw prints catalog data through `echo` (stdout) and the error through `err` (stderr); the typed public CLI's pre-engine `bail` prints its combined catalog+error diagnostic to stderr.
- An invalid value prints the same catalog, names the rejected value and valid grammar, exits `2`, and leaves the home tree unchanged.
- A Claude-only modifier passed without the `claude` target warns `<flag> ignored: claude target not selected`, clears that override, and continues the selected targets. The Codex effort flag mirrors this for `codex`.
- The typed public CLI and the harness-private `native-raw` channel must produce the same normalized EngineNative argv for valued flags and equivalent bare-flag content/exit behavior; their existing catalog channels remain intentionally different as described above.
- Modifier application order is base SoT merge, baseline removed-key cleanup, then Claude compact/permissive/model/effort/advisor overrides; Codex is base config merge, model override, then effort override. Claude's removal list includes `advisorModel` only when no advisor flag is present; any explicit state is handled exactly once by the later advisor modifier. This preserves flag-less reversion and idempotent, unambiguous `on|off|default` replays.
- Every actual model, effort, or advisor mutation sets the corresponding restart trigger. No-op messages remain verbose-only.

### Shared effort catalog

Create `cli/src/efforts.ts` as the single typed source for the two valid-value lists, their 2026-07-10 verification metadata/notes, catalog rendering, validation, and embedded-SoT default resolution. It must distinguish upstream values from the `default` pseudo-value and fail deterministically if an embedded SoT effort is missing or falls outside that tool's known upstream list. `cli/src/commands/sync.ts` and EngineNative consume this module rather than duplicating enum strings.

Catalog order is part of the UX contract: Claude renders `low, medium, high, xhigh, default`; Codex renders `none, minimal, low, medium, high, xhigh, max, ultra, default`; advisor renders `on, off, default`. Each header names the tool, setting (`effortLevel`, `model_reasoning_effort`, or `advisorModel`), and verification date. Claude's `default` row says `SoT: high`, Codex's says `SoT: xhigh`, and advisor's says `SoT: off (unset)`; the Codex header/footnote says support is model-dependent.

### Claude JSON mutation seam

Rename `cli/src/engine-native/claudeModel.ts` to `claudeSettingsModifiers.ts`. Preserve `syncClaudeModel` for `modes.ts`, and share its existing atomic read/parse/temporary-file/rename behavior across `syncClaudeEffort` and `syncClaudeAdvisor`. Invalid deployed JSON remains a logged skip, not a partially written file. Model `default` keeps its existing account-default deletion semantics; effort `default` and advisor `default` follow the table above.

### Codex TOML mutation seam

Extend `codexToml.ts` with `syncCodexEffort`, reusing `replaceTopLevelSettingInFile` so comments, user tables, first-table insertion, and newline behavior remain byte-stable. Do not hand-roll a second TOML rewrite path.

### Generated package version

Extend `cli/scripts/generate-sot-payload.ts` with a `packageVersion(root)` reader that parses root `package.json`, requires a non-empty string `version`, and emits `GENERATED_PACKAGE_VERSION` from the existing generated-module template. `cli/src/main.ts` imports that constant and passes it to `Command.run`; it must not read `package.json` at runtime. Because `staleGeneratedPaths` already compares the complete generated module, changing `package.json` without regeneration makes `--check` exit `1` and name `cli/src/generated/sotPayload.ts`.

`cli/test/unit/payload.test.ts` must copy `package.json` into its disposable generator root, prove a package-version edit makes `--check` fail, and spawn the public source CLI to assert stdout equals the parsed package version. The final gate builds the current Linux binary into ignored `cli/dist/` and asserts both that binary and the checkout launcher report the same version, proving the compiled path embeds rather than discovers the value.

### Bun blocked-script consumer contract

Keep the current production dependency graph. `@effect/platform-bun` is the only imported platform implementation and supplies `BunContext.layer`/`BunRuntime.runMain`; it unconditionally depends on `@effect/platform-node-shared`, which declares `@parcel/watcher`. Removing that transitive would require replacing the runtime layer and is not a cheap/safe warning cleanup. The consumer contract is instead:

- Pinned Bun `1.3.14` may print exactly `Blocked 1 postinstall. Run \`bun pm -g untrusted\` for details.` during global installation.
- `bun pm -g untrusted` must name `@parcel/watcher @2.5.6` and its `node scripts/build-from-source.js` install command; no project documentation instructs users to trust it because supported default installs use optional prebuilt packages and the script is a no-op unless source builds were explicitly requested.
- The existing Windows `bun-shim` job captures and asserts that blocked-script identity/count, then its existing foreign-cwd catalog, toolchain, and real-sync steps prove the installed CLI still functions. If Bun's pinned version or dependency pin changes, update this assertion only after re-running the isolated consumer probe and reviewing the new script-bearing set.

## File manifest

| Path | Intended change |
|---|---|
| `cli/src/efforts.ts` | New shared typed effort catalogs, renderer, validator, and embedded-SoT default lookup |
| `cli/src/commands/sync.ts` | Add Effect CLI options, bare-flag hints, and normalized argv forwarding for all three new flags |
| `cli/src/engine-native/index.ts` | Add context fields and invoke expanded modifier validation |
| `cli/src/engine-native/parseArgs.ts` | Help, bare forms, valued parsing, validation, invalid errors, and target-ignore warnings |
| `cli/src/engine-native/claudeModel.ts` → `cli/src/engine-native/claudeSettingsModifiers.ts` | Rename and generalize the atomic Claude settings modifier seam while preserving direct model mode |
| `cli/src/engine-native/claudeSync.ts` | Add `advisorModel` to baseline removals, skip that removal for any explicit advisor state, and apply effort/advisor modifiers after base sync/removals |
| `cli/src/engine-native/codexToml.ts` | Add top-level effort modifier using the existing line-stable TOML helper |
| `cli/src/engine-native/codexSync.ts` | Apply Codex effort after the base merge/model override |
| `cli/src/engine-native/modes.ts` | Import `syncClaudeModel` from its renamed module only; no new standalone effort/advisor mode |
| `SoT/.claude/settings.json` | Remove `advisorModel` in Step 2 so migration replays are idempotent; in Step 4 change `model` from `opus` to `fable` and `effortLevel` from `xhigh` to `high` |
| `SoT/models.json` | Keep every alias/ID and order; set the Opus note to `latest Opus (currently Opus 4.8)` and the Fable note to `Fable 5 — the kit SoT default; needs org access + Claude Code >=2.1.170` |
| `cli/scripts/generate-sot-payload.ts` | Read/validate root package version and emit it into the generated module alongside the payload/Bun-pin generation contract |
| `cli/src/generated/sotPayload.ts` | Regenerated payload plus `GENERATED_PACKAGE_VERSION`; never hand-edit |
| `cli/src/main.ts` | Import the generated package version and remove the hard-coded `0.1.0` |
| `cli/test/unit/efforts.test.ts` | Exact per-tool enums, catalog text, pseudo-value handling, and SoT-default parity |
| `cli/test/unit/engine-di.test.ts` | Raw-engine bare/invalid/ignored paths and update `model claude` SoT expectation to `fable` |
| `cli/test/unit/payload.test.ts` | Copy `package.json` into generator fixtures; prove version drift fails `--check`; assert public CLI version equals package metadata |
| `cli/test/golden-dryrun.ts` / `cli/test/golden-mutation.ts` | Add modifier cases, public-parser invariants, and preserve a real model-override replay by switching it from `fable` to `opus` |
| `cli/test/goldens/dryrun.json` / `cli/test/goldens/mutation.json` | Generator-produced reviewed deltas only |
| `cli/docs/install.md` | Document the exact pinned-Bun blocked-postinstall output, why it is benign for supported defaults, and the no-trust-required boundary |
| `.github/workflows/windows-entrypoints.yml` | In `bun-shim`, assert the pinned install blocks only the known watcher script before the existing functional smokes |
| `AGENTS.md`, `CLAUDE.md`, `cli/docs/flags.md`, `cli/docs/models.md`, `cli/docs/modifiers.md`, `cli/docs/sync-layers.md` | Document grammar, per-tool defaults, advisor-off migration, target scope, official enum nuance, and verification |

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | Add `cli/src/efforts.ts`; wire exact valued/bare options through `cli/src/commands/sync.ts`, `cli/src/engine-native/index.ts`, and `cli/src/engine-native/parseArgs.ts`, with focused tests and regenerated affected goldens in the same slice. Done when the exact Claude/Codex lists, `default` resolution, exit `2` diagnostics, target-ignore warnings, and public/raw channel contracts pass the mandatory per-slice gate. Revert trigger: any new string list is duplicated across public and native layers. | — | done |
| 2 | Rename/generalize the Claude modifier module, update `modes.ts`, remove `advisorModel` from `SoT/.claude/settings.json` and regenerate the payload, add `advisorModel` to the baseline removed manifest with the explicit-state exclusion, apply Claude effort/advisor after removals in `claudeSync.ts`, and add/regenerate focused tests/goldens in the same slice. Done when disposable-home tests show atomic JSON edits, flag-less advisor deletion, `on → fable`, both advisor delete forms, effort `default →` the current embedded SoT (`xhigh` in this slice; `high` after Step 4), restart/no-op behavior, every repeated advisor state is a true no-op, and the mandatory per-slice gate passes. Revert trigger: any invalid JSON is rewritten, `settings.local.json` is touched, or a repeated state logs duplicate removal/modifier changes. | 1 | done |
| 3 | Extend `codexToml.ts` and `codexSync.ts` for effort, with focused fixture coverage and regenerated affected goldens in the same slice. Done when every existing TOML fixture remains structurally stable, `ultra`, `none`, and `default → xhigh` replacements occur only before the first table, and the mandatory per-slice gate passes. Revert trigger: comments/tables reformat or a Claude target touches Codex config. | 1 | done |
| 4 | Change the remaining Claude defaults in `SoT/.claude/settings.json` (`model: opus → fable`, `effortLevel: xhigh → high`) and only the two stale notes in `SoT/models.json`; regenerate `cli/src/generated/sotPayload.ts`; update the six model/modifier human/user docs and affected goldens in the same slice. Done when Claude's embedded defaults are `model: fable`, `effortLevel: high`, and advisor remains unset from Step 2; the alias/ID sequence is byte-for-byte identical; `docks-kit model claude` reports `SoT: fable`; no current doc claims advisor-on/Opus/xhigh as Claude's SoT default; and the mandatory per-slice gate passes. | 1, 2 | done |
| 5 | Extend `cli/scripts/generate-sot-payload.ts` to emit the validated root package version, import it from `main.ts`, and add the package-drift/public-version tests to `payload.test.ts`; regenerate the module in the same slice. Done when changing only a disposable fixture's package version makes generator `--check` exit `1` naming the generated module, source CLI `--version` equals root `package.json`, a current-target compiled binary reports the same value, and the mandatory per-slice gate passes. Revert trigger: any runtime `package.json` read to obtain the CLI version, second version literal, or generated edit outside the generator. | — | done |
| 6 | Document the exact Bun `1.3.14` warning in `cli/docs/install.md` and harden `.github/workflows/windows-entrypoints.yml`'s `bun-shim` install step: capture `bun add -g`, assert `Blocked 1 postinstall`, run `bun pm -g untrusted`, and assert only `@parcel/watcher @2.5.6`/`node scripts/build-from-source.js` before the existing catalog/toolchain/sync smokes. Done when a fresh isolated production-tarball install has no `esbuild`, reproduces that identity/count, and all three functional smokes succeed without trusting scripts. Revert trigger: the pinned install reports another blocked package, a smoke fails, or the workflow would run `bun pm trust`. | 5 | done |
| 7 | Audit and harden the assembled unit/golden coverage against the ledger below; regenerate snapshots only if a missing planned case is added. Done when expected labels alone change, new flag cases exist, the two named canaries are byte-identical, version changes do not alter sync goldens, no snapshot is manually edited, and the mandatory per-slice gate passes. Revert trigger: either canary changes or unrelated argv/plugin/toolchain output moves. | 2, 3, 4, 5, 6 | done |
| 8 | Run every acceptance command and inspect `git diff --check`, payload/version parity, tests, goldens, prove-red markers, consumer-install evidence, and docs/source diff. Done when all green criteria below are captured in the implementation handoff; do not commit or push automatically unless the orchestrator explicitly asks. | 7 | done |

## Notes

- 2026-07-10 orchestrator approval: move only the SoT `advisorModel` removal and payload regeneration from Step 4 to Step 2 so the flag-less migration replay is a true no-op; keep the model/effort defaults, model notes, and docs in Step 4.
- 2026-07-10 orchestrator approval: clarify the version acceptance to generation-only version discovery; baseline `kitHome.ts`/`payload.ts`/`update.ts` package-root, display, and update probes are legitimate and remain out of scope.
- 2026-07-10 Fix Round 1: distinguish an explicitly empty modifier from an option that was not supplied, normalize typed `--flag=` before Effect CLI target parsing, and reject both `--flag=` and `--flag ""` through the shared EngineNative catalog-first invalid-value path. The same latent defect was confirmed in both existing model modifiers, so the shared supplied-state path and raw/typed regression coverage include `--claude-model` and `--codex-model` as well as the three new modifiers. Effort/advisor help and bare/invalid errors now derive their exact grammar from `cli/src/efforts.ts` helpers.
- 2026-07-10 Fix Round 1 gate note: the exact `bun run test:unit` gate ultimately passed 114/114. Three earlier full-suite attempts missed only the unrelated direct-Bun statusline p95 wall-clock cap (111.8 ms, 104.2 ms, and 105.2 ms versus 100 ms); the focused timing test and a serialized 114/114 diagnostic passed, no threshold/test was changed, and the final exact retry passed.

## Golden ledger

Golden updates are expected because deployed Claude settings bytes change in three ways and the modifier command rows expand. Step 2 owns the `advisorModel` removal/migration bytes and advisor/Claude-effort command rows; Step 4 owns the later `model: opus → fable` and `effortLevel: xhigh → high` bytes. The generated package-version constant and Bun install documentation/workflow must not affect sync golden output. Regenerate, then review by label.

### Existing labels expected to change

- `fixture=home-drift cmd=model claude` — SoT display changes `opus → fable`; the Fable/Opus notes change without altering catalog IDs.
- `fixture=home-fresh cmd=sync claude`
- `fixture=home-drift cmd=sync claude`
- `fixture=home-drift cmd=sync --reconcile`
- `fixture=home-drift cmd=sync --prune`
- `fixture=home-fresh cmd=sync claude stubs=claude`
- `fixture=home-fresh cmd=sync claude stubs=curl,rtk variant=curl-absent-rtk-bootstrap`
- `fixture=home-fresh cmd=sync claude stubs=git`
- `fixture=home-fresh cmd=sync claude stubs=jq variant=jq-absent-bun-hooks`
- `fixture=home-fresh cmd=sync stubs=git`
- `fixture=home-fresh cmd=sync replay=2nd`
- `fixture=home-drift cmd=sync replay=2nd`
- `fixture=home-fresh cmd=sync --verbose replay=2nd`
- `fixture=home-drift cmd=sync claude --claude-model=fable replay=2nd` (Step 2 settings-byte change; renamed to the Opus replay in Step 4)
- `migration=legacy-claude-hook-scripts`

These change in Step 2 only for the removed `advisorModel` bytes and directly consequent settings/removal/restart lines, then in Step 4 for the revised model/effort bytes (including `effortLevel: high`). Plugin argv, toolchain argv, rules, skills, runtime assets, CLI-version metadata, and unrelated output remain stable.

### Renamed/replaced modifier labels

- Replace all three dry-run fixture rows ending in `sync claude --dry-run --claude-model=fable --claude-compact-window=680k --claude-permissive` with rows ending in `sync claude --dry-run --claude-model=opus --claude-effort=low --claude-advisor=on --claude-compact-window=680k --claude-permissive`.
- Replace mutation label `fixture=home-drift cmd=sync claude --claude-model=fable --claude-compact-window=680k --claude-permissive` with the corresponding `--claude-model=opus --claude-effort=low --claude-advisor=on ...` row.
- Replace replay label `fixture=home-drift cmd=sync claude --claude-model=fable replay=2nd` with `fixture=home-drift cmd=sync claude --claude-model=opus replay=2nd`, because Fable is no longer an override against the SoT.

### Step 4 follow-on changes to earlier modifier labels

- The four `advisor-migration=prior-kit-settings state=*` labels and the
  `fixture=home-drift` Claude advisor/effort modifier labels change only in
  their deployed settings bytes when the remaining model/effort defaults move
  to Fable/high.
- `fixture=home-fresh cmd=sync claude --claude-effort` and the corresponding
  invalid `--claude-effort=max` label change only in catalog text from
  `default — SoT: xhigh` to `default — SoT: high`.

### Fix Round 1 label changes

- Existing `fixture=home-fresh cmd=sync claude --claude-effort` and `fixture=home-fresh cmd=sync codex --codex-effort` rows change only their bare-error grammar from generic `<level>` to the exact shared catalog order.
- New `fixture=home-fresh cmd=sync claude --claude-effort=`, `fixture=home-fresh cmd=sync codex --codex-effort=`, and `fixture=home-fresh cmd=sync claude --claude-advisor=` rows pin exit `2`, empty argv, unchanged fixture trees, catalog-first output, and the explicit-empty invalid-value diagnostic.
- Direct raw and public channel invariants cover both `--flag=` and `--flag ""` for those three new modifiers and both existing model modifiers. The model cases do not add golden rows; their no-sync/channel behavior is asserted directly alongside the new-modifier cases.

### New labels/cases

- Dry-run Codex modifier rows for each fixture: `sync codex --dry-run --codex-effort=ultra`.
- One target-ignore dry-run case covering all mismatches: `sync agents --dry-run --claude-effort=low --claude-advisor=on --codex-effort=max`.
- Bare and invalid cases for both effort flags, plus bare/invalid advisor cases; assert exit `2`, exact catalog/error channel placement, empty mutation tree, and no child argv.
- Add a targeted `advisor-migration=prior-kit-settings` case in `golden-mutation.ts` by materializing a disposable `home-drift` variant whose `.claude/settings.json` includes the prior kit-owned `"advisorModel": "fable"`. A flag-less Claude sync must remove it; explicit `off` and `default` runs must each delete it through the modifier (not the removal pass); an `on` run must preserve/normalize it through the modifier; every second replay must be a true no-op. Do not alter the shared `home-drift` fixture and broaden unrelated hashes.
- Mutation rows for Claude `--claude-effort=default` (`→ high`), Claude `--claude-advisor=on`, and Codex `--codex-effort=ultra`/`default` (`default → xhigh`) pin per-tool set/default semantics and idempotent replay behavior. Advisor delete semantics are pinned by the prior-kit-settings cases above.

### Byte-identical canaries

- `fixture=home-fresh cmd=sync claude stubs=rtk` (RTK-init failure before settings preparation) must remain byte-identical: exit `1`, no deployed settings, identical output and argv.
- `fixture=home-drift cmd=sync claude --claude-plugin=supabase,n8n` (raw/native comma-plugin parse abort) must remain byte-identical: exit `2`, empty argv, unchanged tree, and the existing unknown-plugin error.

## Acceptance criteria

- [x] `bunx tsc --noEmit -p cli` exits `0`.
- [x] `bun run test:unit` exits `0` with 114/114 tests and includes exact catalog/default/parser/mutation assertions for the three new flags.
- [x] `bun cli/scripts/generate-sot-payload.ts --check` exits `0` after generation; `git diff -- cli/src/generated/sotPayload.ts` contains only authoring changes from `SoT/.claude/settings.json`/`SoT/models.json`, their payload hash, and the new generated package-version export.
- [x] `bun run golden:dryrun` exits `0`.
- [x] `bun run golden:mutation` exits `0`.
- [x] The `for suite in dryrun mutation; ...` assertion in Environment passes: each prove-red leg exits exactly `1` and prints its matching `prove-red OK:` marker.
- [x] `git diff --check` exits `0`.
- [x] `SoT/.claude/settings.json` has `model: fable`, has no `advisorModel`, and has `effortLevel: high`; `SoT/.codex/config.toml` still has both reasoning effort keys at `xhigh`.
- [x] `diff <(git show 671831c1a8cd74b0980b4487bce5d6e5f3961edb:SoT/models.json | jq -r '.claude.models[].id') <(jq -r '.claude.models[].id' SoT/models.json)` exits `0`; `git diff -- SoT/models.json` shows only the two planned note edits.
- [x] Bare raw-engine flags print catalogs on stdout, errors on stderr, and exit `2`; typed public bare flags print equivalent catalog+error content on stderr and exit `2`; invalid values name the bad value and exit `2`; no case mutates fixture HOME or spawns children. Raw help plus raw/typed bare errors render the exact effort/advisor grammar derived from the shared catalog order.
- [x] Both `--flag=` and `--flag ""` reject explicit empty values through catalog-first shared validation with exit `2` for `--claude-effort`, `--codex-effort`, and `--claude-advisor`. The confirmed latent hole in `--claude-model` and `--codex-model` is fixed and covered through the same raw/typed path.
- [x] `--claude-effort` and `--claude-advisor` warn and do nothing when Claude is not selected; `--codex-effort` mirrors this for Codex. Correctly targeted flags never touch the other tool's file.
- [x] Claude effort writes only `effortLevel` and `default` writes embedded SoT `high`; Codex effort writes only top-level `model_reasoning_effort` and `default` writes embedded SoT `xhigh`.
- [x] A flag-less Claude sync deletes the formerly kit-owned `advisorModel` through the removal pass. Any explicit advisor state excludes only that key from removals: `on` preserves/writes `advisorModel: fable`, while `off` and `default` delete it through the modifier. Repeating any same state produces no removal/modifier change lines and no advisor-caused restart trigger.
- [x] Existing model direct mode still works after the module rename, and `docks-kit model claude` reports `SoT: fable`.
- [x] `cli/test/unit/payload.test.ts` proves a disposable `package.json` version edit makes generator `--check` exit `1` with `generated payload is stale: cli/src/generated/sotPayload.ts`, and proves `bun cli/src/main.ts --version` equals `jq -r .version package.json`.
- [x] After `bash cli/build-binaries.sh linux-x64`, both `cli/dist/docks-kit-linux-x64 --version` and `./docks-kit --version` print exactly `jq -r .version package.json` and exit `0`; no runtime source reads `package.json` to obtain the CLI version; existing kit-home/display/update probes remain out of scope.
- [x] A fresh disposable global install from `bun pm pack` under pinned Bun `1.3.14` prints exactly `Blocked 1 postinstall. Run \`bun pm -g untrusted\` for details.`; the untrusted listing names only `@parcel/watcher @2.5.6` with `node scripts/build-from-source.js`; `bun pm -g ls --all` contains no `esbuild`; and installed `docks-kit --version`, `models claude`, and `toolchain check` all exit `0` without any trust command.
- [x] `.github/workflows/windows-entrypoints.yml`'s `bun-shim` job asserts the same blocked package/command before its existing foreign-cwd catalog, toolchain, and materialized-settings smokes; `cli/docs/install.md` reproduces the exact warning and gives no blanket or invented trust instruction.
- [x] Golden diff matches the ledger; the RTK-init-failure and comma-plugin parse-abort objects are byte-identical before/after. Prove with the following command for each `label` value (exit `0`, no diff):

  ```bash
  for label in \
    'fixture=home-fresh cmd=sync claude stubs=rtk' \
    'fixture=home-drift cmd=sync claude --claude-plugin=supabase,n8n'; do
    diff \
      <(git show 671831c1a8cd74b0980b4487bce5d6e5f3961edb:cli/test/goldens/mutation.json | jq -S --arg label "$label" '.cases[$label]') \
      <(jq -S --arg label "$label" '.cases[$label]' cli/test/goldens/mutation.json)
  done
  ```
- [x] `AGENTS.md`, `CLAUDE.md`, and the five affected `cli/docs/` pages describe the new grammar/defaults/install behavior and contain no live claim that Opus, Claude xhigh, or advisor-on is the SoT default.

## Out of scope / do-NOT-touch

- No standalone `docks-kit effort` or `docks-kit advisor` command; this round adds `sync` modifiers only. `modes.ts` changes solely for the Claude modifier module rename.
- No model-aware rejection after vocabulary validation. Codex and Claude may clamp/reject a vocabulary-valid level based on the active model, organization cap, provider, entitlement, or runtime version.
- No change to `plan_mode_reasoning_effort`; `--codex-effort` controls only `model_reasoning_effort`.
- No Codex advisor flag or invented equivalent. `review_model`, `/review`, auto-review, and multi-agent orchestration are separate features.
- No alias/ID addition, removal, reordering, or model-resolution behavior change in `SoT/models.json`.
- No change to the existing `model ...` standalone command or its Claude `default` account-default semantics.
- No dependency upgrade, `trustedDependencies` entry, `bun pm trust` instruction/execution, or Effect runtime-layer replacement. The consumer probe shows the current pinned production graph works with the known script blocked.
- No runtime lookup of package metadata and no committed `cli/dist/` artifact; compiled binaries consume the generation-time constant and the build output remains ignored verification material.
- No deployed `~/.claude`/`~/.codex` edits outside disposable test homes and read-only/dry-run probes.
- No push, release, live-system mutation, or unrelated docs cleanup.

## Known gotchas

- Codex docs lag current source: retain both official URLs in docs/plan evidence and state why the eight named values win. Do not copy the stale five-value config-reference enum into the validator.
- Current Codex source intentionally accepts future custom non-empty effort strings, but this user explicitly requested exact enum validation and catalog discoverability. Future upstream levels require a researched catalog update rather than pass-through.
- `ultra` is vocabulary-valid but not supported by every model (the current GPT-5.6 Luna catalog stops at `max`). The modifier should write the value, not pretend every selected model supports it.
- Claude `max` and `ultracode` are session-only and must not enter the persisted `effortLevel` catalog.
- The public Effect CLI consumes options before EngineNative. A raw-parser-only implementation would leave bare flags or valued forwarding broken on the shipped `docks-kit sync` surface.
- Default merge preserves keys absent from SoT. Flag-less advisor-off migration must use the removed manifest, while any explicit advisor state must exclude `advisorModel` from that pass and let the later modifier own one set/delete action; mixing both owners duplicates dry-run output and can churn the restart trigger.
- Fable is now the base model, so old `--claude-model=fable` replay cases become no-ops and stop testing restart-trigger behavior; switch those cases to Opus.
- `codexToml.ts` is line-based to preserve comments and tables. Reuse `replaceTopLevelSettingInFile`; do not introduce a TOML formatter.
- Golden files store normalized outputs and HOME-tree hashes, so a broad generated diff is not self-justifying. Inspect labels and both canaries explicitly.
- Any SoT authoring change without payload regeneration makes packaged CLI behavior differ from the checkout.
- `package.json` is the authoring input to version generation, not a runtime version-discovery mechanism. The payload test's disposable root must copy it before the generator can validate/emit the version; baseline package-root/display/update probes are separate and remain untouched.
- The current tarball probe shows `esbuild` does not enter a production install; it comes from dev-only Vitest/Vite. `msgpackr-extract` is production but is on Bun `1.3.14`'s default-trusted list. Only `@parcel/watcher` is reported blocked, and its install script builds only under an explicit source-build environment variable.
- Do not “fix” the warning by trusting all scripts. Bun documents lifecycle scripts as arbitrary code, and the supported default install does not require this one to run.
- The bun-shim assertion is intentionally coupled to pinned Bun `1.3.14` and dependency `@parcel/watcher@2.5.6`; re-probe before updating either literal.

## Global constraints

> Do NOT implement until an explicit go-ahead message.

> SoT/ is authoring-only — any SoT edit requires regenerating cli/src/generated/sotPayload.ts (bun cli/scripts/generate-sot-payload.ts) and --check green; golden suites will change (bun run golden:dryrun / golden:mutation) — the plan must carry an explicit golden ledger (enumerate labels expected to change; the rtk-init-failure and comma-plugin parse-abort canaries must stay byte-identical); gates per slice: bunx tsc --noEmit -p cli, bun run test:unit, both goldens, both --prove-red legs (exit 1, 'prove-red OK'), payload --check, and docs updated.

- Work only on `codex/sync-effort-defaults`; never commit to the default branch and never push.
- Never modify live/production systems. Read-only probes are allowed; test mutations use disposable fixture homes.
- Ask the orchestrator before any destructive or irreversible operation.
- Research current official documentation before changing an unverified API/config key; official docs and current upstream primary source outrank local skill notes.
- Read every file before editing it, preserve unrelated user changes, trace definitions/usages, and keep the implementation surgical.
- Do not hand-edit generated payload or golden JSON. Generate each from its source and inspect the result.
- After each implementation slice (Steps 1-6), regenerate any affected payload/goldens and run the mandatory gate: `bunx tsc --noEmit -p cli`, `bun run test:unit`, `bun cli/scripts/generate-sot-payload.ts --check`, both normal goldens, and both prove-red legs with exit `1` plus their `prove-red OK:` marker. Keep docs current in the slice that changes a user-visible contract. Step 8 repeats the same full gate plus compiled-version and isolated-consumer-install proofs as the final handoff.

## STOP conditions

- No explicit implementation go-ahead has arrived from session `11ad59fa-3bf5-4aef-b13f-d6fbefdb2dfc` over the relay bus.
- Branch is not `codex/sync-effort-defaults`, the worktree contains overlapping unexpected edits, or the drift check shows an in-scope change after `planned_at_commit` that this plan does not cover.
- Current official Claude docs no longer document `effortLevel` or `advisorModel`, or current upstream Codex source no longer recognizes the planned named levels. Re-research and amend the plan instead of guessing.
- Enabling advisor cannot be implemented by `advisorModel: fable` after removal without touching `settings.local.json` or weakening the additive-merge contract.
- The generated version would require a runtime `package.json` read, generator `--check` cannot detect a package-only drift, or a compiled current-target binary reports a value different from root package metadata.
- A clean pinned-Bun consumer install blocks anything other than the single expected `@parcel/watcher@2.5.6` source-build script, or any installed-CLI smoke fails while it remains blocked. Re-audit the graph; do not add trust automatically.
- Any modification reaches the real deployed config, a production system, or an unapproved destructive operation.
- The payload generator or typecheck fails three times on the same diagnosis; reassess rather than loop.
- Either byte-identical canary changes. Stop golden regeneration and identify the unintended pre-settings/parser behavior change.
- A golden update changes unrelated plugin/toolchain argv, rules, skills, runtime assets, or non-feature output.
- A required gate cannot run in this checkout. Record the exact command/error and report the blocker rather than claiming completion.

## Cold-handoff checklist

- [x] Goal, the four founding requirements, and both relay refinements are present verbatim, with the later Claude-high decision explicitly superseding the original both-xhigh sentence.
- [x] Branch, baseline commit, runtime, drift command, generators, and test commands are explicit.
- [x] Exact flag grammar, upstream enums, pseudo-values, keys, target warnings, exit codes, application order, and default mappings are defined.
- [x] Exact file manifest includes source, SoT, generated payload/version, tests/goldens, consumer-install CI, and docs.
- [x] Every step has dependencies, a verifiable done-condition, and a revert/stop trigger.
- [x] Acceptance criteria are executable and include both normal/prove-red gates, generated-version drift, current-target compiled version, and isolated blocked-script consumer smokes.
- [x] Golden ledger names expected changes, new cases, replay rename, and byte-identical canaries.
- [x] Out-of-scope boundaries prevent standalone modes, Codex advisor invention, plan-effort changes, live config mutation, push, and alias churn.
- [x] Known gotchas explain documentation drift, model-dependent support, public/native parser layering, additive removal, TOML stability, generated version/payload coupling, and pinned-Bun lifecycle-script behavior.
- [x] Advisor and Codex effort research produced decisions; no user choice remains unresolved.
- [x] A cold executor can implement from this file without needing the founding conversation.

## Self-review

Score: 98/100 · trajectory 83→91→96→98 · stopped: plateau (K=3).

Weighted breakdown: standalone executability 21/22; actionability 13/13; dependency order 10/10; evidence re-verify 11/12; goal coverage 14/14; executable acceptance 14/14; failure mode 9/9; assumption→question 6/6.

- Pass 1 incorporated the superseding Claude-high default and isolated version/install work into separate steps; the first rescore exposed missing compiled-version and consumer-prefix proofs.
- Pass 2 traced version generation through the full-module `--check` seam, added disposable package-drift/public/compiled acceptance, and ensured CLI version discovery is generation-only at runtime.
- Pass 3 reproduced a real tarball production install: eliminated `esbuild` as dev-only, distinguished default-trusted `msgpackr-extract`, identified only blocked `@parcel/watcher`, and rejected dependency/runtime-layer churn in favor of exact docs plus a pinned bun-shim assertion.
- Pass 4 updated every Claude default mapping, golden-settings consequence, per-slice gate, STOP condition, and file/source manifest; the adversarial cold-read found no unresolved decision and no justified `## Open questions`.
- The two deducted points are bounded: one standalone point for semantic generated/golden-diff inspection after executable guards pass, and one evidence point because the exact Windows blocked-script assertion can only be executed by the specified Windows CI job rather than this Linux planning host.

## Review

- **Goal met:** yes — every `[x]` acceptance criterion verified (first-hand this turn or via reproduced cross-check); scope audit PASS (all 32 changed files in `671831c..06fc1eb` equal `affected_paths`, no drift); `SoT/.claude/settings.json` is `model: fable` / `effortLevel: high` / no `advisorModel`, `SoT/.codex/config.toml` keeps both effort keys at `xhigh`; the two cross-check findings on `5931e2c` are both resolved at HEAD `06fc1eb`.
- **Regressions:** none — `git diff --check 671831c..HEAD` exit 0; the rtk-init-failure and comma-plugin parse-abort canaries stay byte-identical (golden:mutation OK 70); `SoT/models.json` alias IDs byte-identical, only the two planned Opus/Fable note edits.
- **CI:** pass — `bunx tsc --noEmit -p cli` 0; `generate-sot-payload --check` 0; `golden:dryrun` OK 25; `golden:mutation` OK 70; both `--prove-red` legs exit 1 with `prove-red OK:` markers. `bun run test:unit` 113/114 — the sole non-pass is the load-flaky direct-Bun statusline p95 wall-clock benchmark (170/135ms under parallel load; passes 18/18 in isolation), not counted per plan. Compiled-binary and consumer-install legs verified at source (`--version` → 0.4.0) plus statically by the cross-check; the Windows bun-shim blocked-`@parcel/watcher` assertion (workflow text present and matching the contract) is deferred-to-CI (GitHub Windows runner only).
- **Cross-check:** Cross-check (2026-07-10): [codex gpt-5.6-sol xhigh] 2 findings on 5931e2c (1 med empty-value rejection, 1 low grammar duplication) — 2 accepted, 0 rejected; both fixed in 06fc1eb, same reviewer re-verified READY (0 findings); [claude] independently verified findings 1–2 resolved at HEAD (empty-effort probe exits 2 catalog-first `Invalid Claude effort ''`; bare/error grammar derives from `cli/src/efforts.ts`).
- **Follow-ups:** none
- Filed by: plan-review on 2026-07-10T16:47:10-03:00

## Sources

### Repository evidence opened 2026-07-10

- `cli/src/engine-native/parseArgs.ts:40-50` — sync help groups the existing model flags as deployed-config-only modifiers.
- `cli/src/engine-native/parseArgs.ts:111-118` — bare model flags print a catalog and exit `2` with a value-required error.
- `cli/src/engine-native/parseArgs.ts:161-176` — valued modifier parsing happens in EngineNative's raw argv layer.
- `cli/src/engine-native/parseArgs.ts:187-207` — model validation owns target-ignore warnings and clears ignored values.
- `cli/src/commands/sync.ts:84-104` — the public Effect CLI declares the existing optional model options.
- `cli/src/commands/sync.ts:124-152` — public bare-model diagnostics and normalized forwarding must be mirrored for effort/advisor.
- `cli/src/engine-native/index.ts:20-75` — `Ctx` carries all deploy-time modifier state and restart triggers.
- `cli/src/engine-native/index.ts:79-89` — validation precedes Claude/Codex sync dispatch.
- `cli/src/engine-native/claudeSync.ts:35-81` — Claude commits the base settings, then runs removals and modifiers in a load-bearing order.
- `cli/src/engine-native/claudeSync.ts:487-505` — baseline removed settings keys are the migration mechanism for formerly kit-owned keys.
- `cli/src/engine-native/claudeSync.ts:540-599` — removal is idempotent, dry-run-aware, and runs before modifiers.
- `cli/src/engine-native/claudeModel.ts:11-54` — existing Claude model mutation is atomic and already carries dry-run/no-op/restart semantics.
- `cli/src/engine-native/codexSync.ts:15-29` — Codex applies the model modifier immediately after its base config merge.
- `cli/src/engine-native/codexToml.ts:12-48` — the generic top-level setting replacement preserves line-oriented TOML behavior.
- `cli/src/engine-native/codexToml.ts:51-74` — Codex model modifier supplies the pattern for effort dry-run/no-op/restart output.
- `SoT/.claude/settings.json:1-7` — baseline before implementation had `model: opus`, `advisorModel: fable`, and `effortLevel: xhigh`; Steps 2/4 deliberately replace that state.
- `SoT/.codex/config.toml:1-4` — Codex's SoT model and both effort defaults are top-level; both effort defaults are `xhigh`.
- `SoT/models.json:3-16` — Claude alias/ID catalog is independent from the settings default; the baseline notes alone called Opus the default/advisor pair.
- `cli/src/manifests.ts:8-25` and `cli/src/engine-native/models.ts:17-52` — current model catalogs have shared typed/public and native render paths, motivating one shared effort catalog.
- `cli/test/golden-dryrun.ts:38-50` — dry-run matrix and the existing combined Claude modifier row.
- `cli/test/golden-mutation.ts:79-142` — mutation rows, abort canaries, and model-only replay that must switch from Fable to Opus.
- `cli/test/golden-mutation.ts:240-366` — direct invariants already test channel purity and public flag forwarding.
- `cli/test/lib/harness.ts:420-443` — golden update/prove-red arguments and label filtering contract.
- `.github/workflows/parity.yml:51-89` — CI requires unit, both goldens, and both prove-red markers.
- `cli/scripts/generate-sot-payload.ts:5-19` and `cli/scripts/generate-sot-payload.ts:114-163` — SoT paths are embedded and `--check` detects stale generated payload.
- `CLAUDE.md:334-345` — removed manifest is the documented exception for deprecated kit-owned settings keys.
- `cli/src/main.ts:1-4` and `cli/src/main.ts:60-74` — the public CLI needs the Bun platform layer and currently passes the incorrect hard-coded `0.1.0` to `Command.run`.
- `package.json:1-4` and `package.json:30-40` — package metadata is `0.4.0`; the production Effect dependencies are distinct from the Vitest/Vite dev graph.
- `cli/scripts/generate-sot-payload.ts:24-65` — the generated module is one deterministic template, so package version can be emitted in the same byte-compared output.
- `cli/scripts/generate-sot-payload.ts:67-89` — the launcher Bun pin is read from an authoring manifest and inserted at generation time, the required precedent for package version.
- `cli/build-binaries.sh:1-20` — the build accepts a single `linux-x64` target and compiles `main.ts`, so the ignored current-target artifact is the direct embedded-version smoke.
- `cli/test/unit/payload.test.ts:16-27` and `cli/test/unit/payload.test.ts:55-79` — disposable generator roots currently omit `package.json`; existing stale-output tests establish the version-drift test pattern.
- `.github/workflows/windows-entrypoints.yml:147-202` — bun-shim already packs/installs the consumer tarball and functionally exercises the global CLI, but does not assert which lifecycle script was blocked.
- `bun.lock:5-16` and `bun.lock:28-33` — the locked production chain is `@effect/platform-bun → @effect/platform-node-shared → @parcel/watcher`; `@effect/platform` also pulls production `msgpackr`.
- `bun.lock:278` and `bun.lock:364` — `esbuild` belongs to the Vite/Vitest development chain and did not appear in the isolated production install.
- `node_modules/@effect/platform-bun/package.json:13-22` and `node_modules/@effect/platform-node-shared/package.json:13-23` — resolved package manifests confirm the unconditional watcher transitive behind the imported Bun layer.
- `node_modules/@parcel/watcher/package.json:31-35` and `node_modules/@parcel/watcher/scripts/build-from-source.js:3-11` — the reported install command only builds when `npm_config_build_from_source=true`.
- Isolated read-only consumer probe, pinned Bun `1.3.14`: local tarball install printed `Blocked 1 postinstall`; `bun pm -g untrusted` named only `@parcel/watcher @2.5.6`; `bun pm -g ls --all` had no `esbuild`; installed `--version`, `models claude`, and `toolchain check` all exited `0`.

### Current official/primary sources checked 2026-07-10

- https://code.claude.com/docs/en/model-config#adjust-effort-level — persisted `effortLevel` accepts `low|medium|high|xhigh`; `max` and `ultracode` are session-only.
- https://code.claude.com/docs/en/settings#available-settings — `advisorModel` is a documented settings key and unsetting it disables advisor.
- https://code.claude.com/docs/en/advisor#turn-the-advisor-off — `/advisor off` clears `advisorModel`; `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` is a different global disable mechanism.
- https://code.claude.com/docs/en/advisor#choose-an-advisor-model — Fable main accepts Fable advisor, so `on → fable` is a valid default pairing.
- https://learn.chatgpt.com/docs/config-file/config-reference#configtoml — documents `model_reasoning_effort` but currently shows the stale five-value set; the same complete key table has `review_model` but no `advisor*` key.
- https://learn.chatgpt.com/docs/agent-configuration/subagents#reasoning-effort-model_reasoning_effort — current official Codex guide names `none|minimal|low|medium|high|xhigh|max|ultra`, model-dependent.
- https://github.com/openai/codex/blob/2b9c05046038c038ec6bddb9db7d11394995372d/codex-rs/protocol/src/openai_models.rs#L29-L82 — current upstream parser names all eight values and accepts future non-empty custom strings.
- Local read-only runtime corroboration: Codex `0.144.1` loaded `ultra`, `max`, and `none` under `--strict-config doctor --summary`; `~/.codex/models_cache.json` advertised current GPT-5.6 model-specific subsets. This corroborates but does not replace the official sources above.
- https://bun.sh/docs/pm/lifecycle — Bun blocks arbitrary lifecycle scripts by default because they can execute arbitrary shell commands; trust is an explicit allowlist decision.
- https://bun.sh/docs/pm/cli/pm#untrusted — `bun pm untrusted` is the official inspection surface for dependencies whose scripts were blocked; `bun pm default-trusted` exposes Bun's built-in list.
- https://bun.sh/docs/pm/cli/install#omitting-dependencies — transitive installs omit dependencies' devDependencies, matching the consumer probe's absence of Vitest/Vite/esbuild.
- https://github.com/parcel-bundler/watcher — upstream source/repository for the resolved `@parcel/watcher` package; the pinned installed source above is the exact version-level evidence for its guarded build fallback.
