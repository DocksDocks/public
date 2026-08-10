---
title: Migrate the CLI to Effect v4 beta
goal: Migrate the existing Effect rim to one exact Effect 4 beta graph while preserving every CLI contract except the explicitly accepted native help rendering.
status: planned
created: "2026-08-10T17:52:54-03:00"
updated: "2026-08-10T18:18:47-03:00"
started_at: null
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
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
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
review_status: null
planned_at_commit: ba5fdba7095565a8820f50279be330f3198db138
execution_base_commit: null
---

## Goal

Migrate docks-kit's small existing Effect rim from Effect 3 to the exact Effect 4 beta package graph defined below. Preserve every public command's stdout, stderr, and exit code except for the explicitly accepted v4 native `--help` rendering; record that new help output in goldens, preserve the generated payload, and prove that source and standalone `--version` output remains the bare package version expected by the `docks-kit` launcher.

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
| 1 | Characterize the current public CLI before any dependency edit. Add `public: true` dry-run rows for root (`[]`), `--help`, `--version`, `docs`, `models`, `plugins list`, `skills list`, and `update --help`; record their stdout, stderr, and exit codes alongside the existing native-raw matrix. Run the full gate and both positive goldens and record package and golden checksums. | `package.json`; `bun.lock`; `cli/src/main.ts`; `cli/src/engine.ts`; `cli/src/services.ts`; `cli/src/commands/docs.ts`; `cli/src/commands/model.ts`; `cli/src/commands/models.ts`; `cli/src/commands/plugins.ts`; `cli/src/commands/skills.ts`; `cli/src/commands/status.ts`; `cli/src/commands/sync.ts`; `cli/src/commands/toolchain.ts`; `cli/src/commands/update.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json` | none | planned | Before the dependency edit, the dry-run matrix contains all eight named `public: true` rows, `bun run golden:dryrun`, `bun run golden:mutation`, and `bun run test:ci` exit 0, and the new baseline outputs and SHA-256 checksums are recorded. |
| 2 | Upgrade Vitest from `3.2.7` to exact `4.1.10` as the explicit prerequisite for `@effect/vitest@4`; regenerate only the lockfile dependency graph and run the entire unit suite rather than two files. This interim graph is knowingly peer-incoherent because installed `@effect/vitest@0.29.0` peers on `vitest ^3.2.0`; until step 3 lands, only the documented `cli/test/unit/settings.test.ts` failure is accepted. | `package.json`; `bun.lock`; `cli/test/unit/`; `vitest.config.ts` | 1 | planned | `bunx vitest --version` identifies `4.1.10` and `bun run test:unit` exercises the whole configured unit suite; before step 3, the only permitted red is the recorded `settings.test.ts` peer-incoherence failure and every other unit file passes. |
| 3 | Replace the Effect dependency graph with the exact reviewed beta set: pin `effect`, `@effect/platform-bun`, and `@effect/vitest` to `4.0.0-beta.107`; remove `@effect/cli` and `@effect/platform`; retain exact `vitest@4.1.10`; and regenerate `bun.lock` without choosing a newer beta. | `package.json`; `bun.lock` | 2 | planned | A frozen install succeeds; the installed tree contains the three exact Effect beta packages and exact Vitest pin, contains no Effect 3 package, and contains neither `@effect/cli` nor `@effect/platform`. |
| 4 | Repoint the source launcher's dependency-repair sentinel from the removed `node_modules/@effect/cli` directory to `node_modules/effect`, and update the launcher fixture to create the surviving sentinel. Change no other launcher behavior. | `docks-kit`; `cli/test/unit/launcher.test.ts` | 3 | planned | `bun vitest run cli/test/unit/launcher.test.ts` exits 0, and after one source-mode `./docks-kit --version` warms the checkout, a second invocation exits 0 with empty stderr instead of running another frozen install. |
| 5 | Migrate the three service tags from `Context.Tag` class syntax to `Context.Service<Self, Shape>()(id)` while retaining every service identifier, implementation shape, live/test layer, and `EngineServicesLive` composition. | `cli/src/services.ts`; `cli/test/unit/services.test.ts` | 3 | planned | `bun vitest run cli/test/unit/services.test.ts` exits 0 and the test still proves the live and injected service contracts. |
| 6 | Migrate root runtime wiring: import CLI symbols from `effect/unstable/cli`, replace `BunContext.layer` with `BunServices.layer`, choose `Command.runWith` because `main.ts` injects normalized arguments, configure it with `{ version: GENERATED_PACKAGE_VERSION }`, and retain `BunRuntime.runMain`, the native-raw bypass, root command metadata, subcommand order, and one merged application layer. | `cli/src/main.ts`; `cli/src/services.ts` | 5 | planned | `cli/src/main.ts` calls `Command.runWith(root, { version: GENERATED_PACKAGE_VERSION })(argv.slice(2))`, obtains the command name from `Command.make("docks-kit")`, has no `@effect/cli` or `BunContext` reference, and preserves native-raw handling plus argv normalization. |
| 7 | Preserve the non-exempt version contract by providing a `CliOutput` layer in the merged application layer: derive from the default formatter, override only `formatVersion` to return the bare version argument, and leave native v4 help formatting intact. | `cli/src/main.ts`; `cli/test/golden-dryrun.ts`; `cli/test/goldens/dryrun.json` | 6 | planned | The public `--version` golden remains the bare `package.json.version`, `bun run typecheck` exits 0, and A9 proves the compiled binary has the same bare output. |
| 8 | Migrate all nine command modules from `@effect/cli` to `effect/unstable/cli`: rename `Args` to `Argument`, `Options` to `Flag`, and text/boolean constructors according to the exact declaration mapping below; retain `Prompt`, `Command.make`, `Command.withDescription`, every option/argument name, default, validation rule, handler, output channel, and exit path. Verify the new built-in `-v` precedence against the local `--verbose` aliases in `sync`, `model`, and `toolchain`; if the global version action wins, provide a `CliConfig` built-in set whose version action has no `-v` alias so the local aliases remain authoritative. | `cli/src/commands/docs.ts`; `cli/src/commands/model.ts`; `cli/src/commands/models.ts`; `cli/src/commands/plugins.ts`; `cli/src/commands/skills.ts`; `cli/src/commands/status.ts`; `cli/src/commands/sync.ts`; `cli/src/commands/toolchain.ts`; `cli/src/commands/update.ts`; `cli/src/main.ts`; `cli/src/engine.ts`; `cli/test/golden-mutation.ts` | 7 | planned | `bun run typecheck` exits 0; every public characterization row from step 1 still passes except the accepted help rows; and the existing public invariants for `sync -v`, `model claude default -v`, and `toolchain ensure effect-solutions -v` still prove verbose behavior rather than version output. |
| 9 | Adapt the Effect-aware tests to `@effect/vitest@4` and migrated service/runtime types without weakening assertions; keep `it.effect` where it defines an observable Effect contract. Run the full unit suite and both positive goldens. Update only the new `--help` and `update --help` rows to record v4's accepted native rendering; preserve every non-help public row and existing native/mutation case. | `cli/test/unit/`; `vitest.config.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json` | 8 | planned | `bun run test:unit`, `bun run golden:dryrun`, and `bun run golden:mutation` exit 0; only help-row bytes differ from the step 1 characterization, while root, `--version`, `docs`, `models`, `plugins list`, `skills list`, all mutation cases, and all other dry-run cases preserve their recorded outputs. |
| 10 | Update repository guidance for the completed dependency graph and skill routing. State that Effect 4 work in this checkout routes to `effect-v4` from the already-enabled `effect-kit@docks` plugin; the sibling setup, port, and specialist skills target Effect 3; migration APIs come from installed declarations; and no universal-skill manifest entry is needed. | `AGENTS.md`; `CLAUDE.md`; `README.md` | 9 | planned | All three files describe the exact beta graph, `AGENTS.md` and `CLAUDE.md` route this checkout to `effect-v4`, and none instructs installation of a separate upstream skill. |
| 11 | Build the standalone Linux x64 binary through the repository build script and exercise its version path. Confirm the generated-payload precheck runs before compilation and the binary version exactly matches `package.json`, preserving the launcher's mismatch guard. | `cli/build-binaries.sh`; `.github/workflows/release-cli.yml`; `docks-kit`; `cli/src/main.ts`; `package.json`; `cli/scripts/generate-sot-payload.ts` | 10 | planned | `bash cli/build-binaries.sh linux-x64` exits 0 and `./cli/dist/docks-kit-linux-x64 --version` equals `package.json.version`. |
| 12 | Run the ordered acceptance inventory, generated-payload check, full CI gate, and both prove-red paths; inspect the final lock tree and diff for exact pins, only accepted help-golden changes, no EngineNative edits, and no unrelated dependency churn. | `package.json`; `bun.lock`; `docks-kit`; `cli/scripts/generate-sot-payload.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json`; `cli/src/engine-native/` | 1-11 | planned | A1-A10 satisfy their expected outcomes, only the characterized help rows changed, and no path under `cli/src/engine-native/` is modified. |

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
- Native v4 `--help` rendering is the sole output-format exemption.
- Do not change any non-help golden output. The only post-migration golden updates are the newly characterized `--help` and `update --help` rows; root, `--version`, every command invocation, and all existing cases remain behavior-preserving.
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
- Owner-authorized behavior boundary: "v4's native `--help` rendering is ACCEPTED. Help text is exempt from the behavior-preservation rule and its new output is recorded in goldens. `--version` is NOT exempt: it must keep printing the bare version string."
- Behavior preservation: except for the quoted help exemption, every public command's stdout, stderr, and exit code remains unchanged. The added public dry-run rows plus existing mutation invariants are the authoritative contract for the migrated parser path.
- Build preservation: `bun build --compile` must produce a working standalone binary whose `--version` exactly equals the bare `package.json.version`, so the `docks-kit` launcher's mismatch rejection remains effective.
- Launcher preservation: the one allowed launcher edit repoints the install sentinel to `node_modules/effect`; a second source-mode `./docks-kit --version` in a warm checkout must emit empty stderr.
- Payload preservation: `bun cli/scripts/generate-sot-payload.ts --check` must pass without regenerating unrelated bytes.
- Engine boundary: EngineNative remains ordinary TypeScript; every EngineNative sync step stays idempotent, the removed bash engine stays removed, and `DOCKS_KIT_ENGINE=bash` must continue to fail.
- Routing: repository guidance routes Effect 4 work to `effect-v4` from `effect-kit@docks`; the intentionally empty universal-skill manifest remains untouched.
- Validation order: characterize public paths first, upgrade Vitest, swap the dependency graph, repoint the launcher sentinel, migrate services, migrate runtime wiring, preserve bare version formatting, migrate commands and `-v` precedence, adapt tests/goldens, update docs, verify the binary, then run the full gate.

## STOP conditions

- STOP and revert the current boundary if any non-help public command output or any public stderr or exit code changes without an explicit requirement in this plan. Native v4 help text is the only output exemption.
- STOP if a newer beta appears during migration. Do not chase it silently; continue only with exact `4.0.0-beta.107` or return the plan for an explicit pin decision.
- STOP before dependency edits, or revert them if already applied, if any exact `@effect/*` package stops resolving a coherent peer set with exact Effect `4.0.0-beta.107` and Vitest `4.1.10`.
- STOP if the installed declarations contradict an API mapping in this plan. Record the declaration difference and revise the plan before inventing an adapter or cast.
- STOP if TypeScript `7.0.2` cannot typecheck the exact graph under the existing `cli/tsconfig.json`; do not weaken `strict`, enable emit, or use `skipLibCheck` as a substitute for fixing repository-owned types.
- STOP if any non-help golden row changes, either positive/prove-red golden contract fails, or the public `--version` row stops being the bare version. Regenerate only the characterized help rows to record the owner-accepted v4 rendering.
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
