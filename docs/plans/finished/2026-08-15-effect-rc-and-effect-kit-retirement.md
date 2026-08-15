---
plan_contract: v2
title: Pin Effect 4 RC and retire effect-kit plus effect-solutions
goal: docks-kit pins effect 4.0.0-rc.109 across its graph and ships no effect-kit plugin, effect-solutions tool, or verified-version gate flag.
status: finished
created: "2026-08-15T15:46:22.638+00:00"
updated: "2026-08-15T17:39:06.796+00:00"
assignee: null
---

## Goal

docks-kit pins effect 4.0.0-rc.109 across its graph and ships no effect-kit plugin, effect-solutions tool, or verified-version gate flag.

Three outcomes, one cutover:

1. `effect`, `@effect/platform-bun`, and `@effect/vitest` move from exact `4.0.0-beta.107` to exact `4.0.0-rc.109`. `vitest@4.1.10` stays.
2. `effect-kit@docks` disappears from the kit: SoT declarations, generated payload, deployed Claude settings key, and the deployed Codex plugin table.
3. `effect-solutions` disappears as a managed tool, and with it the verified-version gate it was the last consumer of: `ensure`, `gate`, `latestVersion`, `promptLine`, the `latest` probe surface, the `location` dependency-service method, and the public `--yes` flag.

Both stale Effect surfaces were owner-called: the `effect-v4` skill routing in `AGENTS.md` and `CLAUDE.md` pointed at a plugin the kit no longer wants, and the `effect-solutions` docs CLI has not been republished since 2026-04-29.

Mode: plan-and-implement

## Research

**Dependency graph, verified against the registry.** `rc` is the current dist-tag for all three packages at `4.0.0-rc.109` (`npm view effect dist-tags`, `npm view @effect/platform-bun dist-tags`, `npm view @effect/vitest dist-tags`). Peer ranges resolve on the pinned set: `@effect/platform-bun@4.0.0-rc.109` peers `effect: ^4.0.0-rc.109`, and `@effect/vitest@4.0.0-rc.109` peers `effect: ^4.0.0-rc.109` plus `vitest: >=4.1.0 <5.0.0`, which `vitest@4.1.10` satisfies. Upstream states the RC is a confidence statement with no further broad breaking changes planned and interfaces presumed final (<https://www.effect.website/blog/releases/effect/40-rc>).

**Hypothesis: the RC bump is a pin-only change for this repo. Confirmed.** A byte-level diff of the two published tarballs shows every declaration file this CLI imports is identical between `beta.107` and `rc.109`: `effect/dist/index.d.ts`, `effect/dist/unstable/cli/{Command,Argument,Flag,CliOutput,CliConfig,GlobalFlag}.d.ts`, and `@effect/platform-bun/dist/{BunRuntime,BunServices}.d.ts`. Nothing changed under `unstable/cli` at all — no added, removed, or changed files. The changed surface is elsewhere: `Context`, `Layer`, `Schema`, `SchemaError`, `Formatter`, and the dropped `uuid`/`kubernetes-types` runtime dependencies. Repo usage is limited to `Command`/`Argument`/`Flag`/`CliOutput`/`GlobalFlag`, `Effect`, `Layer`, `Console`, `Option`, `BunRuntime`/`BunServices`, the service tags in `cli/src/services.ts`, and `@effect/vitest` `it.effect` helpers, so no call site needs migration and the `effect-v3-to-v4` migration skill has nothing to act on here. Every kit-authored surface stays on `effect/unstable/cli`; `@effect/cli` and `@effect/platform` stay removed.

**effect-kit retirement surface.** Three live SoT declarations: `SoT/.claude/settings.json` `enabledPlugins."effect-kit@docks"`, the `SoT/.codex/config.toml` `[plugins."effect-kit@docks"]` table, and the `effect-kit` object in `SoT/.codex/plugins/marketplace.json`. All three are embedded in `cli/src/generated/sotPayload.ts` through `TEXT_PAYLOAD_PATHS` in `cli/scripts/generate-sot-payload.ts`, so regeneration is mandatory. Deployed-machine retirement has exact precedent for both tools: `claudeSync.ts REMOVED_MANIFEST.settingsKeys` already carries `enabledPlugins.session-relay@docks` and force-prunes it on every Claude sync, and `codexSync.ts RETIRED_PLUGIN_IDS` already carries `session-relay@docks`, which `removeRetiredPluginTables` strips from `~/.codex/config.toml` unconditionally. Plugin *uninstall* stays `--prune`-gated through the existing generic pass 5 in `claudeSync.ts syncPlugins`; Codex has no uninstall pass and needs none.

**effect-solutions was the last consumer of the verified-version gate. Confirmed by call-graph.** `toolchain.ts ensure` has exactly two call sites: `modes.ts modeToolchain` case `effect-solutions` and `skillsSync.ts syncEffectSolutionsCli`. The `bun` arm of `modeToolchain` calls `bunBootstrap` instead, and `bun.ts` reads its own `verified` pin without prompting; `claudeSync.ts syncLspServers` likewise pins from `field(ctx, tool, "verified")` directly. So after the tool is deleted, `ensure`, the private `gate`, `latestVersion`, `promptLine`, `InstallFn`, `deps.latest` (plus `latestNpm`, whose parameter type is literally `"effect-solutions"`), and `deps.location` (sole consumer `effectSolutionsInstall`) all become unreachable, and `ctx.assumeYes` loses its only reader at `toolchain.ts gate`. A `--yes` flag documented as "auto-accept toolchain prompts" that cannot affect any behavior is a lie in `--help`, so the durable fix is deleting the gate and the flag rather than leaving ~120 lines of unreachable code behind a no-op public flag. Owner decision, this session: delete the gate and `--yes`.

**`~/.local/bin/bun` link.** `skillsSync.ts effectSolutionsInstall` is the only creator of that symlink; it existed because the `effect-solutions` shebang is `#!/usr/bin/env bun`. No kit path depends on it: `install.sh` creates its own link, and both `docks-kit` and `install.sh` `find_bun` probe `${BUN_INSTALL:-$HOME/.bun}/bin/bun` and `$HOME/.bun/bin/bun` before `$HOME/.local/bin/bun`. Claude runtime hooks carry absolute Bun paths materialized by `claudeRuntime.ts`. It goes with the callback.

**What survives inside `deps.ts`.** `bun`'s own spec sets `locate` (`deps.ts` bun entry, returning `findBun(exec)?.path`), and `bun.ts bunBootstrap` reads it through `services.deps.path("bun")`, so `locate`, `resolveLocation`, `resolvePath`, and the `path` service method all stay. Only the service-level `location(id)` method is unreachable after the callback goes, and its `binDir` field had exactly one reader — `skillsSync.ts effectSolutionsInstall`. So `locate` narrows to a path-returning probe, `DependencyLocation` and `binDir` go, and `resolveLocation` folds into `resolvePath`. The `DependencyManager` interface that declares `path`, `location`, and `latest` is `cli/src/engine-native/services.ts`; `cli/src/services.ts` only wires Effect layers and needs no edit. `cli/test/unit/services.test.ts` declares a full `DependencyManager` stub including `location` and `latest`, so it changes with the interface.

**Artifact retirement on already-synced machines.** `REMOVED_MANIFEST.homeFiles` deletes home-relative files unconditionally on every Claude sync (`rmSync(path, { force: true })`, dry-run renders `[dry-run] rm <HOME>/...`), with `.local/bin/session-relay` as the worked precedent, so `.local/bin/effect-solutions` retires the same way. The kit has no mechanism to uninstall a Bun *global package* and this plan does not add one — owner decision, this session: prune the symlink only, and name `bun remove -g effect-solutions` in the changelog for the operator.

**Durable fix over temporary fix.** The durable fix deletes the dead gate, its flag, and both stale Effect surfaces in one cutover; the temporary fix it replaces would delete only the `effect-solutions` registry entry and leave an unreachable gate plus a no-op `--yes` flag documented in `README.md`, `cli/docs/flags.md`, and the `toolchain` docs topic.

**Golden and test blast radius, enumerated.** `cli/test/goldens/dryrun.json`: three `sync agents --dry-run` cases whose only output line is the effect-solutions status, plus the `--help` and `docs` listing cases. `cli/test/goldens/mutation.json`: 20 recorded `argvLog` values containing `plugin install effect-kit@docks` or `plugin add effect-kit@docks`, four `sync agents`/`sync stubs=git` argv logs containing `bun pm -g ls` and `npm view effect-solutions version`, five `toolchain ensure effect-solutions` cases including the `--yes` and above-verified-gate variants, and the `toolchain check` table row. Re-record with `--update-goldens` on both suites. `cli/test/lib/goldenMutationCatalog.ts` loses five rows and the `NPM_LATEST_ABOVE_VERIFIED` stub; `cli/test/lib/goldenResources.ts` loses the effect-solutions stub, its `npm view` and `bun pm -g` branches, and the `effect-kit@docks` entry in the installed-plugin inventory. Unit tests naming removed symbols or flags: `payload.test.ts`, `pluginRefresh.test.ts`, `deps.test.ts`, `toolchain.test.ts`, `engine-di.test.ts`, `modifierValidation.test.ts`, `skillsSync.test.ts`, `claudeMigration.test.ts`, and `argv.test.ts` (whose inline-value and duplicate-flag fixtures use `sync --yes` and must move to a surviving boolean). `cli/test/golden-mutation.ts` has one invalid-argv row asserting `flag --yes was given more than once`.

**`bun install` is a local step.** It mutates only `bun.lock` and `node_modules` in this checkout, and the `docks-kit` launcher already runs `bun install --frozen-lockfile` on its own when `node_modules/effect` is absent, so the registry read is not an external-environment effect.

**Dry-run cannot observe either retirement, so the proof is fixture-backed.** `codexSync.ts syncConfig` returns inside its `if (ctx.dryRun)` branch before `scrubDeprecatedFeatures` and `removeRetiredPluginTables` run, so no dry-run output can name a retired Codex table. Claude's key prune does render in dry-run as `[dry-run] del N stale key(s) from <path>`, but the count is aggregate and names no key. Retirement is therefore proven by seeded unit tests plus the mutation goldens, which execute real syncs against disposable fixture HOMEs and record child argv.

**The golden plugin stub becomes retirement evidence, deliberately.** `cli/test/lib/goldenResources.ts` reports `effect-kit@docks` as an installed user-scope plugin. That entry stays: once SoT stops declaring the plugin, `syncPlugins` pass 5 uninstalls it under `--prune`, so the re-recorded `fixture=home-drift cmd=sync --prune` argv log gains `claude plugin uninstall -y --scope user effect-kit@docks`, and `docks-kit plugins` renders it as `SOT absent / INSTALLED yes`. Both are expected recorded bytes; what must disappear from the goldens is every `plugin install effect-kit@docks` and `plugin add effect-kit@docks` line.

**`typecheck` cannot catch the leftovers, so the sweep is explicit.** `cli/tsconfig.json` sets `strict: true` but not `noUnusedLocals`, so an orphaned import or unreferenced private helper compiles clean. The exact casualty list, bound by reference search: `skillsSync.ts:10` `import { bunBootstrap } from "./bun"` (its only use was inside `effectSolutionsInstall`, so `skillsSync.ts` stops importing `bun.ts` entirely); `modes.ts:15` `effectSolutionsInstall` (but **not** `modes.ts:14` `bunBootstrap`, which the surviving `bun` toolchain arm still calls at line 147); `deps.ts` `DependencyLocation`, `locateEffectSolutions`, `latestNpm`, `resolveLocation`; `services.ts:12,16` the matching value and type imports; `toolchain.ts:86-88` `latestVersion`. `claudeSync.ts:18` keeps its own `bunBootstrap` import for the runtime cutover.

**`locate` dies entirely rather than narrowing.** `effect-solutions` is the only `DEPENDENCIES` entry carrying a `locate` field, so once it goes the whole capability is unreachable: both `locate` declarations, the `spec()` passthrough, and `resolveLocation`. `resolvePath` currently returns `(await resolveLocation(...)).path`; it becomes a direct `resolveDependency` read, which is what `bun.ts` needs from `deps.path`.

**The nine `--yes` declaration sites, bound.** Raw parse and help text: `parseArgs.ts:138` (the help line, which the dry-run goldens record verbatim) and `parseArgs.ts:264-266`. Env seed: `index.ts:143` `ASSUME_YES`. Effect CLI surface: `sync.ts:55-57` `Flag.boolean("yes")`, `sync.ts:105` in the command's flag record, `sync.ts:131` in the argv relay; `toolchain.ts:15-17`, `toolchain.ts:23`, `toolchain.ts:26` in the relayed `flags` array, and `toolchain.ts:44` in the `Command.withDescription` text. Because `parseArgs.ts:138` is recorded help output, deleting the flag forces the golden re-record — which is why `step:rerecord_goldens` depends on `step:update_tests`, and `step:update_tests` on `step:delete_verified_gate`, rather than the three running in parallel.

## Steps

| # | Id | Task | Files | Depends | Effect | Status | Done when |
|---:|---|---|---|---|---|---|---|
| 1 | pin_rc_graph | Bump the three Effect pins from exact `4.0.0-beta.107` to exact `4.0.0-rc.109`, keep `vitest@4.1.10`, and refresh the lockfile with `bun install` | package.json, bun.lock | — | `local` | `done` | `bun pm ls` reports `effect@4.0.0-rc.109`, `@effect/platform-bun@4.0.0-rc.109`, `@effect/vitest@4.0.0-rc.109`, and `bun run typecheck` exits 0 |
| 2 | drop_effect_kit_sot | Delete the three `effect-kit` SoT declarations and regenerate the embedded payload with `bun cli/scripts/generate-sot-payload.ts` | SoT/.claude/settings.json, SoT/.codex/config.toml, SoT/.codex/plugins/marketplace.json, cli/src/generated/sotPayload.ts, docks-kit, install.sh | — | `local` | `done` | `bun run check:generated` exits 0 and no SoT or generated file names `effect-kit` |
| 3 | retire_deployed_plugin | Retire the deployed plugin on already-synced machines: add `enabledPlugins.effect-kit@docks` to `REMOVED_MANIFEST.settingsKeys` and `effect-kit@docks` to `RETIRED_PLUGIN_IDS` | cli/src/engine-native/claudeSync.ts, cli/src/engine-native/codexSync.ts | 2 | `local` | `done` | Seeded unit tests prove both transforms: `codexRetiredPlugins.test.ts` strips a `[plugins."effect-kit@docks"]` table between surviving tables, and a Claude settings test prunes `enabledPlugins.effect-kit@docks` from a deployed settings fixture |
| 4 | strip_effect_solutions | Delete the managed tool end to end: `ToolId` member, `resolveEffectSolutions`, `versionEffectSolutions`, `locateEffectSolutions`, `latestNpm`, the `DEPENDENCIES` entry, the `installedVersion` arm, the `modeToolchain` arm and its diagnostic, `MANAGED` entry, `effectSolutionsInstall`, `syncEffectSolutionsCli`, the `~/.local/bin/bun` link, the `SoT/toolchain.json` entry and stale bun note; add `.local/bin/effect-solutions` to `REMOVED_MANIFEST.homeFiles` | cli/src/engine-native/deps.ts, cli/src/engine-native/toolchain.ts, cli/src/engine-native/modes.ts, cli/src/engine-native/skillsSync.ts, cli/src/engine-native/claudeSync.ts, cli/src/commands/toolchain.ts, SoT/toolchain.json, cli/src/generated/sotPayload.ts | 2 | `local` | `done` | `bun run typecheck` exits 0, `bun run check:generated` exits 0, and no file under `cli/src` or `SoT` names `effect-solutions` |
| 5 | delete_verified_gate | Delete the now-unreachable gate and its public flag: `ensure`, `gate`, `latestVersion`, `promptLine`, `InstallFn`, the `latest` and `locate` spec fields with `resolveLocation`, `deps.latest`, `deps.location`, `DependencyLocation` and its `binDir` (rewrite `resolvePath` as a direct `resolveDependency` read, keeping `deps.path` for `bun.ts`), `ctx.assumeYes`, the `ASSUME_YES` env row, `--yes` on `sync` and `toolchain`, both usage strings, the `toolchain` command description, the `docs` topic summary, and the `policy: track` vocabulary in the manifest comment | cli/src/engine-native/toolchain.ts, cli/src/engine-native/deps.ts, cli/src/engine-native/services.ts, cli/src/engine-native/index.ts, cli/src/engine-native/modes.ts, cli/src/engine-native/parseArgs.ts, cli/src/commands/sync.ts, cli/src/commands/toolchain.ts, cli/src/commands/docs.ts, SoT/toolchain.json, cli/src/generated/sotPayload.ts | 4 | `local` | `done` | `bun run typecheck` exits 0, `./docks-kit sync --dry-run --yes` exits 2 with an unknown-flag error, and the dead-symbol sweep in `## Research` finds no surviving reference |
| 6 | update_tests | Rewrite every unit test, golden stub, and catalog row that names a removed symbol, tool, plugin, or flag: drop `assumeYes` from every `Ctx` literal, drop `location`/`latest` from the `DependencyManager` stub, flip the `codexRetiredPlugins` expectation so the `effect-kit` table is stripped, move the `argv` inline-value and duplicate-flag fixtures to a surviving boolean, and drop the `NPM_LATEST_ABOVE_VERIFIED` stub with the five effect-solutions catalog rows | cli/test/unit/payload.test.ts, cli/test/unit/pluginRefresh.test.ts, cli/test/unit/deps.test.ts, cli/test/unit/toolchain.test.ts, cli/test/unit/engine-di.test.ts, cli/test/unit/modifierValidation.test.ts, cli/test/unit/skillsSync.test.ts, cli/test/unit/claudeMigration.test.ts, cli/test/unit/argv.test.ts, cli/test/unit/services.test.ts, cli/test/unit/bun.test.ts, cli/test/unit/codexTomlMerge.test.ts, cli/test/unit/codexRetiredPlugins.test.ts, cli/test/lib/goldenMutationCatalog.ts, cli/test/lib/goldenResources.ts, cli/test/golden-mutation.ts | 3, 4, 5 | `local` | `done` | `bun run test:unit` exits 0 with 0 failing |
| 7 | rerecord_goldens | Re-record both golden suites with `--update-goldens`, then read the recorded bytes: no `effect-solutions`, no `--yes` case, and no `plugin install effect-kit@docks` or `plugin add effect-kit@docks`, while the `--prune` uninstall line and the `SOT absent` plugins row are expected | cli/test/goldens/dryrun.json, cli/test/goldens/mutation.json | 6 | `local` | `done` | `bun run golden:dryrun` and `bun run golden:mutation` both exit 0, and the `--prune` argv log records `claude plugin uninstall -y --scope user effect-kit@docks` |
| 8 | refresh_docs | Update every live prose surface: the four `Effect 4 beta` sites (`README.md:55,115`, `AGENTS.md:24`, `cli/docs/overview.md:19`) plus the RC version strings, Effect skill routing, plugin inventory, toolchain tool list and gate semantics, the two flag tables that map `--yes` to `ctx.assumeYes`, `toolchain-context`'s CSO description naming `--yes behavior`, sync-layer and DESIGN ownership lines, and the bootstrap agent twins; bump `metadata.updated` and re-check the single coarse `metadata.source_files[].lines` range on each touched skill, because the ranges shift when the modules shrink; add one new changelog entry naming `bun remove -g effect-solutions` for operators | README.md, AGENTS.md, CLAUDE.md, CHANGELOG.md, cli/docs/overview.md, cli/docs/flags.md, cli/docs/install.md, cli/docs/sync-layers.md, cli/docs/toolchain.md, cli/src/engine-native/DESIGN.md, .claude/skills/toolchain-context/SKILL.md, .claude/skills/universal-skills-context/SKILL.md, .claude/skills/sync-orchestration-context/SKILL.md, .claude/skills/sync-orchestration-context/references/dispatch-flow.md, .claude/skills/sync-orchestration-context/references/flag-matrix.md, .claude/agents/skills-bootstrap-agent.md, .codex/agents/skills-bootstrap-agent.toml | 5, 7 | `local` | `done` | Outside `CHANGELOG.md` history and the `npx --yes` argv exemptions, no live doc, skill, or agent file names `effect-solutions`, `beta.107`, the removed `--yes` flag, or `effect-kit` as an enabled plugin |
| 9 | full_gate | Run the release gate and the real dry-run smoke against this machine's home | package.json | 7, 8 | `local` | `done` | Every `## Acceptance` row passes and its real output is pasted into `## Verification Results` |

## Acceptance

| ID | Command | Expected |
|---|---|---|
| A1 | `bun run check:generated` | Exit 0 |
| A2 | `bun run typecheck` | Exit 0 |
| A3 | `bun run test:unit` | Exit 0, 0 failing |
| A4 | `bun run golden:dryrun` | Exit 0 |
| A5 | `bun run golden:mutation` | Exit 0 |
| A6 | `bun cli/test/golden-dryrun.ts --prove-red` | Exit 1 with a `prove-red OK` line |
| A7 | `bun cli/test/golden-mutation.ts --prove-red` | Exit 1 with a `prove-red OK` line |
| A8 | `bun run test:runtime:posix` | Exit 0 |
| A9 | `./docks-kit sync --dry-run` | Exit 0, no `effect-solutions` line |
| A10 | `./docks-kit sync --dry-run --yes` | Exit 2 with an unknown-flag error; a surviving flag would only dry-run, never mutate |
| A11 | `bun pm ls` | Lists `effect@4.0.0-rc.109`, `@effect/platform-bun@4.0.0-rc.109`, `@effect/vitest@4.0.0-rc.109`, and `vitest@4.1.10` |

## Do not touch

- `docs/plans/finished/**` — historical records, byte-frozen. Several name the beta pins, `effect-kit@docks`, and `effect-solutions`.
- Existing `CHANGELOG.md` entries. Add a new entry; never rewrite a shipped one.
- The `npx --yes ...` argv in `cli/src/engine-native/skillsSync.ts` and its three documented copies (`.claude/skills/universal-skills-context/SKILL.md:69`, `references/cli-arg-trap.md:11-12,31`) — that is npx's own flag, unrelated to the kit flag being deleted.
- `bun` and `skills-cli` entries in `SoT/toolchain.json`, `bun.ts bunBootstrap`, and the `field` helper: all keep independent consumers.
- `docks@docks` and `plan-lifecycle@docks` in all three SoT surfaces, and `RETIRED_PLUGIN_IDS`' existing `session-relay@docks` entry.
- `vitest@4.1.10`, `typescript@7.0.2`, and the removed-and-staying-removed `@effect/cli` / `@effect/platform`.
- Deployed user config under the real home: verification uses `--dry-run` only.
- Claude plugin uninstall gating: it stays behind `--prune`.

## Open questions

None

## Review

### Plan review — 2026-08-15
Plan-review: repair
- [goal_fit] `## Steps` rows 6 and 8; `cli/test/unit/bun.test.ts`, `cli/test/unit/codexTomlMerge.test.ts`, `cli/test/unit/codexRetiredPlugins.test.ts`, `.claude/skills/sync-orchestration-context/SKILL.md`, and `.claude/skills/sync-orchestration-context/references/flag-matrix.md` — the declared `Files` union omits three tests that must lose `assumeYes`, `latest`/`location`, or the surviving `effect-kit` expectation, plus two shipped skill docs that still advertise `--yes`/`ctx.assumeYes`, so the cutover cannot compile and still ships the removed flag vocabulary — add those files to rows 6 and 8 and update them in the same cutover
- [research_gap] `## Steps` row 3 Done when and `## Acceptance` A9; `cli/src/engine-native/codexSync.ts` `syncConfig` and `cli/src/engine-native/claudeSync.ts` `syncPlugins` — dry-run returns before Codex retired-table processing and before Claude plugin reconciliation, so row 3 cannot report the retired Codex table and A9's absence of an `effect-kit@docks` plugin line passes whether or not the plugin remains in SoT — verify retirement with fixture-backed tests that seed the stale Claude key and Codex table and assert both transforms, or explicitly add equivalent dry-run inspection
- [research_gap] `## Acceptance` A1–A10; `package.json` dependency pins and scripts — none of the ten rows checks the installed dependency graph or exact manifest/lock versions, so the old `4.0.0-beta.107` graph can satisfy the whole table — add a repository-root acceptance command that asserts `bun pm ls` contains the three exact `4.0.0-rc.109` packages and `vitest@4.1.10`
- [security_risk] `## Acceptance` A10 and `## Do not touch`; `cli/src/commands/sync.ts` `syncCommand` — if the flag-removal change is wrong, `./docks-kit sync --yes` is accepted and performs a real sync (including the non-dry-run update fetch and retirement mutations) against the user's home, contradicting the dry-run-only boundary — use `./docks-kit sync --dry-run --yes`, which still proves `--yes` is unknown but remains non-mutating on failure

Disposition — all four findings reproduced and fixed:
- Finding 1: `bun.test.ts:95` and `codexTomlMerge.test.ts:45` carry `assumeYes: false`; `codexRetiredPlugins.test.ts:12,19` asserts the `effect-kit` table survives; `sync-orchestration-context/SKILL.md:93` and `references/flag-matrix.md:33` map `--yes` to `ctx.assumeYes`. All five added to `## Steps` rows 6 and 8.
- Finding 2: `codexSync.ts syncConfig` returns at its `ctx.dryRun` branch before `removeRetiredPluginTables`. Row 3's proof is now seeded unit tests, `## Research` records the dry-run limit, and the golden plugin stub is kept so the `--prune` uninstall line becomes recorded retirement evidence.
- Finding 3: added `A11` asserting the exact `bun pm ls` graph.
- Finding 4: `A10` is now `./docks-kit sync --dry-run --yes`, which cannot mutate even when the flag survives.

### Code review round 1 — 2026-08-15
Code-review: fixes-required
- [HIGH] `cli/test/goldens/mutation.json`; `cli/test/lib/goldenExecution.ts` — the re-recorded snapshots dropped the Linux-only `bwrap` probe and report row, so the Ubuntu release gate would fail — make golden platform selection deterministic, then re-record
- [MEDIUM] `cli/src/engine-native/modes.ts modeToolchain` — `--verbose` is documented as printing no-op confirmations, but deleting the gate left the one managed tool silent — emit a Bun-present confirmation or remove the promise
- [LOW] `.claude/skills/settings-merge-context/SKILL.md` — states `homeFiles` holds only `.local/bin/session-relay`, now stale against the manifest — describe the entries generically
- [LOW] `CHANGELOG.md` — says "three pre-existing test defects" while describing four — correct the count
- [LOW] `cli/docs/sync-layers.md` — the removed-artifact step names one retired home command — cover every manifest-listed entry

Disposition — all five reproduced and fixed. The HIGH was understated: the
snapshots were already Linux-recorded and could never pass from macOS, proven at
`HEAD` in a detached worktree. Fixed by the platform pin in out-of-plan fix 5.
The MEDIUM was self-inflicted by this cutover; the restored confirmation is
recorded above.

### Code review round 2 — 2026-08-15
Code-review: fixes-required
- [MAJOR] `cli/test/lib/goldenExecution.ts runPublicCli` — builds its own Bun command and so skips the new preload, leaving public-CLI invariants and `cli/test/unit/toolchain.test.ts` host-dependent — route both spawn paths through one helper
- [LOW] `cli/src/engine-native/modes.ts modeToolchain` — an unreadable version probe renders `bun up to date ()` — fall back to the doctor table's `unknown` vocabulary
- [LOW] `.claude/skills/settings-merge-context/SKILL.md` — body changed without bumping `metadata.updated` — bump it
- [LOW] `CHANGELOG.md`; `## Verification Results` — both claim all golden runs preload the shim, contradicted by `runPublicCli` — narrow or widen the claim

Disposition — all four fixed. Round 2 also confirmed golden diff integrity and
the restored verbose leg. Both spawn paths now share `bunCliInvocation`; verified
on this macOS host, where the shim prints `linux` and `toolchain check` through
the public CLI emits one `bwrap` row with the pin and none without. This
repository ships no skill validator, so the metadata bump had nothing to run.

### Code review round 3 — 2026-08-15
Code-review: pass

Verified every spawn under `cli/test/`, classifying each as preloaded or
deliberately host-real, and confirmed the raw invocation, the empty-version
branch, and the record's accuracy. No findings.

## Verification Results

All eleven acceptance rows pass. Captured 2026-08-15 on darwin arm64.

| ID | Result |
|---|---|
| A1 | `bun run check:generated` exit 0 |
| A2 | `bun run typecheck` exit 0 (`tsc --noEmit -p cli`) |
| A3 | `bun run test:unit` exit 0 — `Test Files 38 passed (38)`, `Tests 321 passed (321)` |
| A4 | `bun run golden:dryrun` exit 0 — `golden-dryrun: OK (36 case(s))` |
| A5 | `bun run golden:mutation` exit 0 — `golden-mutation: OK (59 case(s))` |
| A6 | exit 1 — `prove-red OK: golden-dryrun compared 36 case(s) and detected 36 planted comparator mismatch(es); intentionally exiting 1` |
| A7 | exit 1 — `prove-red OK: golden-mutation compared 59 case(s) and detected 56 planted comparator mismatch(es); intentionally exiting 1` |
| A8 | `bun run test:runtime:posix` exit 0 — direct Bun p95 31.06ms (ceiling 100ms), posix median 37.50ms (ceiling 250ms) |
| A9 | `./docks-kit sync --dry-run` exit 0, no `effect-solutions` toolchain line |
| A10 | `./docks-kit sync --dry-run --yes` exit 2 — `unknown flag --yes for 'sync'` |
| A11 | `bun pm ls` lists `effect@4.0.0-rc.109`, `@effect/platform-bun@4.0.0-rc.109`, `@effect/vitest@4.0.0-rc.109`, `vitest@4.1.10` |

`bun run test:ci` passes end to end, re-run after the final documentation edits.

### Retirement evidence

The `--prune` mutation golden now records `claude plugin uninstall -y --scope
user effect-kit@docks`. The seeded `home-drift` fixture was required: `syncPlugins`
reads `~/.claude/plugins/installed_plugins.json`, not the `claude plugin list`
stub, so the plugin had to exist there as a user-scope record for the uninstall
path to run at all. Every `plugin install effect-kit@docks` line disappeared from
the recorded argv logs.

Against this machine's real home, `./docks-kit sync --dry-run` reports
`del 1 stale key(s)` — confirmed to be `enabledPlugins.effect-kit@docks` — and
`rm ~/.local/bin/effect-solutions`. That symlink is kit-created and
points at `~/.bun/bin/effect-solutions`, which stays on PATH, so withdrawing it
does not break the operator's own install.

### Dead-symbol sweep

Searched surface: `cli/`, `SoT/`, `README.md`, `AGENTS.md`, `CLAUDE.md`,
`.claude/`, `.codex/`, `install.sh`, `docks-kit`. Deliberately excluded, because
both must name what was removed: `CHANGELOG.md` and `docs/plans/**`, where
`finished/` is byte-frozen and the new changelog entry describes the RC bump and
both retirements by name.

Across that surface, `beta.107`, `assumeYes`, `ASSUME_YES`, `latestVersion`,
`promptLine`, `resolveLocation`, `DependencyLocation`, and `InstallFn` return
zero matches. Two stale `ASSUME_YES` rows in the environment-isolation arrays of
`engine-di.test.ts` and `modifierValidation.test.ts` were found by this sweep
and deleted.

`effect-kit` and `effect-solutions` remain in seven files on that surface, all
retirement machinery or the tests that prove it fires: `codexSync.ts
RETIRED_PLUGIN_IDS`, `claudeSync.ts REMOVED_MANIFEST.settingsKeys` and
`REMOVED_MANIFEST.homeFiles`, `claudeMigration.test.ts` (settings-key prune),
`codexRetiredPlugins.test.ts` (Codex table strip), the retained `claude plugin
list` stub in `goldenResources.ts`, the seeded `home-drift` installed-plugins
fixture, and the recorded `--prune` uninstall in `goldens/mutation.json`.
The `npx --yes` argv and its documented copies are untouched.

### Out-of-plan fixes

Five pre-existing defects blocked the gate and were repaired. None were caused
by this cutover; all five reproduce on a clean checkout of `main`.

1. `install.test.ts` inherited the developer's real `BUN_INSTALL`. `find_bun`
   probes `$BUN_INSTALL/bin/bun` before `$HOME/.bun`, so the pin case resolved a
   Bun outside its sandbox, skipped the bootstrap branch entirely, and never
   recorded the installer argument. Worse, it then ran `bun add -g
   docks-kit@latest` against the real global install. Both fixtures now pin
   `BUN_INSTALL` inside the temporary root.
2. The same fixture symlinked `/bin/<cmd>` for its PATH, but macOS has no
   `/bin/mktemp`, leaving a dangling link. Coreutils are now resolved by probing
   `/bin`, `/usr/bin`, and `/usr/local/bin`.
3. `toolchain.test.ts` spawns the real public CLI and exceeded Vitest's 5s
   default under full-suite parallel load (6.2s observed, 1.3s in isolation).
   Both cases now carry an explicit 30s budget; no assertion changed.
4. The mutation golden harness isolated Bun's package cache with
   `BUN_INSTALL_CACHE_DIR` but not its runtime transpiler cache, which Bun drops
   in `$HOME/Library/Caches/bun/@t@/*.pile` for sources over 50 KB. The fake
   HOME is tree-diffed, so those pile files entered the snapshot and keyed every
   golden to the current bytes of the generated `sotPayload.ts`: regenerating
   the payload turned all 59 cases red at once. `goldenExecution.ts runEnv` now
   also redirects `BUN_RUNTIME_TRANSPILER_CACHE_PATH` to a temp dir, mirroring
   the package-cache precedent, and the re-recorded goldens hold zero cache
   entries against 14,396 before. The defect was latent at `HEAD` only because
   no payload change had followed the last recording.
5. The golden snapshots were host-dependent and therefore unverifiable from
   macOS. `toolchain.ts report` skips tools whose manifest `os` does not match
   the host, and `bwrap` is the one `os: linux` entry, so a macOS run drops it
   from the report table and from the probe argv order. The committed snapshots
   were Linux-recorded, so re-recording here silently rewrote them to macOS
   shape and would have broken the Ubuntu release gate. Both spawn paths now
   share one `bunCliInvocation` helper carrying
   `--preload cli/test/lib/goldenPlatform.ts`, a test-only shim that pins
   `process.platform`, so the raw-engine snapshot runs and the public-CLI
   invariant and unit runs agree; production code gains no OS override. Proven
   in a detached `git worktree` at `HEAD`: with only the two harness fixes
   applied and no source change, the untouched Linux-recorded goldens went from
   64 failures to `OK (64 case(s))` on this macOS host.

One behavior regression this cutover introduced was also repaired.
`--verbose` is documented as printing no-op confirmations, and the deleted gate
held the only toolchain instance of one. `modeToolchain` now probes before
bootstrapping and emits `bun up to date (<version>)` for the already-installed
case, so the flag is truthful on the one managed tool. `engine-di.test.ts`
covers it beside the existing model leg, asserting silence without the flag.

`cli/src/engine-native/DESIGN.md` also carried three stale module-ownership rows
naming the removed tool and gate; corrected.
