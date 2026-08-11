---
title: Migrate the CLI to Effect v4 beta
goal: Migrate the existing Effect rim to one exact Effect 4 beta graph while preserving every CLI contract except the owner-accepted native help rendering and one class of invalid-input error rendering.
status: finished
created: "2026-08-10T17:52:54-03:00"
updated: "2026-08-11T18:55:00-03:00"
started_at: "2026-08-10T12:05:00-03:00"
finished_at: "2026-08-11T18:55:00-03:00"
assignee: null
review_author_company: anthropic
review_author_tool: claude-code
review_author_model: opus
review_author_effort: high
review_waivers: []
tags:
  - effect
  - effect-v4
  - cli
affected_paths:
  - package.json
  - bun.lock
  - docks-kit
  - cli/src/main.ts
  - cli/src/argv.ts
  - cli/src/engine.ts
  - cli/src/services.ts
  - cli/src/commands/docs.ts
  - cli/src/commands/model.ts
  - cli/src/commands/models.ts
  - cli/src/commands/plugins.ts
  - cli/src/commands/skills.ts
  - cli/src/commands/status.ts
  - cli/src/commands/sync.ts
  - cli/src/commands/toolchain.ts
  - cli/src/commands/update.ts
  - cli/test/lib/goldenExecution.ts
  - cli/docs/overview.md
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/argv.test.ts
  - cli/test/unit/bun.test.ts
  - cli/test/unit/claudeMigration.test.ts
  - cli/test/unit/claudeRuntime.test.ts
  - cli/test/unit/codexRetiredPlugins.test.ts
  - cli/test/unit/deps.test.ts
  - cli/test/unit/efforts.test.ts
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/engine.test.ts
  - cli/test/unit/goldenCli.test.ts
  - cli/test/unit/goldenExecution.test.ts
  - cli/test/unit/kitHome.test.ts
  - cli/test/unit/launcher.test.ts
  - cli/test/unit/logger.test.ts
  - cli/test/unit/modelSyncCharacterization.test.ts
  - cli/test/unit/notify.test.mjs
  - cli/test/unit/payload.test.ts
  - cli/test/unit/pluginRefresh.test.ts
  - cli/test/unit/services.test.ts
  - cli/test/unit/session-start.test.mjs
  - cli/test/unit/settings.test.ts
  - cli/test/unit/skillsSync.test.ts
  - cli/test/unit/statusline.test.mjs
  - cli/test/unit/toolchain.test.ts
  - cli/test/unit/update.test.ts
  - cli/test/unit/workflowRemoval.test.ts
  - vitest.config.ts
  - cli/build-binaries.sh
  - .github/workflows/release-cli.yml
  - cli/scripts/generate-sot-payload.ts
  - cli/src/engine-native/
  - AGENTS.md
  - CLAUDE.md
  - README.md
related_plans: []
review_status: passed
planned_at_commit: ba5fdba7095565a8820f50279be330f3198db138
execution_base_commit: f9838a904262418021381c34b2108e61ba61b609
---

## Goal

Migrate docks-kit's small existing Effect rim from Effect 3 to the exact Effect 4 beta package graph defined below. Preserve every public command's stdout, stderr, and exit code except for the owner-accepted v4 native `--help` rendering and the owner-accepted class of invalid-input error rendering — invalid input that leaves a positional the command's declared arity cannot absorb (exit code preserved; only message bytes differ); record representative rows of that new output in goldens, preserve the generated payload, and prove that source and standalone `--version` output remains the bare package version expected by the `docks-kit` launcher.

Mode: plan-only

## Context & rationale

The repository owner has explicitly decided to migrate on the beta rather than wait for a future release. The migration gate is therefore the continued availability and peer coherence of the exact reviewed pins, especially `4.0.0-beta.107`; a later beta is not an automatic substitute.
> Owner decision (2026-08-10): "v4's native `--help` rendering is ACCEPTED. Help text is exempt from the behavior-preservation rule and its new output is recorded in goldens. `--version` is NOT exempt: it must keep printing the bare version string."


The former five-package assumption was incorrect. `effect@4.0.0-beta.107` consolidates the CLI and platform packages into core: its published `exports` map contains `./unstable/cli`, and its tarball contains declarations for `Argument`, `Command`, `Flag`, `Prompt`, `CliConfig`, `CliError`, `CliOutput`, `Completions`, `GlobalFlag`, `HelpDoc`, `Param`, `Primitive`, and the CLI index under `unstable/cli/`. Neither `@effect/cli` nor `@effect/platform` has a 4.x release or beta dist-tag. This migration removes both packages; the repository has no `@effect/platform` import, so that removal is free.

The original goal's skill-install half is already satisfied by the enabled `effect-kit@docks` plugin. It supplies the `effect-v4` skill alongside the Effect 3-specific `effect-ts-setup`, `effect-ts-port`, and `effect-ts-specialist` skills. `SoT/.claude/settings.json` already enables that plugin, while `SoT/.agents/skills.txt` is intentionally empty and remains unchanged. No universal-skill installation or manifest-parser work belongs in this plan. Plugin-internal skill content belongs in `DocksDocks/docks`, not this repository.

The `effect-v4` skill is adapted from Kit Langton's upstream commit `30dee8607214c893dd89f6eee65c669ef3dce8c9`, but its routing text explicitly says v3-to-v4 migration is outside its scope. Use it for v4 conventions only. During the migration, verify every moving or unstable API against the installed `4.0.0-beta.107` declarations and the official sources cited below.

The Effect rim is small: three CLI-root/service files, nine command modules, and three Effect-bearing unit-test files. The 19 TypeScript modules under `cli/src/engine-native/` contain zero Effect imports and are explicitly excluded. The migration changes the typed shell around EngineNative, not EngineNative behavior.

## Environment & how-to-run

- Run every command from the repository root on branch `main` with Bun and the exact `bun.lock`.
- Current pins are `effect@3.21.4`, `@effect/cli@0.75.2`, `@effect/platform@0.96.1`, `@effect/platform-bun@0.90.0`, `@effect/vitest@0.29.0`, and `vitest@3.2.7`.
- `cli/tsconfig.json` targets `ES2022`, uses `module: Preserve` and `moduleResolution: bundler`, and enables `strict`, `noEmit`, and `skipLibCheck`. There is no root `tsconfig.json`; `package.json` pins TypeScript `7.0.2`.
- `effect@4.0.0-beta.107/package.json` declares neither a TypeScript peer dependency nor a TypeScript engine requirement, so Effect v4 imposes no higher package-declared TypeScript floor than this repository's TypeScript `7.0.2`. The authoritative compatibility proof remains `bun run typecheck` against the installed declarations.
- Before editing dependencies, extend `cli/test/golden-dryrun.ts` with `public: true` characterization rows for root, `--help`, `--version`, `docs`, `models`, `plugins list`, `skills list`, and `update --help`; record those rows and run the current full gate and both positive golden suites.
- After the dependency swap, inspect the installed exact declarations exported by `effect/unstable/cli`, `@effect/platform-bun`, and `@effect/vitest` before adapting code. Do not infer a beta API from memory or a mutable dist-tag.
- The full gate is `bun run test:ci`; it runs `check:generated`, `typecheck`, `test:unit`, `cli/test/statusline-runtime-smoke.mjs posix`, `golden:dryrun`, and `golden:mutation` in that order.
- Both golden suites support `--prove-red`, which must print its prove-red marker and exit non-zero. `--update-goldens` is used before the dependency edit to record the new public characterization rows and after migration only to accept v4's native help rendering; all non-help cases remain behavior-preserving.

## Steps

| # | Task | Files | Depends | Status | Done condition |
|---:|---|---|---|---|---|
| 1 | Characterize the current public CLI before any dependency edit. Add `public: true` dry-run rows for root (`[]`), `--help`, `--version`, `docs`, `models`, `plugins list`, `skills list`, and `update --help`; record their stdout, stderr, and exit codes alongside the existing native-raw matrix. Run the full gate and both positive goldens and record package and golden checksums. | `package.json`; `bun.lock`; `cli/src/main.ts`; `cli/src/engine.ts`; `cli/src/services.ts`; `cli/src/commands/docs.ts`; `cli/src/commands/model.ts`; `cli/src/commands/models.ts`; `cli/src/commands/plugins.ts`; `cli/src/commands/skills.ts`; `cli/src/commands/status.ts`; `cli/src/commands/sync.ts`; `cli/src/commands/toolchain.ts`; `cli/src/commands/update.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json` | none | done | Before the dependency edit, the dry-run matrix contains all eight named `public: true` rows, `bun run golden:dryrun`, `bun run golden:mutation`, and `bun run test:ci` exit 0, and the new baseline outputs and SHA-256 checksums are recorded. |
| 2 | Upgrade Vitest from `3.2.7` to exact `4.1.10` as the explicit prerequisite for `@effect/vitest@4`; regenerate only the lockfile dependency graph and run the entire unit suite rather than two files. This interim graph is knowingly peer-incoherent because installed `@effect/vitest@0.29.0` peers on `vitest ^3.2.0`; until step 3 lands, only the documented `cli/test/unit/settings.test.ts` failure is accepted. | `package.json`; `bun.lock`; `cli/test/unit/`; `vitest.config.ts` | 1 | done | `bunx vitest --version` identifies `4.1.10` and `bun run test:unit` exercises the whole configured unit suite; before step 3, the only permitted red is the recorded `settings.test.ts` peer-incoherence failure and every other unit file passes. |
| 3 | Replace the Effect dependency graph with the exact reviewed beta set: pin `effect`, `@effect/platform-bun`, and `@effect/vitest` to `4.0.0-beta.107`; remove `@effect/cli` and `@effect/platform`; retain exact `vitest@4.1.10`; and regenerate `bun.lock` without choosing a newer beta. | `package.json`; `bun.lock` | 2 | done | A frozen install succeeds; the installed tree contains the three exact Effect beta packages and exact Vitest pin, contains no Effect 3 package, and contains neither `@effect/cli` nor `@effect/platform`. |
| 4 | Repoint the source launcher's dependency-repair sentinel from the removed `node_modules/@effect/cli` directory to `node_modules/effect`, and update the launcher fixture to create the surviving sentinel. Change no other launcher behavior. | `docks-kit`; `cli/test/unit/launcher.test.ts` | 3 | done | `bun vitest run cli/test/unit/launcher.test.ts` exits 0, and after one source-mode `./docks-kit --version` warms the checkout, a second invocation exits 0 with empty stderr instead of running another frozen install. |
| 5 | Migrate the three service tags from `Context.Tag` class syntax to `Context.Service<Self, Shape>()(id)` while retaining every service identifier, implementation shape, live/test layer, and `EngineServicesLive` composition. | `cli/src/services.ts`; `cli/test/unit/services.test.ts` | 3 | done | `bun vitest run cli/test/unit/services.test.ts` exits 0 and the test still proves the live and injected service contracts. |
| 6 | Migrate root runtime wiring: import CLI symbols from `effect/unstable/cli`, replace `BunContext.layer` with `BunServices.layer`, choose `Command.runWith` because `main.ts` injects normalized arguments, configure it with `{ version: GENERATED_PACKAGE_VERSION }`, and retain `BunRuntime.runMain`, the native-raw bypass, root command metadata, subcommand order, and one merged application layer. | `cli/src/main.ts`; `cli/src/services.ts` | 5 | done | `cli/src/main.ts` calls `Command.runWith(root, { version: GENERATED_PACKAGE_VERSION })(argv.slice(2))`, obtains the command name from `Command.make("docks-kit")`, has no `@effect/cli` or `BunContext` reference, and preserves native-raw handling plus argv normalization. |
| 7 | Preserve the non-exempt version contract by providing a `CliOutput` layer in the merged application layer: derive from the default formatter, override only `formatVersion` to return the bare version argument, and leave native v4 help formatting intact. | `cli/src/main.ts`; `cli/test/golden-dryrun.ts`; `cli/test/goldens/dryrun.json` | 6 | done | The public `--version` golden remains the bare `package.json.version`, `bun run typecheck` exits 0, and A9 proves the compiled binary has the same bare output. |
| 8 | Migrate all nine command modules from `@effect/cli` to `effect/unstable/cli`: rename `Args` to `Argument`, `Options` to `Flag`, and text/boolean constructors according to the exact declaration mapping below; retain `Prompt`, `Command.make`, `Command.withDescription`, every option/argument name, default, validation rule, handler, output channel, and exit path. Verify the new built-in `-v` precedence against the local `--verbose` aliases in `sync`, `model`, and `toolchain`; if the global version action wins, provide a `CliConfig` built-in set whose version action has no `-v` alias so the local aliases remain authoritative. | `cli/src/commands/docs.ts`; `cli/src/commands/model.ts`; `cli/src/commands/models.ts`; `cli/src/commands/plugins.ts`; `cli/src/commands/skills.ts`; `cli/src/commands/status.ts`; `cli/src/commands/sync.ts`; `cli/src/commands/toolchain.ts`; `cli/src/commands/update.ts`; `cli/src/main.ts`; `cli/src/engine.ts`; `cli/test/golden-mutation.ts` | 7 | done | `bun run typecheck` exits 0; every public characterization row from step 1 still passes except the accepted help rows; and the existing public invariants for `sync -v`, `model claude default -v`, and `toolchain ensure effect-solutions -v` still prove verbose behavior rather than version output. |
| 9 | Adapt the Effect-aware tests to `@effect/vitest@4` and migrated service/runtime types without weakening assertions; keep `it.effect` where it defines an observable Effect contract. Run the full unit suite and both positive goldens. Update only the new `--help` and `update --help` rows to record v4's accepted native rendering; preserve every non-help public row and existing native/mutation case. | `cli/test/unit/`; `vitest.config.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json` | 8 | done | `bun run test:unit`, `bun run golden:dryrun`, and `bun run golden:mutation` exit 0; only help-row bytes differ from the step 1 characterization, while root, `--version`, `docs`, `models`, `plugins list`, `skills list`, all mutation cases, and all other dry-run cases preserve their recorded outputs. |
| 10 | Update repository guidance for the completed dependency graph and skill routing. State that Effect 4 work in this checkout routes to `effect-v4` from the already-enabled `effect-kit@docks` plugin; the sibling setup, port, and specialist skills target Effect 3; migration APIs come from installed declarations; and no universal-skill manifest entry is needed. | `AGENTS.md`; `CLAUDE.md`; `README.md` | 9 | done | All three files describe the exact beta graph, `AGENTS.md` and `CLAUDE.md` route this checkout to `effect-v4`, and none instructs installation of a separate upstream skill. |
| 11 | Build the standalone Linux x64 binary through the repository build script and exercise its version path. Confirm the generated-payload precheck runs before compilation and the binary version exactly matches `package.json`, preserving the launcher's mismatch guard. | `cli/build-binaries.sh`; `.github/workflows/release-cli.yml`; `docks-kit`; `cli/src/main.ts`; `package.json`; `cli/scripts/generate-sot-payload.ts` | 10 | done | `bash cli/build-binaries.sh linux-x64` exits 0 and `./cli/dist/docks-kit-linux-x64 --version` equals `package.json.version`. |
| 12 | Run the ordered acceptance inventory, generated-payload check, full CI gate, and both prove-red paths; inspect the final lock tree and diff for exact pins, only accepted help-golden changes, no EngineNative edits, and no unrelated dependency churn. | `package.json`; `bun.lock`; `docks-kit`; `cli/scripts/generate-sot-payload.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json`; `cli/src/engine-native/` | 1-11 | done | A1-A10 satisfy their expected outcomes, only the characterized help rows changed, and no path under `cli/src/engine-native/` is modified. |

## Interfaces & data shapes

### Exact dependency graph

| Package | Now | After | Note |
|---|---|---|---|
| `effect` | `3.21.4` | `4.0.0-beta.107` | Provides `effect/unstable/cli`. |
| `@effect/cli` | `0.75.2` | removed | No 4.x exists; folded into core. |
| `@effect/platform` | `0.96.1` | removed | No 4.x exists; unused by this repository. |
| `@effect/platform-bun` | `0.90.0` | `4.0.0-beta.107` | Peer `effect ^4.0.0-beta.107`. |
| `@effect/vitest` | `0.29.0` | `4.0.0-beta.107` | Peers `effect ^4.0.0-beta.107` and `vitest >=4.1.0 <5.0.0`. |
| `vitest` | `3.2.7` | `4.1.10` | Exact reviewed pin satisfying the forced Vitest 4 peer range. |

The gate accepts only these exact after-values. Every version must still resolve from npm, `@effect/platform-bun` and `@effect/vitest` must accept the exact Effect beta through their declared peers, and `@effect/vitest` must accept exact `vitest@4.1.10`. A moved `beta` dist-tag is informational; it never changes the pin. `@effect/cli` and `@effect/platform` must be absent from both `package.json` and `bun.lock`.

### API mapping

| Effect 3 surface | Effect 4 surface | Required implementation detail | Official source |
|---|---|---|---|
| `Context.Tag` class syntax | `Context.Service<Self, Shape>()(id)` | Preserve the three existing IDs and shapes: `docks-kit/Logger`, `docks-kit/DependencyManager`, and `docks-kit/Platform`. | https://github.com/Effect-TS/effect/blob/main/migration/services.md |
| `@effect/cli` `Args` | `effect/unstable/cli` `Argument` | Rename `Args.text` to `Argument.string`; preserve argument names and optionality. | https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/Argument.d.ts |
| `@effect/cli` `Options` | `effect/unstable/cli` `Flag` | Rename `Options.boolean` to `Flag.boolean` and `Options.text` to `Flag.string`; preserve flag names, defaults, repeatability, and validation. | https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/Flag.d.ts |
| `Command.make`, `Command.withDescription`, `Command.run` | `Command.make`, `Command.withDescription`, `Command.runWith` | Use `runWith` because `main.ts` supplies normalized argv: `Command.runWith(root, { version: GENERATED_PACKAGE_VERSION })(argv.slice(2))`. The config has no `name`; `Command.make("docks-kit")` owns it. | https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/Command.d.ts |
| Default version formatting | Custom `CliOutput` layer | Derive from `CliOutput.defaultFormatter()` and override only `formatVersion: (_name, version) => version`; the v4 default is `name vversion`, which would fail the launcher's exact version comparison. | https://unpkg.com/effect@4.0.0-beta.107/src/unstable/cli/CliOutput.ts and https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/CliOutput.d.ts |
| v4 built-in `--version` / `-v` | Local `--verbose` / `-v` on `sync`, `model`, and `toolchain` | Verify local precedence. If the prepended global wins, provide a `CliConfig` built-in set with a long-only version action, retaining `--version` while freeing `-v` for the local flags. | https://unpkg.com/effect@4.0.0-beta.107/src/unstable/cli/GlobalFlag.ts and https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/CliConfig.d.ts |
| `BunContext.layer`, `BunRuntime.runMain` | `BunServices.layer`, `BunRuntime.runMain` | `BunContext` is absent from `@effect/platform-bun@4.0.0-beta.107`; its declaration URL returns HTTP 404. `runMain` retains `(effect, options?)` and `(options?)(effect)` overloads; options are `disableErrorReporting` and `teardown`. | https://unpkg.com/@effect/platform-bun@4.0.0-beta.107/dist/BunContext.d.ts (HTTP 404), https://unpkg.com/@effect/platform-bun@4.0.0-beta.107/dist/BunServices.d.ts, and https://unpkg.com/@effect/platform-bun@4.0.0-beta.107/dist/BunRuntime.d.ts |
| `@effect/vitest@0.29` test exports | `@effect/vitest@4` re-exports `* from vitest` and supplies Effect-aware `it` | Keep `describe`, `expect`, and `it` imports in `settings.test.ts`; retain `.effect`, and use `.layer` or `.live` only where the existing test contract requires them. | https://unpkg.com/@effect/vitest@4.0.0-beta.107/dist/index.d.ts |
| `Effect.gen`, `Effect.sync`, `Effect.andThen`, `Console.log`, `Console.error`, `Layer`, `Option` | Same core shapes | Preserve existing control flow and output channels; do not rewrite retained APIs for style. | https://github.com/Effect-TS/effect/blob/main/MIGRATION.md |

### Per-file Effect symbol inventory

| Repository surface | Current symbols | Migration treatment |
|---|---|---|
| `cli/src/main.ts` | `Command` from `@effect/cli`; `BunContext`, `BunRuntime` from `@effect/platform-bun`; `Console`, `Effect`, `Layer` | Move `Command`, `CliConfig`, `CliOutput`, and any custom global-version action to `effect/unstable/cli`; replace `BunContext` with `BunServices`; retain the core symbols and `BunRuntime`; pass `argv.slice(2)` to `runWith`. |
| `cli/src/engine.ts` | `Console`, `Effect` | Retain unchanged unless installed declarations require a type-only adjustment; public engine semantics cannot change. |
| `cli/src/services.ts` | `Context`, `Layer` | Migrate the three service classes to `Context.Service`; retain layer constructors and shapes. |
| `cli/src/commands/docs.ts` | `Args`, `Command`, `Options`; `Console`, `Effect`, `Option` | Use `Argument`, `Command`, `Flag`; retain core symbols. |
| `cli/src/commands/model.ts` | `Args`, `Command`, `Options`, `Prompt`; `Effect`, `Option` | Use `Argument`, `Command`, `Flag`, `Prompt`; retain core symbols. |
| `cli/src/commands/models.ts` | `Args`, `Command`, `Options`; `Console`, `Effect`, `Option` | Use `Argument`, `Command`, `Flag`; retain core symbols. |
| `cli/src/commands/plugins.ts` | `Args`, `Command`, `Options`; `Console`, `Effect`, `Option` | Use `Argument`, `Command`, `Flag`; retain core symbols. |
| `cli/src/commands/skills.ts` | `Args`, `Command`, `Options`; `Console`, `Effect`, `Option` | Use `Argument`, `Command`, `Flag`; retain core symbols. |
| `cli/src/commands/status.ts` | `Command`, `Options`; `Console`, `Effect` | Use `Command`, `Flag`; retain core symbols. |
| `cli/src/commands/sync.ts` | `Args`, `Command`, `Options`; `Effect`, `Option` | Use `Argument`, `Command`, `Flag`; retain core symbols. |
| `cli/src/commands/toolchain.ts` | `Args`, `Command`, `Options`; `Effect`, `Option` | Use `Argument`, `Command`, `Flag`; retain core symbols. |
| `cli/src/commands/update.ts` | `Command`, `Options`; `Console`, `Effect` | Use `Command`, `Flag`; retain core symbols. |
| `cli/test/unit/settings.test.ts` | `describe`, `expect`, `it` from `@effect/vitest`; `Effect`; `it.effect` | Retain the Effect-aware test shape under exact `@effect/vitest@4.0.0-beta.107`. |
| `cli/test/unit/engine.test.ts` | `Effect` | Retain the core symbol and plain Vitest imports. |
| `cli/test/unit/services.test.ts` | `Effect` | Retain the core symbol and plain Vitest imports; update service typing only where the new declarations require it. |
| `cli/src/engine-native/` | 19 TypeScript modules; zero Effect imports | Forbidden migration surface. Do not add Effect imports or alter behavior. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `test "$(npm view effect@4.0.0-beta.107 version)" = "4.0.0-beta.107" && test "$(npm view @effect/platform-bun@4.0.0-beta.107 version)" = "4.0.0-beta.107" && test "$(npm view @effect/vitest@4.0.0-beta.107 version)" = "4.0.0-beta.107" && test "$(npm view vitest@4.1.10 version)" = "4.1.10" && test "$(npm view @effect/platform-bun@4.0.0-beta.107 peerDependencies.effect)" = "^4.0.0-beta.107" && test "$(npm view @effect/vitest@4.0.0-beta.107 peerDependencies.effect)" = "^4.0.0-beta.107" && test "$(npm view @effect/vitest@4.0.0-beta.107 peerDependencies.vitest)" = ">=4.1.0 <5.0.0"` | Exits 0; every exact pin still resolves and the reviewed peers remain coherent. |
| A2 | `bun install --frozen-lockfile && tree="$(bun pm ls --all)" && printf '%s\n' "$tree" && [[ "$tree" == *"effect@4.0.0-beta.107"* ]] && [[ "$tree" == *"@effect/platform-bun@4.0.0-beta.107"* ]] && [[ "$tree" == *"@effect/vitest@4.0.0-beta.107"* ]] && [[ "$tree" == *"vitest@4.1.10"* ]] && [[ "$tree" != *"effect@3."* ]] && [[ "$tree" != *"@effect/cli@"* ]] && [[ "$tree" != *"@effect/platform@"* ]]` | Exits 0; the frozen lock installs one Effect 4 graph, no Effect 3 package, and neither removed package. |
| A3 | `bun run typecheck` | Exits 0 with TypeScript `7.0.2` under `cli/tsconfig.json`. |
| A4 | `bun run test:unit` | Exits 0; the complete configured unit suite passes on the coherent Effect 4 and Vitest 4 graph. |
| A5 | `bun cli/scripts/generate-sot-payload.ts --check` | Exits 0; dependency and CLI migration did not stale or alter the generated SoT payload. |
| A6 | `bun run test:ci` | Exits 0 through generated, type, unit, runtime, dry-run golden, and mutation golden gates; the goldens include the accepted native v4 help output and preserve all non-help rows. |
| A7 | `bun run golden:dryrun --prove-red` | Prints `prove-red OK` and exits non-zero, proving the dry-run oracle still detects a planted mismatch. |
| A8 | `bun run golden:mutation --prove-red` | Prints `prove-red OK` and exits non-zero, proving the mutation oracle still detects a planted mismatch. |
| A9 | `bash cli/build-binaries.sh linux-x64 && test "$(./cli/dist/docks-kit-linux-x64 --version)" = "$(bun -p 'require(\"./package.json\").version')"` | Exits 0; `bun build --compile` produces a working standalone binary whose version is the bare string exactly matching `package.json`. |
| A10 | `./docks-kit --version >/dev/null && test -z "$(./docks-kit --version 2>&1 >/dev/null)"` | Exits 0; the second source-mode invocation in a warm checkout emits empty stderr, proving the surviving `node_modules/effect` sentinel suppresses redundant repair. |

## Out of scope / do-NOT-touch

- Do not migrate, refactor, or add Effect imports to any of the 19 TypeScript modules under `cli/src/engine-native/`.
- Do not redesign command names, options, arguments, completions, stdout, stderr, exit codes, EngineNative vocabulary, sync behavior, or golden normalization.
- Native v4 `--help` rendering and one owner-accepted class of error rendering are the only output-format exemptions. The class is invalid input that leaves a positional the command's declared arity cannot absorb (exit code preserved; only message bytes differ). Every path in it exits 1 under Effect 3 and Effect 4; Effect 3's bytes there carried a wall-clock timestamp and were never stable, so they could not be pinned.
- Do not change any pre-existing golden row. Post-migration golden additions are limited to the owner-accepted help and error renderings plus strictly additive rows that characterize behavior already proven identical to Effect 3; root, `--version`, and every existing case remain behavior-preserving.
- Do not edit `SoT/.agents/skills.txt`, `cli/src/engine-native/skillsSync.ts`, or generated skill payloads. The plugin already supplies `effect-v4`.
- Do not edit the `effect-v4`, `effect-ts-setup`, `effect-ts-port`, or `effect-ts-specialist` skill bodies. Plugin-internal work belongs in `DocksDocks/docks`.
- Do not introduce `@effect/platform`, a replacement platform abstraction, a compatibility wrapper for `@effect/cli`, or aliases that preserve the removed package names.
- Do not change `cli/build-binaries.sh` or `.github/workflows/release-cli.yml` merely to make a failed v4 build pass. In `docks-kit`, change only the dependency sentinel from `node_modules/@effect/cli` to `node_modules/effect`; every other launcher line remains a read-only acceptance surface.

## Known gotchas

- `effect/unstable/cli` is intentionally unstable. The exact beta pin and installed declarations are load-bearing; later beta declarations may differ.
- Vitest 4 is not optional: `@effect/vitest@4.0.0-beta.107` peers on `vitest >=4.1.0 <5.0.0`. Immediately after the Vitest-only bump, the graph is knowingly peer-incoherent because `@effect/vitest@0.29.0` peers on `vitest ^3.2.0`; only the documented temporary `settings.test.ts` red is accepted until the Effect swap lands.
- `@effect/cli` and `@effect/platform` do not have a v4 companion release to wait for. Keeping either package creates a mixed v3/v4 graph rather than a safer migration.
- `docks-kit` currently uses `node_modules/@effect/cli` as its source-install sentinel. Removing that package without repointing the sentinel to `node_modules/effect` forces every source-mode invocation to print an install message and rerun the frozen install.
- v4's built-in `--version` also claims `-v`, and built-ins are prepended during global-flag parsing. The repository's local `--verbose` aliases in `sync.ts`, `model.ts`, and `toolchain.ts` must retain `-v`; prove precedence with the existing public mutation invariants and override the built-in set if necessary.
- `BunContext` is gone. Substituting `BunServices.layer` must preserve the single layer composition in `main.ts`; do not scatter service provisioning across commands.
- The `effect-v4` skill's migration disclaimer means its examples are guidance, not migration authority. Installed beta declarations and exact official declaration modules decide call shapes.
- The sibling `effect-ts-setup`, `effect-ts-port`, and `effect-ts-specialist` skills target Effect 3.x. After migration, sessions in this checkout must route Effect work to `effect-v4`.
- `skipLibCheck: true` does not prove application compatibility. `bun run typecheck` must validate every repository-owned callsite under strict mode.
- The standalone build embeds the generated payload and version. A source-mode CLI success does not prove the compiled artifact accepted by the launcher; both paths must print the bare version.

## Global constraints

- Exact supply chain: pin `effect`, `@effect/platform-bun`, and `@effect/vitest` to `4.0.0-beta.107` and `vitest` to `4.1.10`; never use `beta`, a range, a floating tag, `@latest`, or a silently newer beta in `package.json` or `bun.lock`.
- Clean cutover: remove `@effect/cli` and `@effect/platform` from the manifest, lockfile, imports, and code vocabulary; leave no alias, compatibility barrel, or deprecated path.
- API authority: verify unstable CLI, Bun runtime/services, service, and test APIs against the installed exact declarations before editing each boundary.
- Owner-authorized behavior boundary: "v4's native `--help` rendering is ACCEPTED. Help text is exempt from the behavior-preservation rule and its new output is recorded in goldens. `--version` is NOT exempt: it must keep printing the bare version string." Extended by the owner on 2026-08-11 in two parts. First, the help exemption covers the whole `--help` invocation including its exit code: Effect 3 refused to render help when `--help` followed another flag (`sync --dry-run --help` exit 2, `status --json --help` exit 1) while Effect 4 renders it and exits 0. Second, class-wide rather than by path: v4's error rendering is ACCEPTED for invalid input that leaves a positional the command's declared arity cannot absorb (exit code preserved; only message bytes differ), with representative rows pinned as characterization.
- Behavior preservation: except for the quoted help exemption and the accepted error-rendering class, every public command's stdout, stderr, and exit code remains unchanged, proven by differential measurement against a real Effect 3 worktree. The added public dry-run rows plus existing mutation invariants are the authoritative contract for the migrated parser path.
- Build preservation: `bun build --compile` must produce a working standalone binary whose `--version` exactly equals the bare `package.json.version`, so the `docks-kit` launcher's mismatch rejection remains effective.
- Launcher preservation: the one allowed launcher edit repoints the install sentinel to `node_modules/effect`; a second source-mode `./docks-kit --version` in a warm checkout must emit empty stderr.
- Payload preservation: `bun cli/scripts/generate-sot-payload.ts --check` must pass without regenerating unrelated bytes.
- Engine boundary: EngineNative remains ordinary TypeScript; every EngineNative sync step stays idempotent, the removed bash engine stays removed, and `DOCKS_KIT_ENGINE=bash` must continue to fail.
- Routing: repository guidance routes Effect 4 work to `effect-v4` from `effect-kit@docks`; the intentionally empty universal-skill manifest remains untouched.
- Validation order: characterize public paths first, upgrade Vitest, swap the dependency graph, repoint the launcher sentinel, migrate services, migrate runtime wiring, preserve bare version formatting, migrate commands and `-v` precedence, adapt tests/goldens, update docs, verify the binary, then run the full gate.

## STOP conditions

- STOP and revert the current boundary if any public command output, stderr, or exit code changes without an explicit requirement in this plan. The only exemptions are native v4 help text and the owner-accepted invalid-input error-rendering class.
- STOP if a newer beta appears during migration. Do not chase it silently; continue only with exact `4.0.0-beta.107` or return the plan for an explicit pin decision.
- STOP before dependency edits, or revert them if already applied, if any exact `@effect/*` package stops resolving a coherent peer set with exact Effect `4.0.0-beta.107` and Vitest `4.1.10`.
- STOP if the installed declarations contradict an API mapping in this plan. Record the declaration difference and revise the plan before inventing an adapter or cast.
- STOP if TypeScript `7.0.2` cannot typecheck the exact graph under the existing `cli/tsconfig.json`; do not weaken `strict`, enable emit, or use `skipLibCheck` as a substitute for fixing repository-owned types.
- STOP if any pre-existing golden row changes, either positive/prove-red golden contract fails, or the public `--version` row stops being the bare version. New rows may only be added for the owner-accepted help and error renderings, or to characterize behavior measured identical to Effect 3.
- STOP if any implementation requires editing `cli/src/engine-native/`, a plugin-owned skill, `SoT/.agents/skills.txt`, the binary build script, or release workflow. The only launcher edit allowed is its dependency-sentinel path.
- STOP if the compiled binary fails, either source or binary `--version` differs from the bare `package.json.version`, the warm launcher's second invocation emits stderr, or the generated-payload check fails.

## Cold-handoff checklist

- [x] The owner's beta decision, help-rendering decision, exact-beta gate, and no-silent-bump rule are explicit.
- [x] The six-row dependency graph records every current and after-version, both removals, and the forced exact Vitest 4 pin.
- [x] The official v4 API mapping covers services, exact Argument/Flag modules, the `runWith` argv/config shape, custom bare-version formatting, global `-v` precedence, Bun services/runtime, Effect-aware Vitest, and retained core APIs.
- [x] Every Effect-bearing source and test file is inventoried by current symbols and migration treatment.
- [x] All 19 Effect-free EngineNative TypeScript modules are excluded from migration.
- [x] The already-enabled plugin satisfies skill availability; the universal manifest and skill parser are absent from affected paths and implementation steps.
- [x] TypeScript target/module/resolution/strict/noEmit/skipLibCheck settings, the absence of a root tsconfig, the exact TypeScript pin, and the checked v4 floor evidence are recorded.
- [x] Characterization adds public-path golden rows before dependency edits; services, runtime, version formatting, commands, tests, accepted help snapshots, docs, binary, and full gate follow in dependency order.
- [x] Acceptance covers registry resolution, frozen install, no Effect 3 tree, typecheck, the full unit suite, payload, full CI, both prove-red paths, bare compiled version identity, and a silent second warm source launch.
- [x] Every repository path cited by the plan existed when repaired; plugin-internal content is cited by skill and plugin name rather than a nonexistent repository path.
- [x] No undefined decision, placeholder, or follow-up remains.

## Self-review

Score: repaired after one blocked plan review and the owner's help-rendering decision. All ten findings now have explicit steps, sources, scope, and acceptance evidence; the plan remains `planned` for a cold implementation handoff.

## Review

### Plan review — 2026-08-10
Plan-review: blocked
- Finding 1 · blocking — Added the launcher-sentinel step, narrowed launcher edit exemption, `launcher.test.ts` fixture update, and silent second warm-source acceptance.
- Finding 2 · blocking — Added a `CliOutput` layer step that preserves bare `--version`, exact formatter sources, and retained the compiled binary equality proof.
- Finding 3 · blocking — Recorded the owner's native-help exemption in context and global constraints, removed help from the redesign prohibition, and scoped golden updates to characterized help rows.
- Finding 4 · blocking — Added eight pre-dependency `public: true` dry-run characterization rows and made command migration preserve every non-help row.
- Finding 5 · blocking — Corrected `runWith` to `{ version }`, command-owned naming, and `argv.slice(2)` with the exact `Command.d.ts` source.
- Finding 6 · advisory — Replaced barrel/migration-map citations with exact `Argument.d.ts`, `Flag.d.ts`, `Command.d.ts`, `CliOutput.d.ts`, and `CliConfig.d.ts` sources, and recorded `BunContext.d.ts` HTTP 404.
- Finding 7 · advisory — Added the built-in `-v` collision gotcha, a precedence/override sub-task, `GlobalFlag.ts` source, and the three existing public `-v` invariants as proof.
- Finding 8 · advisory — Changed the Vitest step to `bun run test:unit`, documented the sole temporary `settings.test.ts` red and interim peer incoherence, and added the complete unit-suite scope plus `vitest.config.ts`.
- Finding 9 · advisory — Corrected every EngineNative module-count reference to 19 while retaining the verified zero-Effect-import boundary.
- Finding 10 · advisory — Added `cli/src/engine.ts` and `vitest.config.ts` to `affected_paths` and kept every Steps path covered there.

### Code review round 1 — 2026-08-11
Code-review: repair
- HIGH · Bug · `cli/src/commands/sync.ts` `LEGACY_HINTS`, reached from the targets loop — the renamed-flag contract became dead code, because Effect 4 rejects an unknown flag during parsing instead of routing it into excess positionals. `sync --force` printed v4 help on stdout and exited 1 rather than the documented one-line hint on stderr with exit 2 (`cli/docs/flags.md`, "Renamed legacy flags"). FIXED: `cli/src/main.ts` moves every `SYNC_LEGACY_FLAGS` token behind `--`. Verified: `--force`, `--supabase`, `--680k`, `--claude` each exit 2, empty stdout, exact hint on stderr.
- MEDIUM · Bug · `cli/src/main.ts` argv normalization — Effect 4 auto-negates any declared boolean, so `sync --no-dry-run` parsed as `dryRun = false` and performed a real mutating sync where Effect 3 exited 2. Reproduced inside the harness temp home (`[ok] Claude runtime synced`). FIXED, and deliberately generalized past the reported scope: negation is a parser-wide behavior, so every `--no-<name>` token that is not a genuinely declared flag is now routed to positionals for all commands, not only `sync`. Verified: `model claude --no-dry-run` exits 2 instead of writing a model, `toolchain --no-yes` exits 2, and the real `update --no-sync` flag still works.
- MEDIUM · Bug · reviewer's second instance of the same finding, adjacent boolean-literal consumption (`sync --dry-run 0`) — REJECTED, not a regression. Effect 3 consumed the same literals: `@effect/cli@0.75.2` `src/internal/options.ts`, `Single` option parsing, tests `isTrueValue`/`isFalseValue` against `afterOption[0]` and drops it via `afterOption.slice(1)`. Behavior is identical in v3 and v4, so "fixing" it would itself breach behavior preservation.
- MEDIUM · Maintainability · stale narration naming the removed `@effect/cli` in `cli/src/commands/sync.ts`, `cli/test/golden-dryrun.ts`, and `cli/src/engine.ts`. FIXED: all three name `effect/unstable/cli` and state the actual v4 behavior.
- LOW · Bug · `cli/src/main.ts` subcommand detection returned the value of a preceding value-taking global, so `--log-level debug sync --claude-effort` skipped normalization. FIXED: `subcommandName` skips `GLOBAL_VALUE_FLAGS` and the token each consumes. Verified: exit 2 with the effort catalog on stderr.
- LOW · Bug · `cli/src/main.ts` valueless detection misread a legitimate `-`-leading value (`--claude-compact-window -1`). FIXED: that pair is rewritten to the equals form. Verified: exit 2 with EngineNative's token-count message on stderr.
- Explicitly clean per the reviewer: golden scope, `CliOutput` formatter derivation and its single call site, service migration, the launcher's single-line change, cutover hygiene (no shim, alias, `any`, or cast), and rename fidelity across all nine command modules including `Argument.variadic` and `Flag.atLeast(0)`.

Regression coverage added in `cli/test/golden-mutation.ts`: channel invariants for the four legacy rename hints and for `--no-dry-run` / `--no-prune`, each asserting exit 2, empty stdout, and the exact stderr text. Both were confirmed to fail when deliberately broken, then restored.

### Code review round 2 — 2026-08-11
Code-review: repair
- MEDIUM · Bug · `cli/src/main.ts` declared-flag allowlist matched the whole token, so `update --no-sync=false` was misrouted to a positional even though Effect 3 accepted the equals form (`@effect/cli@0.75.2` `src/internal/options.ts`, boolean `equalsValue` handling). FIXED, and tightened past the suggestion: the lookup now compares the flag NAME and the exemption is scoped to the declaring subcommand, so `--no-sync` remains a flag under `update` and stays a positional under `sync`.
- MEDIUM · Spec · normalization enumerated only the ten legacy flags and the `--no-` family, so any other unrecognized long flag (`sync --bogus`) still reached Effect 4's `ShowHelp` path with exit 1. FIXED generically: `cli/src/argv.ts` now carries the declared long flags of every subcommand, and any undeclared long flag becomes a positional. Measured: `sync --bogus` is byte-identical to Effect 3, exit 2 included.
- MEDIUM · Maintainability · the normalization was inline top-level code in a module that runs `Command.runWith` on import, so none of it was unit-testable, and the cited `update --no-sync --help` proof was invalid because action flags run before parse errors. FIXED: extracted the pure `normalizeArgv` and `subcommandName` into `cli/src/argv.ts`, with the rule matrix covered by `cli/test/unit/argv.test.ts` and two further channel invariants in `cli/test/golden-mutation.ts`.
- LOW · Bug · a value flag followed by another `--` flag was treated as valueless, whereas Effect 3 consumed that token as the value. FIXED: only an absent value makes the flag a positional; every `-`-leading value becomes the equals form. Measured: `sync --claude-model --dry-run` is byte-identical to Effect 3.

### Effect 3 differential — 2026-08-11
Because no commit had been made, `HEAD` still carried the Effect 3 graph, so the migration was measured against a real Effect 3 worktree (`git worktree add /tmp/v3base HEAD` plus a frozen install) rather than argued from inference. Each case ran against both trees with one shared temporary HOME, normalizing the HOME and repository paths before comparison.

Byte-identical, exit codes included: `sync --force`, `sync --bogus`, `sync --no-dry-run`, `sync --no-dry-run=true`, `sync --claude-model --dry-run`, `sync --claude-model`, `sync --claude-compact-window -1`, `sync --claude-effort`, `sync claude --dry-run`, `sync --dry-run`, `sync --dry-run --reconcile`, `sync --claude-plugin=supabase --dry-run`, `sync --claude-model=opus --dry-run`, `model claude`, `model claude --bogus`, `model claude --no-dry-run`, `toolchain check`, `toolchain --no-yes`, `status`, `status --json`, `docs`, `models`, `plugins list`, `skills list`, `--version`.

One class of invalid input differs, accepted by the repository owner on 2026-08-11 and characterized precisely afterwards. It is reached when a rerouted token leaves a positional that the command's declared arity cannot absorb: `status --no-json`, `status --bogus`, `update --no-no-sync`, `update --bogus`, `plugins --bogus list`, `docs --bogus overview`, `skills --no-json list`, and `toolchain ensure bun --bogus`. Every one exits 1 under Effect 3 and Effect 4, so the exit contract is preserved; only the message bytes differ. Effect 3 wrote `Received unknown argument: '<token>'` to stderr and dumped a raw defect to stdout carrying a wall-clock timestamp — re-running one case produced stdout digests `d0f68df2`, `17f722ea`, and `9e283922`, so those bytes were never stable enough to pin. Effect 4 prints a deterministic formatted error plus the command help. Commands with spare positional capacity stay byte-identical (`models --no-json`, `docs --no-json` both exit 2 through their own handler). Owner decision on 2026-08-11, granted class-wide rather than per path so a future command of the same shape is covered without another STOP: accept the new rendering and pin representative rows so it cannot drift.

### Code review round 3 — 2026-08-11
Code-review: repair
Four LOW findings, no CRITICAL, HIGH, or MEDIUM. The reviewer confirmed `COMMAND_FLAGS` is an exact 1:1 with the `Flag.*` constructors in all nine command modules, `GLOBAL_FLAGS` matches Effect 4's `GlobalFlag.BuiltIns`, `subcommandName` is correct, and no `any`, cast, suppression, or dead export remains. It also established that no rerouted token can reach `engine(args)`, because every command validates its positionals first, so none of these could cause a mutation.
- LOW · Bug · `cli/src/argv.ts` end-of-flags handling dropped a repeated literal `--`. FIXED: only the first marker is the delimiter, matching Effect 4's lexer, which splits on the first `--` and returns the rest verbatim. Measured: `sync -- a -- b` is byte-identical to Effect 3.
- LOW · Bug · `cli/src/argv.ts` dash-leading-value rewrite swallowed a user `--` as a flag value. FIXED: a following `--` marks the flag valueless. Measured: `sync --claude-effort -- claude` is byte-identical to Effect 3.
- LOW · Bug · `cli/src/argv.ts` appended moved tokens after every retained positional, so `sync --bogus zzz` reported its targets in the wrong order. The reviewer marked the Effect 3 side `[INFERENCE]` because the comparison worktree had been removed; it was rebuilt and the divergence confirmed — Effect 4 produced exactly Effect 3's `zzz --bogus` output for the input `--bogus zzz`. FIXED: value flags consume their value explicitly, and once any token moves, later bare words move with it, preserving the user's order. Measured byte-identical afterwards for `sync --bogus zzz`, `sync zzz --bogus`, `sync --bogus a b`, and `--log-level debug sync --bogus zzz`.
- LOW · Maintainability · rule branches without a unit case. FIXED: `cli/test/unit/argv.test.ts` gained rows for the global-flag guard (`--wizard`, `--completions`), a normal consumed value, a bare and a repeated `--`, the marker-as-value case, ordering, and `subcommandName` returning undefined.

Chasing that ordering finding surfaced the real Effect 3 rule, which no earlier round had identified: Effect 3 stopped option parsing at the FIRST unrecognized long flag, leaving every later token in the excess positionals. Confirmed by measurement — Effect 3 answers `sync --bogus --dry-run` with `Unknown sync target(s): --bogus, --dry-run`, so the trailing declared flag was a target, not a flag. `normalizeArgv` now models that stop point directly, which also removed the last candidate residual (`sync --bogus --claude-model opus`) instead of accepting it. Declared value flags do not stop parsing; they still consume their value.

After that change the full differential is 27 of 27 byte-identical to Effect 3, exit codes included, covering unknown flags before and after declared flags, mixed unknown plus value flags, both `--` forms, ordering in both directions, every legacy hint, negation on three commands, and the successful dry-run paths.

### Code review round 4 — 2026-08-11
Code-review: repair
One MEDIUM and five LOW, all closed. MEDIUM: unknown SINGLE-dash tokens (`sync -x`, `sync -dry-run`, a lone `-`) were not rerouted, turning exit 2 on stderr into exit 1 with help on stdout. LOW: the parse stop was unconditional where Effect 3 armed it only at the head of the input after the subcommand; stale `@effect/cli` narration in `cli/test/lib/goldenExecution.ts` and `cli/docs/overview.md`; an unused `import { engine }` in `cli/src/main.ts`; public golden rows concatenating stdout and stderr; and plan constraint text out of step with the owner decisions. Each was fixed and re-measured, taking the differential to 49 of 49 byte-identical.

### Code review round 5 — 2026-08-11
Code-review: repair
One MEDIUM and three LOW. MEDIUM: a repeated occurrence of a declared non-repeatable flag reached the Effect 4 parser, which silently keeps the first value — `sync --yes --yes` exited 0 and performed a real mutating sync where Effect 3 exited 2. Measurement confirmed it for `sync`, and also showed the reviewer's `model claude --dry-run --dry-run` example was already identical, so the reported boundary was not the real one. LOW findings covered a dash-leading value for a global value flag, a stale plan record, and four uncovered test branches.

### Design change — 2026-08-11: validate arguments instead of emulating Effect 3
Rounds 4 and 5 each found another Effect 3 parser accident the compatibility layer had failed to mimic. That is the signature of the wrong design, not of unlucky review: `cli/src/argv.ts` had grown a stop-parsing model, head-position semantics, bare-word ordering, single-dash rerouting, and `--` shuffling, all to reproduce behavior Effect 3 never intended and never documented.

The repository owner directed that matching Effect 3 is not required where Effect 3 was itself defective, and asked for a durable design. The module was rewritten from an argument REWRITER into an argument VALIDATOR. `prepareArgv` returns an `ArgvOutcome` union: either one rejection carrying an exact message and exit code 2, or an acceptance carrying the arguments Effect 4 should parse. The stop-parsing, head-position, ordering, single-dash and `--` machinery is deleted outright, which removes the entire class of defect the last two rounds were finding.

Five rejection rules survive, each justified by a kit contract or a safety invariant rather than by Effect 3:
1. A renamed legacy flag returns its documented rename hint (`cli/docs/flags.md`). Scoped to `sync`, because every hint names a sync-only replacement.
2. Any unrecognized flag is refused by name. This is the safety rule: it stops Effect 4 negating `--no-dry-run` into a real mutating sync, and it catches typos such as `-dry-run`.
3. A repeated non-repeatable flag is refused rather than silently resolved to its first value; `--claude-plugin` stays repeatable.
4. A presence-based boolean carrying an inline value is refused. An adversarial sweep of the finished seam found `sync --dry-run=false` performing a real mutating sync while reading as a dry run.
5. A value-taking modifier with no value returns its existing catalog text.

Both flag surfaces are derived at run time rather than hand-written: the nine command surfaces from the imported `Command` objects, and the global surface from Effect 4's exported `GlobalFlag.BuiltIns`. Initialization throws if either runtime shape changes, so a future beta fails loudly instead of silently refusing a valid flag. Deriving the globals also fixed a real defect found in review, where `-v` was refused at the root even though the CLI's own help advertises `--version, -v`.

`LEGACY_HINTS` and the catalog composition moved from `cli/src/commands/sync.ts` into the seam, and the opt-in plugin grammar is composed from EngineNative's exported `KNOWN_CLAUDE_OPTIN_PLUGINS` rather than a second hardcoded list. The unreachable branches were deleted from the sync handler; unknown sync targets remain the handler's responsibility with an unchanged message.

`cli/src/main.ts` no longer rewrites argv at all. Its two remaining rewrites were probed against the real CLI and proved vestigial: Effect 4 parses `--claude-plugin=supabase` and the empty `--claude-model=` correctly on its own, so they were deleted rather than carried into the seam. One module now owns argument handling.

Accepted consequence: an unrecognized flag now reports `unknown flag --bogus for 'sync'` instead of Effect 3's `Unknown sync target(s): --bogus`. The exit code and channel are unchanged, the diagnostic names the real problem, and no unrecognized input can reach the engine.

### Completion review — 2026-08-11
Code-review: pass
The gating review granted the matching pass required by `docs/plans/AGENTS.md` for a public-contract change. It re-derived each earlier closure from source, attacked the seam with sixty direct inputs and twenty end-to-end runs in throwaway homes, and found no input that reaches a real run when it should be refused, nor any legitimate input refused. It recorded the decisive structural fact: `sync` validates targets before calling the engine, and engine arguments are rebuilt from typed config, so a raw token can never flow through.

Four LOW findings were recorded as optional follow-up. All four were fixed anyway rather than shipped as known defects:
- Repeating an idempotent built-in action was refused; `--help --help` now renders help. The exemption is derived from the built-ins' own `_tag === "Action"`, so it stays narrow: `sync --yes --yes` is still a duplicate.
- An unknown subcommand blamed the flag; `snyc --dry-run` now reports `unknown command 'snyc'` instead of `unknown flag --dry-run for 'snyc'`.
- Refusing a clustered short is deliberate, since the kit declares no clusterable alias pair; that decision is now recorded in the rule's comment rather than left implicit.
- The fail-loud derivation guarantee had no test, which is the one gap that could let the design's worst failure mode ship green. `cli/test/unit/argv.test.ts` now mocks a malformed `GlobalFlag.BuiltIns` and asserts the module import throws; the case was proven to bite by temporarily restoring a valid shape.

### Confirming review — 2026-08-11
Code-review: pass
The delta over the passed diff was reviewed and passed again, with four further LOW findings. Two were fixed rather than shipped, both in `cli/src/argv.ts`:
- The action exemption was too broad. `--completions` is a built-in action that TAKES A VALUE, so exempting every action let `--completions bash --completions zsh` through, and Effect 4 silently keeps the first value — precisely what the duplicate rule exists to refuse. The exemption is now limited to presence-based actions, so `--help` and `--version` stay idempotent while `--completions` is refused again.
- The command-surface lookup was a plain object built with `Object.fromEntries`, so an inherited member answered for names such as `toString` or `constructor`. `docks-kit toString --dry-run` therefore skipped the unknown-command guard and crashed with an uncaught `TypeError` at module top level. The lookup is now a `Map`, which has no prototype keys, and that invocation returns `unknown command 'toString'` with exit 2. The defect predated the delta; it surfaced because the new guard is built on that predicate.

Both are pinned by unit cases. The remaining two LOW findings were documentation-level and are recorded in the reviewer's report rather than changed.

## Sources

- `package.json` `dependencies` and `devDependencies`, plus `bun.lock` — current exact Effect, TypeScript, and Vitest graph.
- `cli/tsconfig.json` `compilerOptions` — ES2022, Preserve, bundler resolution, strict, noEmit, and skipLibCheck configuration; repository root contains no `tsconfig.json`.
- `SoT/.claude/settings.json` `enabledPlugins` — `effect-kit@docks` is enabled; `SoT/.agents/skills.txt` is intentionally empty.
- `effect-v4` skill in the `effect-kit@docks` plugin — v4 conventions, exact-installed-version gating, upstream commit `30dee8607214c893dd89f6eee65c669ef3dce8c9`, and the explicit statement that v3-to-v4 migration is outside the skill's scope.
- `cli/src/main.ts`, `cli/src/engine.ts`, `cli/src/services.ts`, `cli/src/commands/docs.ts`, `cli/src/commands/model.ts`, `cli/src/commands/models.ts`, `cli/src/commands/plugins.ts`, `cli/src/commands/skills.ts`, `cli/src/commands/status.ts`, `cli/src/commands/sync.ts`, `cli/src/commands/toolchain.ts`, and `cli/src/commands/update.ts` — complete production Effect import rim.
- `cli/test/unit/settings.test.ts`, `cli/test/unit/engine.test.ts`, and `cli/test/unit/services.test.ts` — complete unit-test Effect import rim.
- `cli/src/engine-native/` — 19 TypeScript modules with zero Effect imports.
- `docks-kit` dependency-repair sentinel and binary-version equality guard; `cli/test/unit/launcher.test.ts` `launcherFixture` — source sentinel fixture and launcher behavior.
- `cli/build-binaries.sh`, `.github/workflows/release-cli.yml`, and `cli/scripts/generate-sot-payload.ts` — standalone compile, release version, and generated-payload contracts.
- https://unpkg.com/effect@4.0.0-beta.107/package.json — exact published version, `effect/unstable/cli` export, package contents, and absence of a package-declared TypeScript floor.
- https://github.com/Effect-TS/effect/blob/main/migration/services.md — `Context.Tag` to `Context.Service` migration.
- https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/Argument.d.ts — exact `Argument.string` declaration.
- https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/Flag.d.ts — exact `Flag.boolean` and `Flag.string` declarations.
- https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/Command.d.ts — exact `runWith(command, { version, renderErrors? })(input)` declaration.
- https://unpkg.com/effect@4.0.0-beta.107/src/unstable/cli/GlobalFlag.ts — built-in `--version` / `-v`, prepended built-in order, and action precedence.
- https://unpkg.com/effect@4.0.0-beta.107/src/unstable/cli/CliOutput.ts and https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/CliOutput.d.ts — default `name vversion` rendering and custom formatter/layer API.
- https://unpkg.com/effect@4.0.0-beta.107/dist/unstable/cli/CliConfig.d.ts — configurable built-in global-flag set.
- https://unpkg.com/@effect/platform-bun@4.0.0-beta.107/dist/BunContext.d.ts — HTTP 404 absence proof for `BunContext`.
- https://unpkg.com/@effect/platform-bun@4.0.0-beta.107/dist/BunServices.d.ts — exact `BunServices.layer` declaration.
- https://unpkg.com/@effect/platform-bun@4.0.0-beta.107/dist/BunRuntime.d.ts — exact `BunRuntime.runMain` overloads and options.
- https://unpkg.com/@effect/vitest@0.29.0/package.json — interim `vitest ^3.2.0` peer that makes the Vitest-only bump knowingly incoherent.
- https://unpkg.com/@effect/vitest@4.0.0-beta.107/dist/index.d.ts — Vitest re-export and Effect-aware `it.effect`, `it.layer`, and `it.live` surface.
- https://github.com/Effect-TS/effect/blob/main/MIGRATION.md — retained core `Effect`, `Console`, `Layer`, and `Option` shapes.
- npm registry metadata checked 2026-08-10 — exact `4.0.0-beta.107` package resolution, `@effect/platform-bun` Effect peer, `@effect/vitest` Effect/Vitest peers, and exact `vitest@4.1.10` resolution.

## Verification Results

Every command below was run from the repository root on this host and its real exit status recorded.

| ID | Result |
|---|---|
| A1 | exit 0 — all four exact pins resolve; `@effect/platform-bun` and `@effect/vitest` peers still read `^4.0.0-beta.107`, and the Vitest peer reads `>=4.1.0 <5.0.0`. The `beta` dist-tag still points at `4.0.0-beta.107`, so no STOP fired. |
| A2 | exit 0 — frozen install; tree contains `effect@4.0.0-beta.107`, `@effect/platform-bun@4.0.0-beta.107`, `@effect/vitest@4.0.0-beta.107`, `vitest@4.1.10`, and no `effect@3.`, `@effect/cli@`, or `@effect/platform@`. |
| A3 | exit 0 — `tsc --noEmit -p cli` clean under TypeScript 7.0.2, strict, no weakened settings. |
| A4 | exit 0 — 26 test files, 236 tests passed on Vitest 4.1.10, including 62 cases pinning the argument seam. |
| A5 | exit 0 — generated SoT payload unchanged. |
| A6 | exit 0 — full gate: generated, typecheck, 236 unit tests, statusline runtime smoke, `golden-dryrun: OK (36 case(s))`, `golden-mutation: OK (64 case(s))`. Exit status captured directly, without a pipe. |
| A7 | exit 1 with `prove-red OK: golden-dryrun detected 36 planted mismatch(es)`. |
| A8 | exit 1 with `prove-red OK: golden-mutation detected 61 planted mismatch(es)`. |
| A9 | exit 0 — `bash cli/build-binaries.sh linux-x64` (BUILD_EXIT=0 captured without a pipe) then binary `--version` equals `package.json` version `0.14.4`. Source and binary `--help` are byte-identical under identical conditions. |
| A10 | exit 0 — second warm `./docks-kit --version` emits empty stderr. Also verified with the binary hidden, forcing genuine source mode. |

Golden scope, compared against `HEAD` (the pre-migration commit): all 25 pre-existing dry-run rows are unchanged and none was removed; 11 rows were added — the eight step-1 public characterization rows, the two owner-accepted error renderings, and one ordinary characterization row for `sync --bogus --claude-model opus`. `cli/test/goldens/mutation.json` is unmodified, and no path under `cli/src/engine-native/` was touched.

### Deviations from the plan, all verified

- **`repeated` had no mapping in the plan.** This beta has no `Flag.variadic`. `Args.repeated` became `Argument.variadic` and `Options.repeated` became `Flag.atLeast(0)`, both read from the installed declarations.
- **`.pipe(Argument.variadic)` loses inference.** Passing the uncalled overloaded function degrades the element type to `unknown`, which produced the only four typecheck errors. `sync` targets now use the data-first `Argument.variadic(arg)` form.
- **v4 rejects a value-taking flag that carries no value.** Effect 3 routed such a flag into positional targets so `sync`'s handler answered with the flag's catalog on stderr and exit 2; v4 fails parsing with exit 1 and writes help to stdout. `cli/src/main.ts` now moves a valueless modifier behind `--`, restoring the original message, channel, and exit code. The mutation suite's channel invariants for bare `--claude-effort`, `--codex-effort`, and `--claude-advisor` prove the restoration.
- **`--version` byte fidelity.** Effect 3 emitted `0.14.4\n\n`; v4's emit path produces one newline. The `CliOutput` formatter appends the trailing newline so the characterized row is byte-identical. Command substitution still yields the bare version, so the launcher equality guard is unaffected.
- **The built-in `-v` collision did not materialize.** The local `--verbose` aliases win in `sync`, `model`, and `toolchain`, so no `CliConfig` built-in override was needed.
- **The predicted interim red did not occur.** After the Vitest-only bump the whole unit suite passed; the accepted `settings.test.ts` failure never appeared.
- **No test adaptation was required.** `@effect/vitest@4` needed no source change in any test file; step 9's test half was a no-op and only the two help golden rows were re-recorded.
- **Parser-semantics regressions the goldens could not see.** Effect 4 rejects unknown flags and auto-negates declared booleans, which silently killed the legacy rename-hint contract and turned `--no-dry-run` into a real sync. Both are fixed at the argv boundary in `cli/src/main.ts` and are now covered by mutation invariants. Residual and accepted: `status --no-json` and `update --no-no-sync` reach v4's own error rendering (exit 1, help on stdout) rather than Effect 3's error bytes. Both are read-only or no-op paths on input that Effect 3 also refused, and no mutation can occur through either.

### Argument seam — final behavior, 2026-08-11

The rewritten seam was verified against the real CLI after the cutover. `prepareArgv` returns either one rejection or the arguments Effect 4 should parse, and performs exactly one normalization.

| Invocation | Result |
|---|---|
| `sync --force` | exit 2, stderr `--force was renamed to --reconcile` |
| `sync --no-dry-run` | exit 2, stderr `unknown flag --no-dry-run for 'sync'` — the safety rule; Effect 4 would otherwise negate the boolean and run a real sync |
| `sync --yes --yes` | exit 2, stderr `flag --yes was given more than once` — Effect 4 would otherwise keep the first value silently |
| `sync -x`, `sync -dry-run` | exit 2, stderr `unknown flag … for 'sync'` |
| `sync --claude-effort` | exit 2, the effort catalog and `requires a value` clause |
| `sync --claude-compact-window -1` | exit 2, EngineNative's `expects a token count` |
| `sync --claude-model --bogus` | exit 2, EngineNative's invalid-model diagnostic |
| `sync --claude-model --dry-run` | exit 2, the model catalog, because a recognized flag proves the value is missing |
| `sync --dry-run=false` | exit 2, stderr `flag --dry-run does not take a value` — found by an adversarial sweep after the redesign; before the guard this performed a REAL mutating sync while reading as a dry run |
| `sync zzz` | exit 2, `Unknown sync target(s): zzz` from the handler, unchanged |
| `sync claude --dry-run`, `--version`, `--help` | unchanged |

A fifth rejection rule was added after an adversarial sweep of the finished seam: a presence-based boolean must not carry an inline value. `sync --dry-run=false` had been accepted by Effect 4 and disabled the dry run, so an invocation that reads as a dry run performed a real sync. It is now refused, and a channel invariant pins it.

One normalization exists and is deliberate: Effect 4's lexer reads any `-`-leading token as an option, so a value that legitimately begins with `-` is joined onto its flag as `--claude-compact-window=-1`. Without it the value cannot survive to EngineNative. Everything else is passed through untouched.

Two golden rows improved as a consequence: `status --no-json` and `update --no-no-sync` moved from Effect 4's exit 1 with help on stdout to the kit's own exit 2 diagnostic on stderr, which also retires the earlier accepted error-rendering class for those paths.

### Accepted residue — 2026-08-11: engine-native narration

`cli/src/engine-native/index.ts` and `cli/src/engine-native/DESIGN.md` still name the removed `@effect/cli` in comments describing the native-raw channel. Two plan clauses collide here: the clean-cutover constraint asks for the package to leave the code vocabulary, while the out-of-scope list and its STOP condition forbid touching any path under `cli/src/engine-native/`. The prohibition wins, because it protects the engine boundary that the whole migration depends on, and the cost is three stale comment lines with no behavioral effect. Recorded as accepted rather than silently ignored; a comment-only sweep of those files belongs to separate, engine-scoped work.

### Archive gate — 2026-08-11
Code-review: pass
A final delta-scoped review returned zero findings of any severity and granted the matching pass that `docs/plans/AGENTS.md` requires before a public-contract change may be archived. It established the delta mechanically with a diff-of-diffs rather than trusting the brief, checked the narrowed action exemption against Effect 4's own `GlobalFlag` declarations (exempt set is exactly `--help`, `--version`, `--wizard`; `--completions` and `--log-level` correctly excluded), confirmed every former index access was converted to the `Map` with no reachable `undefined` dereference, and re-proved all five rejection rules, the value join, both derived surfaces, the unknown-command guard and `--` handling live against the frozen source.
