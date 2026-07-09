---
title: CLI log UX overhaul — verbosity discipline + Effect services (SOLID)
goal: Default runs print only actual changes, actionable warnings with install hints, and the summary; operations report changed/unchanged and no-op confirmations move behind --verbose via injected Logger/DependencyManager/Platform services.
status: ongoing
created: "2026-07-09T16:04:45-03:00"
updated: "2026-07-09T18:20:00-03:00"
started_at: "2026-07-09T16:29:36-03:00"
assignee: null
tags: [cli, ux, logging, effect, solid]
affected_paths:
  - cli/src/engine-native/output.ts
  - cli/src/engine-native/logger.ts
  - cli/src/engine-native/deps.ts
  - cli/src/engine-native/os.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/models.ts
  - cli/src/engine-native/claudeModel.ts
  - cli/src/engine-native/codexToml.ts
  - cli/src/engine-native/DESIGN.md
  - cli/src/engine.ts
  - cli/src/main.ts
  - cli/src/commands/sync.ts
  - cli/src/commands/model.ts
  - cli/src/commands/toolchain.ts
  - cli/src/commands/status.ts
  - cli/test/lib/harness.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/
  - cli/docs/flags.md
  - cli/docs/overview.md
  - CHANGELOG.md
related_plans: []
review_status: null
---

## Goal

A default `docks-kit sync` (and `toolchain`/`model`) run reads like a change report, not a transcript: lines appear only for **operations that actually changed something**, **things that are wrong or missing** (with the exact command to fix them), and the **final summary**. This requires a real change-detection contract — engine operations return/report `changed: boolean` (several today rewrite files unconditionally even when the result is identical) — plus a typed logging policy delivered through injected services with SOLID boundaries: a `Logger` (leveled, injectable, explicit filtering), a `DependencyManager` (single home for probe/version/install-hint per external tool), and a narrow `Platform` capability service. Status-quo confirmations ("already in sync", "present (vX)", "up to date", "left as-is") move behind `--verbose`.

## Context

- User decision (verbatim, 2026-07-09): "we get too many logs when running a command … we even log things like 'success ok already downloaded' which for the user isn't relevant, he would want like a warning when something isn't installed and how to install [it]". Also requested: Effect TS, a dependency manager, an OS manager ("maybe"), SOLID compliance.
- The CLI is Effect at the rim (`@effect/cli` 0.75.2, `effect` 3.21.4, `@effect/platform-bun`), but `cli/src/engine-native/` is imperative sync TypeScript writing ANSI lines directly to `process.stderr` through three unconditional module-scope functions in `output.ts`. No verbosity control exists anywhere.
- ~51 `log()` call sites across the engine (25 claudeSync, 11 skillsSync, 10 codexSync, 3 toolchain, 1 codexToml, 1 claudeModel — re-derive: `grep -rc "log(" cli/src/engine-native/*.ts`); a large fraction are no-op confirmations (full inventory = Step 1).
- Several operations rewrite deployed files unconditionally on repeat runs (settings merge, backups, plugin refresh, model setters writing an already-equal value) — "log only on change" therefore needs per-operation changed/unchanged results, not message reclassification alone.
- Missing-dependency messaging is inconsistent and duplicated: the git install hint is byte-identical in `claudeSync.ts` and `codexSync.ts`; probing is split across `toolchain.ts` (managed tools), `skillsSync.ts` (agent-browser, Chrome, bun helpers), and both sync pipelines (git).
- `process.platform` branching is scattered across 6+ engine files instead of one seam.
- **Design decisions (pre-resolved with the 2026-07-09 cross-check, see Notes):**
  - The logger is an **injected synchronous interface with its own explicit level filtering** writing to stderr, plus a separate stdout data writer. Effect's `Logger.minimumLogLevel` fiber-level filtering only governs `Effect.log*` events and cannot filter direct writes from sync engine code — it is NOT the mechanism here. `data` is a channel, not a log level.
  - Services are **interface-first `Context.Tag`s with named `Layer.succeed` live layers** (and test layers). `Effect.Service` is experimental in pinned effect 3.21.4 and these services explicitly need live + deterministic test implementations.
  - **One composed live Layer at `cli/src/main.ts`**; the `engine.ts` seam obtains services once and passes plain synchronous interfaces into EngineNative. The harness-private `native-raw` entry (bypasses `engine.ts`) and the `engineCapture` child construct the same live implementations via one shared factory — no scattered `ManagedRuntime`/`provide` calls.
  - **Dry-run output is a complete inspection report**: `[dry-run]` data lines stay on stdout, unfiltered, at every verbosity. Verbosity filtering applies to stderr logs on non-dry runs. (Keeps the dry-run golden mostly stable and dry-run semantics honest.)
  - No `debug` level in this plan — argv tracing is out of scope until it has a trigger, producer, and test.
- Hard constraint: **golden regression is the engine contract** (`cli/src/engine-native/DESIGN.md`): `--update-goldens` is review-gated; intentional output changes update goldens in the same reviewed diff; `--prove-red` stays red. Note the current harness **merges stderr into stdout** (`exec 2>&1`, `cli/test/lib/harness.ts`) — it cannot catch channel violations, so Step 4 upgrades it before call sites migrate.
- Hard constraint: stdout is data (`echo`, dry-run lines, `status --json`), stderr is logs; `engineCapture` (`cli/src/engine.ts`) re-spawns a child to capture stdout with stderr passthrough. The logger never writes to stdout.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Audit**: one artifact — a `### Audit inventory` section appended under `## Notes` of THIS plan — with one row per `log`/`warn`/`err`/`echo` call site in `cli/src/engine-native/` (file:line, message, classification: `change` / `no-op confirmation` / `warning` / `data` / `summary`, and whether the emitting operation can detect changed/unchanged today) plus one row per external-tool probe/install-hint site. Done-condition: `grep -rn "\b\(log\|warn\|err\|echo\)(" cli/src/engine-native --include="*.ts" | wc -l` equals the row count (zero omissions). | — | done |
| 2 | **Policy spec** in `cli/src/engine-native/DESIGN.md`: (a) method-to-channel table — `change`/`warn`/`error` → stderr always visible; `verbose` → stderr only with verbosity on; `data`/dry-run/summary → stdout always; pin prefixes and ANSI codes; (b) the change-detection contract — every mutating operation reports `changed: boolean` and unchanged outcomes log at `verbose`; (c) missing-dep warns MUST carry the platform-correct install command; (d) the default summary schema per `sync`/`model`/`toolchain` and the rule that next-step blocks print only when a relevant change occurred or verbosity is on; (e) flags: `--verbose`/`-v` on `sync`, `model`, `toolchain` command surfaces + `DOCKS_KIT_VERBOSE=1` for the raw channel. | 1 | done |
| 3 | **Research gate**: confirm the pre-resolved Effect idioms against current effect 3.21 docs (`Context.Tag` + `Layer.succeed`, Layer composition at the Bun CLI entry, why not `Logger.minimumLogLevel` here) using the effect-ts-specialist skill + current docs; record confirmations/corrections in `## Notes` before writing service code. | — | done |
| 4 | **Harness upgrade (test-first)**: extend `cli/test/lib/harness.ts` to capture stdout and stderr separately (keeping a merged view for existing goldens during migration); add channel assertions (`status --json` stdout must `JSON.parse`; dry-run stdout with verbose stderr noise present); add a sequential same-HOME replay case (run sync twice, second run's default stderr contains only warns + summary trigger lines); add public-CLI integration cases for `--verbose` and `-v` on all three command surfaces and `DOCKS_KIT_VERBOSE=1` on the raw channel. Prove-red discipline: `bun cli/test/golden-dryrun.ts --prove-red` and `bun cli/test/golden-mutation.ts --prove-red` must each print `prove-red OK` and exit non-zero, before and after. | 2 | done |
| 5 | **Tier 1 — Logger + change detection + reclassification**: add `cli/src/engine-native/logger.ts` (`Logger` interface: `change/warn/error/verbose` → stderr, level-filtered; `data` writer → stdout); `output.ts` becomes a thin shim then is deleted once call sites migrate. Give mutating operations changed/unchanged results per the Step-1 audit column; reclassify every call site (no-op → `verbose`, real change → `change`, missing-dep warns gain hints); thread verbosity `parseArgs.ts → Ctx`. Update BOTH goldens in the same commit; golden matrix rows for default + verbose. | 3, 4 | done |
| 6 | **Tier 2 — DependencyManager** (`cli/src/engine-native/deps.ts`): typed contract — `ToolId` union (git, claude, codex, rtk, bun, npx, agent-browser, chrome-for-testing, LSP binaries); `DependencySpec { id, requirement: "required" \| "optional", probe, versionCmd, installHint(platform) }`; `ProbeResult = present(version?) \| missing \| broken(reason)`. Required-missing stays a hint-bearing error preserving today's exit codes; optional-missing = exactly one deduplicated `[warn] <tool> not installed — <install command>` per run. `SoT/toolchain.json` remains the single source of version/pin policy — `toolchain.ts` keeps gate/ensure orchestration and consumes the manager for probe/hint; the duplicated git hint collapses to one definition. | 5 | planned |
| 7 | **Tier 3 — Platform service** (`cli/src/engine-native/os.ts`): narrow capability seam — `platform()` (`linux/darwin/windows`), package-manager style for hints (winget/brew/apt-style wording only; per-tool package identifiers stay in `DependencySpec`), shell-rc applicability; symlink stays try-then-fallback (capability/error-driven, not platform-predicted). Scattered `process.platform` branches in sync modules route through it; pure path/exec helpers in `exec.ts` are exempt and listed in the policy spec. | 6 | planned |
| 8 | **Effect integration at the rim**: define `Context.Tag`s + live `Layer.succeed` layers for Logger/DependencyManager/Platform built from one shared factory; compose once at `cli/src/main.ts` and hand sync interfaces through the `engine.ts` seam; `native-raw` and `engineCapture` call the same factory directly. Test layers demonstrated in one unit test per service. | 5, 6, 7 | planned |
| 9 | **Verify + docs**: full suite green (`bun run test:unit`, `bun run golden:dryrun`, `bun run golden:mutation`, both prove-red legs `prove-red OK` + non-zero exit, `bun run typecheck`); manual smoke: first sync on a fresh fixture HOME shows changes + warns with hints, immediate re-run's default stderr shows warns/summary only; update `cli/docs/flags.md` + `cli/docs/overview.md`; CHANGELOG entry. | 5–8 | planned |

## Acceptance criteria

- [ ] Same-HOME replay golden case: second consecutive `sync` run at default verbosity emits **zero** stderr lines matching `already in sync|already initialized|already set|up to date|\bpresent \(|left as-is` (refined from the draft regex — a loose `already` false-positives on change lines embedding count phrasing like "(+1 new, 0 already present)"); the same run with `--verbose` emits them. Verify: the Step-4 replay case asserts both.
- [ ] Channel contract enforced by tests: `status --json` stdout parses as JSON with verbose logging enabled; logger writes are stderr-only. Verify: Step-4 channel assertions fail if violated (prove: temporarily point one logger write at stdout → suite goes red; revert).
- [ ] Missing git (via harness `maskTools: ["git"]`, separate Claude-only / Codex-only / combined-sync cases): exactly one deduplicated `[warn] git not installed — <platform-correct command>` per run in the combined case, sourced from `DependencyManager`; win32 hint covered by a unit test.
- [ ] `grep -rn "winget install Git.Git" cli/src` → exactly one definition site.
- [ ] `grep -rn "process.platform" cli/src/engine-native --include="*.ts"` → matches only in `os.ts` + the exec-helper exemptions named in the policy spec.
- [ ] Public flags work end-to-end: `--verbose` and `-v` accepted on `sync`, `model`, `toolchain`; `DOCKS_KIT_VERBOSE=1` on the raw channel — each covered by a Step-4 integration case.
- [ ] `bun run test:unit && bun run golden:dryrun && bun run golden:mutation` green; both `--prove-red` legs print `prove-red OK` and exit non-zero; goldens change only in commits that also change engine output, per tier (each output-changing tier = one reviewed commit with its golden diff).
- [ ] `bun run typecheck` green; services are `Context.Tag`s with named live + test layers; no `any` seams.
- [ ] Dry-run stdout remains a complete inspection report (unfiltered) — dry-run golden diffs come only from wording changes named in the policy spec, not from filtering.

## Out of scope

- Reintroducing or changing the removed bash engine (DESIGN.md non-goal).
- New sync features or changed mutation ordering/behavior beyond adding changed/unchanged detection to existing operations — what is *done* stays identical except where an operation can now skip an provably-identical rewrite (each such skip is named in the golden diff).
- Porting engine-native to full Effect generators end-to-end (services at the seams only; deeper migration is a follow-up plan if wanted).
- A `debug`/argv-trace level (no trigger/producer/test yet).
- Windows CI matrix changes beyond keeping existing workflows green.

## Self-review

- Actionability: every step has a named artifact and an executable done-condition (grep counts, golden cases, prove-red exit codes). ✓
- Dependency order: audit → spec → research/harness → logger+change-detection → deps → platform → rim → verify. Harness upgrade precedes call-site migration so channel violations are catchable from the first migrated line. ✓
- Evidence: all cited sites opened this session (Sources); reviewer findings 1, 3, 4, 9, 10, 12 independently re-verified against source before acceptance. ✓
- Goal coverage: over-logging = Steps 2/5 (change detection + demotion); under-warning = Steps 2/6/7 (uniform hints); Effect+SOLID = Steps 3/8 (Tags, Layers, DIP seams; SRP: policy vs pipeline; OCP: levels/sinks; ISP: probe vs policy vs hint). ✓
- Failure mode: golden suite + prove-red are the revert trigger per tier; each tier is one reviewable commit. ✓
- Guess → question: OSManager scope was hedged by the user ("maybe") → surfaced as an open question, answered 2026-07-09 (see Notes). ✓

## Review

(filled by plan-review on completion)

## Sources

- `cli/src/engine-native/output.ts` (whole file) — 3 unconditional emitters, no levels/DI; the root cause.
- `cli/src/engine-native/skillsSync.ts:106-108` — "Universal skills already in sync (N present)" logged as `[ok]` on no-op.
- `cli/src/engine-native/claudeSync.ts:120` ("RTK already initialized"), `:353`/`:378` ("already set … left as-is"), `:622` ("Plugins already in sync") — no-op confirmations at `[ok]`.
- `cli/src/engine-native/toolchain.ts:190` ("present"), `:218` ("up to date"); `:129-179` `gate()`/`ensure()` — existing probe/install orchestration DependencyManager builds on; `SoT/toolchain.json` is its policy source.
- `cli/src/engine-native/claudeSync.ts:533` + `codexSync.ts:401` — byte-identical git install hint (DRY violation; DependencyManager target).
- `cli/src/engine-native/DESIGN.md` — golden contract, `--update-goldens` review gate, prove-red, channel contract, module map.
- `cli/src/engine.ts` — `engine`/`engineCapture` seam; stderr passthrough during capture.
- `cli/src/main.ts:49-57` — harness-private `native-raw` entry bypasses `engine.ts` (why the service factory must be shared, not seam-local).
- `cli/test/lib/harness.ts:101,161-175` — `exec 2>&1` merges channels (goldens can't see channel violations today); `maskTools` masking mechanism for targeted missing-tool cases.
- `cli/src/engine-native/index.ts` — `Ctx` env-driven flags (`DRY_RUN`, …) — `DOCKS_KIT_VERBOSE` follows the pattern; summary/next-steps blocks.
- `package.json` — effect 3.21.4 / @effect/cli 0.75.2 / platform-bun; scripts `test:unit`, `golden:dryrun`, `golden:mutation`, `typecheck`.
- `process.platform` scatter: `codexSync.ts:81-82,348,401`, `skillsSync.ts:141,207,233,325`, `claudeSync.ts:38,99,347,533`, `toolchain.ts:230`, `exec.ts:27,45` (re-derive: `grep -rn "process.platform" cli/src/engine-native`).

## Notes

- 2026-07-09: plan drafted from a live audit of the engine; user decisions recorded in `## Context`. Log-call counts are point-in-time — Step 1 re-derives them.
- Cross-check (2026-07-09): [codex gpt-5.6-sol xhigh] 15 findings (8 high / 6 med / 1 low) — 15 accepted, 0 rejected; [claude] independently verified findings 1, 3, 4, 9, 10, 12 against source before accepting. Key ingested changes: change-detection contract added to Goal/Steps (f1); affected_paths manifest expanded to every command surface, harness, test, doc, changelog (f2); sync-logger-with-own-filtering decision recorded — `Logger.minimumLogLevel` explicitly ruled out for direct writes (f3); one composed Layer at main.ts + shared factory for native-raw/engineCapture instead of ManagedRuntime-at-seam (f4); `Context.Tag` + `Layer.succeed` over experimental `Effect.Service` (f5); DependencyManager got ToolId/DependencySpec/ProbeResult + required-vs-optional + dedup + toolchain.json ownership (f6); OSManager narrowed to a capability seam, package IDs stay in deps, symlinks stay try-then-fallback (f7); dry-run-stays-complete channel decision (f8); harness upgraded first — split channels, same-HOME replay, public-flag integration legs (f9, f10); per-tier golden matrix + exact prove-red conditions (f11); maskTools-based git criterion with dedup semantics (f12); summary schema + conditional next-steps (f13); single audit artifact with zero-omission grep check (f14); `debug` level dropped (f15).
- Open question `osmanager-scope` answered by user via picker (2026-07-09): dedicated narrow Platform service now (Step 7 unconditional); package IDs stay in DependencyManager.
- Step 5b note (2026-07-09): change detection landed — `writeFileIfChanged`/`copyFileIfChanged`/`copyTreeIfChanged` in exec.ts; wired into syncScripts/syncHooks/syncClaudeMd/syncSettings/jqEditSettings (compact-window + permissive)/syncClaudeJson/enableOptionalPlugin (claude) and syncConfig/syncRules/syncAgentsMd/syncMarketplace + both model setters (codex); `.bak` written only when a replacement actually happens. Golden diff: ONLY the 3 replay cases. Second-run [ok] count 13 → 5; remaining by design: one-time canonicalization on the first merge over a verbatim-copied file (self-heals run 3), two stub artifacts (harness claude/npx don't persist installs), and `syncPlugins`' refresh which is real per-run work (left as change deliberately — revisit if noisy on real machines). Follow-up noted: harness diff labels are inverted between tree (A=expected) and text (A=actual) — pre-existing, out of scope.
- Step 5a note (2026-07-09): logger.ts landed (Logger interface + makeLogger with injectable sinks + module default; setVerbose); output.ts deleted; 42 change-class `log(` sites → `change(`, the 9 audited no-op sites → `verbose(`; `--verbose` in engine vocabulary (parseArgs + modes) and public `--verbose`/`-v` on sync/model/toolchain; goldens: 2 added verbose legs, 15 output-only diffs, ZERO tree/argv drift; verbosity + channel invariants green; both prove-red legs red. Change-detection (5b) pending — change-class ops still print on unchanged repeat runs.
- Step 4 note (2026-07-09): harness gained `runEngineSplit` (no 2>&1 merge; channel-purity assertions), `runPublicCli` (real @effect/cli path), and `reuseHome` replay support; two `replay=2nd` golden rows recorded (only-additive diff, existing keys byte-identical); channel invariants (log prefixes stderr-only, summary + dry-run + status --json JSON stdout-only) pass on the pre-migration engine; both prove-red legs exit 1 with `prove-red OK`. The `--verbose`/`-v`/`DOCKS_KIT_VERBOSE` integration legs are deferred INTO Step 5's commit — the flag must exist before a case can record (deviation from the Step 4 wording, not from intent).
- Step 3 research gate (2026-07-09, via the kit's own channels — `effect-solutions` CLI + the effect-kit `effect-ts-specialist` skill, which is pinned to Effect 3.x like this repo): CONFIRMED — for effect 3.21.4, `Context.Tag` + a separate `Layer` is the documented idiom for interface-first services with multiple implementations (live + test); `Effect.Service` is the one-obvious-impl sugar; provide layers ONCE at the application boundary (matches the one-composed-Layer-at-main.ts decision). VERSION TRAP recorded: `effect-solutions` v0.5.3 examples track the Effect 4 API line (`Context.Service`, `Schema.TaggedErrorClass`, `effect/unstable/*`) — never copy its shapes verbatim into this 3.21.4 repo; validate any API against the repo's own `effect` typings / language service. CONFIRMED — `Logger.minimumLogLevel` is a Layer filtering `Effect.log*` fiber events only; it cannot filter direct `process.stderr.write` calls from sync engine code → injected synchronous Logger with explicit filtering stands.

### Audit inventory (Step 1, 2026-07-09)

Produced by two parallel gpt-5.6-sol workers (medium effort), spot-verified against source by the orchestrator. Zero-omission check: `grep -rn "\b\(log\|warn\|err\|echo\)(" cli/src/engine-native --include="*.ts"` = 251 match lines = 120 (claudeSync+codexSync) + 131 (remaining files) rows below. Emitter class totals: 69 warning · 55 data · 42 change · 32 error · 22 usage · 18 summary · 9 no-op confirmation · 4 definition.

#### Emitter call sites — claudeSync.ts + codexSync.ts (120)

| # | Site | Emitter | Message gist (≤60 chars) | Class | Change-detectable today? |
|---:|---|---|---|---|---|
| 1 | `claudeSync.ts:41` | `warn` | Claude CLI missing; install command and docs | warning | n-a |
| 2 | `claudeSync.ts:69` | `log` | Upgrading RTK to verified version | change | yes |
| 3 | `claudeSync.ts:70` | `warn` | RTK missing; beginning installation | warning | n-a |
| 4 | `claudeSync.ts:85` | `log` | RTK ready after install or upgrade | change | yes |
| 5 | `claudeSync.ts:88` | `err` | RTK installation failed; manual URL | error | n-a |
| 6 | `claudeSync.ts:95` | `warn` | RTK skipped by flag | warning | n-a |
| 7 | `claudeSync.ts:101` | `warn` | RTK missing on Windows; native install hint | warning | n-a |
| 8 | `claudeSync.ts:105` | `warn` | RTK bootstrap failed; continuing sync | warning | n-a |
| 9 | `claudeSync.ts:111` | `echo` | Dry-run RTK global initialization | data | n-a |
| 10 | `claudeSync.ts:118` | `log` | RTK initialized and RTK.md generated | change | yes |
| 11 | `claudeSync.ts:120` | `log` | RTK already initialized | no-op confirmation | yes |
| 12 | `claudeSync.ts:128` | `echo` | Dry-run copy scripts and audio | data | n-a |
| 13 | `claudeSync.ts:141` | `log` | Scripts and notification asset synced | change | no (`syncScripts` must return `changed:boolean`) |
| 14 | `claudeSync.ts:157` | `echo` | Dry-run copy Claude hooks | data | n-a |
| 15 | `claudeSync.ts:169` | `log` | Claude hooks synced with script count | change | no (`syncHooks` must return `changed:boolean`) |
| 16 | `claudeSync.ts:181` | `echo` | Dry-run CLAUDE.md copy stripping RTK import | data | n-a |
| 17 | `claudeSync.ts:183` | `echo` | Dry-run copy with absent RTK.md handling | data | n-a |
| 18 | `claudeSync.ts:185` | `echo` | Dry-run plain CLAUDE.md copy | data | n-a |
| 19 | `claudeSync.ts:198` | `log` | CLAUDE.md synced with RTK import stripped | change | no (`syncClaudeMd` must return `changed:boolean`) |
| 20 | `claudeSync.ts:201` | `log` | CLAUDE.md synced | change | no (`syncClaudeMd` must return `changed:boolean`) |
| 21 | `claudeSync.ts:213` | `echo` | Dry-run install Claude settings | data | n-a |
| 22 | `claudeSync.ts:215` | `echo` | Dry-run reconcile Claude settings | data | n-a |
| 23 | `claudeSync.ts:217` | `echo` | Dry-run merge Claude settings | data | n-a |
| 24 | `claudeSync.ts:224` | `log` | Claude settings installed | change | yes |
| 25 | `claudeSync.ts:231` | `err` | Invalid deployed settings; sync aborted | error | n-a |
| 26 | `claudeSync.ts:241` | `log` | Settings reconciled and backed up | change | no (`syncSettings` must return `changed:boolean`) |
| 27 | `claudeSync.ts:243` | `log` | Settings merged and backed up | change | no (`syncSettings` must return `changed:boolean`) |
| 28 | `claudeSync.ts:251` | `warn` | Modifier skipped because settings missing | warning | n-a |
| 29 | `claudeSync.ts:256` | `err` | Modifier skipped because settings invalid | error | n-a |
| 30 | `claudeSync.ts:268` | `echo` | Dry-run set compact-window environment value | data | n-a |
| 31 | `claudeSync.ts:278` | `log` | Compact window set in deployed settings | change | no (`jqEditSettings` must return `changed:boolean`) |
| 32 | `claudeSync.ts:285` | `echo` | Dry-run empty permission ask and deny lists | data | n-a |
| 33 | `claudeSync.ts:296` | `log` | Permissive permission lists emptied | change | no (`jqEditSettings` must return `changed:boolean`) |
| 34 | `claudeSync.ts:310` | `echo` | Dry-run enable turn-duration display | data | n-a |
| 35 | `claudeSync.ts:311` | `echo` | Dry-run merge Claude MCP servers | data | n-a |
| 36 | `claudeSync.ts:326` | `err` | Invalid .claude.json; edit skipped | error | n-a |
| 37 | `claudeSync.ts:338` | `log` | .claude.json updated | change | no (`syncClaudeJson` must return `changed:boolean`) |
| 38 | `claudeSync.ts:352` | `echo` | Dry-run connector environment already set | data | n-a |
| 39 | `claudeSync.ts:353` | `log` | Connector environment already set | no-op confirmation | yes |
| 40 | `claudeSync.ts:357` | `echo` | Dry-run disable connectors through setx | data | n-a |
| 41 | `claudeSync.ts:362` | `log` | Connectors disabled through setx | change | yes |
| 42 | `claudeSync.ts:364` | `warn` | setx failed; manual environment hint | warning | n-a |
| 43 | `claudeSync.ts:376` | `echo` | Dry-run connector variable already in rc file | data | n-a |
| 44 | `claudeSync.ts:378` | `log` | Connector variable already in rc file | no-op confirmation | yes |
| 45 | `claudeSync.ts:389` | `echo` | Dry-run append connector variable to rc file | data | n-a |
| 46 | `claudeSync.ts:394` | `log` | Connectors disabled through shell rc file | change | yes |
| 47 | `claudeSync.ts:458` | `echo` | Dry-run remove stale hook | data | n-a |
| 48 | `claudeSync.ts:469` | `echo` | Dry-run remove stale file | data | n-a |
| 49 | `claudeSync.ts:480` | `echo` | Dry-run delete stale settings keys | data | n-a |
| 50 | `claudeSync.ts:481` | `echo` | Dry-run delete stale .claude.json keys | data | n-a |
| 51 | `claudeSync.ts:486` | `log` | Stale artifacts pruned with counts | change | yes |
| 52 | `claudeSync.ts:521` | `echo` | Dry-run bootstrap and update Claude plugins | data | n-a |
| 53 | `claudeSync.ts:523` | `echo` | Dry-run prune extra plugins and marketplaces | data | n-a |
| 54 | `claudeSync.ts:529` | `warn` | Claude CLI missing; plugin reconcile skipped | warning | n-a |
| 55 | `claudeSync.ts:534` | `warn` | Git missing; Claude plugin passes skipped | warning | n-a |
| 56 | `claudeSync.ts:553` | `warn` | Marketplace add failed | warning | n-a |
| 57 | `claudeSync.ts:571` | `warn` | Plugin installation failed | warning | n-a |
| 58 | `claudeSync.ts:597` | `warn` | Plugin uninstall failed | warning | n-a |
| 59 | `claudeSync.ts:609` | `warn` | Marketplace removal failed | warning | n-a |
| 60 | `claudeSync.ts:620` | `log` | Plugin additions, updates, or removals applied | change | yes |
| 61 | `claudeSync.ts:622` | `log` | Plugins already in sync | no-op confirmation | no (`reassertEnabledState` and refresh must return `changed:boolean`) |
| 62 | `claudeSync.ts:625` | `warn` | Aggregate Claude plugin failures | warning | n-a |
| 63 | `claudeSync.ts:639` | `warn` | Disabling a SoT-false plugin failed | warning | n-a |
| 64 | `claudeSync.ts:645` | `warn` | Enabled-plugin state reassertion failed | warning | n-a |
| 65 | `claudeSync.ts:664` | `warn` | Optional-plugin marketplace add failed | warning | n-a |
| 66 | `claudeSync.ts:671` | `warn` | Optional plugin installation failed | warning | n-a |
| 67 | `claudeSync.ts:677` | `log` | Optional plugin opted in | change | no (`enableOptionalPlugin` must return `changed:boolean`) |
| 68 | `claudeSync.ts:679` | `warn` | Optional plugin enable failed | warning | n-a |
| 69 | `claudeSync.ts:688` | `echo` | Dry-run install and enable Supabase plugin | data | n-a |
| 70 | `claudeSync.ts:691` | `echo` | Dry-run add and enable n8n plugin | data | n-a |
| 71 | `claudeSync.ts:697` | `warn` | Claude CLI missing; optional opt-in blocked | warning | n-a |
| 72 | `claudeSync.ts:733` | `echo` | Dry-run confirms LSP binaries present | data | n-a |
| 73 | `claudeSync.ts:735` | `log` | LSP server binaries already present | no-op confirmation | yes |
| 74 | `claudeSync.ts:742` | `echo` | Dry-run npm installation of missing LSPs | data | n-a |
| 75 | `claudeSync.ts:747` | `warn` | npm missing; LSP installation blocked | warning | n-a |
| 76 | `claudeSync.ts:751` | `log` | Beginning npm installation of missing LSPs | change | yes |
| 77 | `claudeSync.ts:753` | `log` | Missing LSP servers installed | change | yes |
| 78 | `claudeSync.ts:755` | `warn` | npm LSP installation failed; manual command | warning | n-a |
| 79 | `claudeSync.ts:763` | `echo` | Claude configuration directory | summary | n-a |
| 80 | `claudeSync.ts:765` | `echo` | Installed Claude hook count | summary | n-a |
| 81 | `claudeSync.ts:768` | `echo` | Installed RTK version | summary | n-a |
| 82 | `claudeSync.ts:770` | `echo` | RTK not installed | summary | n-a |
| 83 | `claudeSync.ts:775` | `echo` | Installed Claude plugin count | summary | n-a |
| 84 | `claudeSync.ts:777` | `echo` | Plugin summary skipped without Claude CLI | summary | n-a |
| 85 | `claudeSync.ts:783` | `echo` | Reload Claude plugins next step | summary | n-a |
| 86 | `claudeSync.ts:784` | `echo` | Restart Claude for hook and env changes | summary | n-a |
| 87 | `codexSync.ts:37` | `echo` | Dry-run verify bubblewrap installation | data | n-a |
| 88 | `codexSync.ts:44` | `warn` | Bubblewrap missing with auto-install skipped | warning | n-a |
| 89 | `codexSync.ts:52` | `warn` | Bubblewrap missing; no supported OS manager | warning | n-a |
| 90 | `codexSync.ts:58` | `warn` | Bubblewrap missing; beginning OS installation | warning | n-a |
| 91 | `codexSync.ts:61` | `warn` | Bubblewrap auto-install failed | warning | n-a |
| 92 | `codexSync.ts:66` | `warn` | Install succeeded but bwrap remains absent | warning | n-a |
| 93 | `codexSync.ts:72` | `log` | Bubblewrap installed and functional | change | yes |
| 94 | `codexSync.ts:74` | `warn` | Bubblewrap installed but user namespaces blocked | warning | n-a |
| 95 | `codexSync.ts:83` | `warn` | Unknown OS; bubblewrap check skipped | warning | n-a |
| 96 | `codexSync.ts:101` | `echo` | Dry-run merge Codex configuration | data | n-a |
| 97 | `codexSync.ts:107` | `log` | Codex configuration installed | change | yes |
| 98 | `codexSync.ts:117` | `log` | Codex configuration merged and backed up | change | no (`syncConfig` must return `changed:boolean`) |
| 99 | `codexSync.ts:162` | `log` | Deprecated legacy-landlock setting removed | change | yes |
| 100 | `codexSync.ts:215` | `echo` | Dry-run copy Codex rule files | data | n-a |
| 101 | `codexSync.ts:231` | `log` | Codex rule files synced | change | no (`syncRules` must return `changed:boolean`) |
| 102 | `codexSync.ts:238` | `echo` | Dry-run copy Codex AGENTS.md | data | n-a |
| 103 | `codexSync.ts:244` | `log` | Codex AGENTS.md synced | change | no (`syncAgentsMd` must return `changed:boolean`) |
| 104 | `codexSync.ts:253` | `echo` | Dry-run copy personal marketplace | data | n-a |
| 105 | `codexSync.ts:264` | `err` | Invalid deployed marketplace; sync skipped | error | n-a |
| 106 | `codexSync.ts:270` | `log` | Codex marketplace merged and backed up | change | no (`syncMarketplace` must return `changed:boolean`) |
| 107 | `codexSync.ts:273` | `log` | Codex marketplace installed | change | yes |
| 108 | `codexSync.ts:330` | `echo` | Dry-run remove legacy Docks marketplace | data | n-a |
| 109 | `codexSync.ts:340` | `log` | Legacy Docks marketplace removed | change | yes |
| 110 | `codexSync.ts:342` | `warn` | Legacy marketplace removal failed | warning | n-a |
| 111 | `codexSync.ts:390` | `echo` | Dry-run add enabled Codex plugins | data | n-a |
| 112 | `codexSync.ts:395` | `warn` | Codex CLI missing; install and refresh hints | warning | n-a |
| 113 | `codexSync.ts:402` | `warn` | Git missing; Codex plugin refresh skipped | warning | n-a |
| 114 | `codexSync.ts:414` | `warn` | Stale Codex launcher; standalone install hint | warning | n-a |
| 115 | `codexSync.ts:420` | `warn` | Codex plugin refresh failed; manual command | warning | n-a |
| 116 | `codexSync.ts:427` | `log` | Codex plugins refreshed | change | no (`codex plugin add` must return `changed:boolean`) |
| 117 | `codexSync.ts:428` | `warn` | Aggregate Codex plugin failures | warning | n-a |
| 118 | `codexSync.ts:435` | `echo` | Codex configuration directory | summary | n-a |
| 119 | `codexSync.ts:438` | `echo` | Enabled Codex plugin count | summary | n-a |
| 120 | `codexSync.ts:443` | `echo` | Restart Codex to load refreshed assets | summary | n-a |

#### Probe/install-hint sites in these two files

| # | Site | Tool | Kind (probe/version/install/hint) | Hint present? | Notes |
|---:|---|---|---|---|---|
| 1 | `claudeSync.ts:36` | `claude` | probe | yes | Initial PATH probe; lines 37–42 construct the OS hint |
| 2 | `claudeSync.ts:37-42` | `claude` | hint | yes | Winget on Windows; download-then-run elsewhere |
| 3 | `claudeSync.ts:65-80` | `rtk` | install | yes | Verified tag installer callback; downloads before running |
| 4 | `claudeSync.ts:83` | `rtk` | probe | yes | Post-install PATH probe; failure hint is line 88 |
| 5 | `claudeSync.ts:84` | `rtk` | version | no | Captures `rtk --version` after installation |
| 6 | `claudeSync.ts:88` | `rtk` | hint | yes | Links to the RTK repository for manual install |
| 7 | `claudeSync.ts:100` | `rtk` | probe | yes | Windows-only pre-bootstrap probe |
| 8 | `claudeSync.ts:101` | `rtk` | hint | yes | Suggests winget or a Windows release archive |
| 9 | `claudeSync.ts:104` | `rtk` | version | yes | `ensure` checks the pin and invokes `rtkInstall` |
| 10 | `claudeSync.ts:108` | `rtk` | probe | no | Final availability guard before global init |
| 11 | `claudeSync.ts:116` | `rtk` | install | no | Runs `rtk init --global`; failure aborts sync |
| 12 | `claudeSync.ts:528` | `claude` | probe | yes | Plugin-reconcile PATH guard |
| 13 | `claudeSync.ts:529` | `claude` | hint | yes | Gives manual `/plugin` commands, not CLI install |
| 14 | `claudeSync.ts:532` | `git` | probe | yes | Guards all Claude marketplace/plugin passes |
| 15 | `claudeSync.ts:533-534` | `git` | hint | yes | Winget on Windows; generic package manager elsewhere |
| 16 | `claudeSync.ts:568` | `claude` | install | no | Installs each missing SoT-enabled plugin |
| 17 | `claudeSync.ts:670` | `claude` | install | yes | Installs optional plugin; failure names the plugin |
| 18 | `claudeSync.ts:696` | `claude` | probe | no | Optional-plugin PATH guard lacks CLI install guidance |
| 19 | `claudeSync.ts:697` | `claude` | hint | no | Reports blocked opt-in but no Claude install command |
| 20 | `claudeSync.ts:712` | LSP packages | version | no | Reads verified pins for generated npm specs |
| 21 | `claudeSync.ts:725` | `intelephense` | probe | yes | Missing binary is added to the npm install set |
| 22 | `claudeSync.ts:727` | `typescript-language-server` | probe | yes | Missing binary is added to the npm install set |
| 23 | `claudeSync.ts:728` | `tsc` | probe | yes | Missing binary adds pinned TypeScript package |
| 24 | `claudeSync.ts:746` | `npm` | probe | yes | Guards installation of missing LSP servers |
| 25 | `claudeSync.ts:747` | `npm` | hint | yes | Says to install Node.js and rerun sync |
| 26 | `claudeSync.ts:752` | `npm` | install | yes | Executes global install; line 755 gives retry command |
| 27 | `claudeSync.ts:755` | `npm` | hint | yes | Prints the exact manual global-install command |
| 28 | `claudeSync.ts:766` | `rtk` | probe | no | Summary-only availability probe |
| 29 | `claudeSync.ts:767` | `rtk` | version | no | Summary captures `rtk --version` |
| 30 | `claudeSync.ts:772` | `claude` | probe | no | Summary-only probe controlling plugin count |
| 31 | `codexSync.ts:41` | `bubblewrap` | probe | yes | Initial PATH probe; later branches provide hints |
| 32 | `codexSync.ts:44-45` | `bubblewrap` | hint | yes | Recommends apt when auto-install is skipped |
| 33 | `codexSync.ts:50` | package managers | probe | yes | Selects an available bubblewrap install command |
| 34 | `codexSync.ts:52-53` | package managers | hint | yes | Names supported managers when none is detected |
| 35 | `codexSync.ts:58-59` | `bubblewrap` | install | yes | Announces and executes the selected OS command |
| 36 | `codexSync.ts:61` | `bubblewrap` | hint | yes | Repeats the exact command for manual installation |
| 37 | `codexSync.ts:65` | `bubblewrap` | probe | yes | Post-install PATH verification |
| 38 | `codexSync.ts:66` | `bubblewrap` | hint | yes | Advises checking the installation manually |
| 39 | `codexSync.ts:70` | `unshare` | probe | yes | Tests unprivileged user-namespace functionality |
| 40 | `codexSync.ts:71` | `bubblewrap` | version | no | Captures `bwrap --version` after installation |
| 41 | `codexSync.ts:74-75` | `bubblewrap` | hint | yes | AppArmor-profile preference and sysctl fallback |
| 42 | `codexSync.ts:83` | `bubblewrap` | hint | no | Unknown-OS warning has no install command |
| 43 | `codexSync.ts:88` | `apt-get` | probe | yes | Returns `sudo apt-get install -y bubblewrap` |
| 44 | `codexSync.ts:89` | `dnf` | probe | yes | Returns `sudo dnf install -y bubblewrap` |
| 45 | `codexSync.ts:90` | `pacman` | probe | yes | Returns noninteractive pacman install command |
| 46 | `codexSync.ts:91` | `zypper` | probe | yes | Returns noninteractive zypper install command |
| 47 | `codexSync.ts:334` | `codex` | probe | no | Silent guard for legacy-marketplace removal |
| 48 | `codexSync.ts:347-350` | `codex` | hint | yes | Builds official standalone installer by OS |
| 49 | `codexSync.ts:383-385` | `codex` | hint | yes | Builds a manual plugin-add command |
| 50 | `codexSync.ts:394` | `codex` | probe | yes | Plugin-refresh PATH guard |
| 51 | `codexSync.ts:395-396` | `codex` | hint | yes | Standalone install, docs, and plugin-add command |
| 52 | `codexSync.ts:400` | `git` | probe | yes | Guards Codex marketplace refresh |
| 53 | `codexSync.ts:401-402` | `git` | hint | yes | Winget on Windows; generic package manager elsewhere |
| 54 | `codexSync.ts:409` | `codex` | install | yes | `plugin add` refreshes each enabled plugin |
| 55 | `codexSync.ts:414-415` | `codex` | hint | yes | Stale launcher gets standalone installer command |
| 56 | `codexSync.ts:420-421` | `codex` | hint | yes | Failed refresh gets an exact manual command |


#### Emitter call sites — remaining engine files (131)
| # | Site | Emitter | Message gist (≤60 chars) | Class | Change-detectable today? |
|---:|---|---|---|---|---|
| 1 | `skillsSync.ts:62` | `warn` | node/npx missing; universal skills skipped | warning | n-a |
| 2 | `skillsSync.ts:76` | `echo` | dry-run: universal skill already present | data | n-a |
| 3 | `skillsSync.ts:79` | `echo` | dry-run: install universal skill via npx | data | n-a |
| 4 | `skillsSync.ts:96` | `warn` | universal skill installation failed | warning | n-a |
| 5 | `skillsSync.ts:106` | `log` | universal skills added; existing count included | change | yes |
| 6 | `skillsSync.ts:108` | `log` | universal skills already in sync | no-op confirmation | yes |
| 7 | `skillsSync.ts:111` | `log` | missing or broken Claude symlinks healed | change | yes |
| 8 | `skillsSync.ts:114` | `warn` | aggregate skill failures with manual npx hint | warning | n-a |
| 9 | `skillsSync.ts:143` | `echo` | dry-run: replace stale Claude skill symlink | data | n-a |
| 10 | `skillsSync.ts:147` | `warn` | stale Claude skill link could not be removed | warning | n-a |
| 11 | `skillsSync.ts:151` | `warn` | real path blocks managed Claude skill symlink | warning | n-a |
| 12 | `skillsSync.ts:154` | `echo` | dry-run: create missing Claude skill symlink | data | n-a |
| 13 | `skillsSync.ts:220` | `warn` | symlink unsupported; copied skill instead | warning | n-a |
| 14 | `skillsSync.ts:223` | `warn` | symlink and copy creation both failed | warning | n-a |
| 15 | `skillsSync.ts:235` | `log` | installing or upgrading agent-browser via npm | change | yes |
| 16 | `skillsSync.ts:237` | `warn` | npm agent-browser install failed; manual hint | warning | n-a |
| 17 | `skillsSync.ts:242` | `log` | downloading Chrome for Testing and system libs | change | yes |
| 18 | `skillsSync.ts:244` | `warn` | Chrome/agent-browser install failed; retry hint | warning | n-a |
| 19 | `skillsSync.ts:251` | `log` | agent-browser installation completed with version | change | yes |
| 20 | `skillsSync.ts:259` | `warn` | npm missing; agent-browser cannot auto-install | warning | n-a |
| 21 | `skillsSync.ts:264` | `warn` | agent-browser bootstrap failed; sync continues | warning | n-a |
| 22 | `skillsSync.ts:285` | `warn` | Bun and curl missing; manual Bun install needed | warning | n-a |
| 23 | `skillsSync.ts:289` | `warn` | Bun missing; beginning verified Bun installation | warning | n-a |
| 24 | `skillsSync.ts:298` | `warn` | Bun installation failed; manual command supplied | warning | n-a |
| 25 | `skillsSync.ts:302` | `log` | Bun installed with detected version | change | yes |
| 26 | `skillsSync.ts:315` | `log` | install or upgrade effect-solutions via Bun | change | yes |
| 27 | `skillsSync.ts:317` | `warn` | effect-solutions Bun install failed; manual hint | warning | n-a |
| 28 | `skillsSync.ts:327` | `log` | Windows effect-solutions shim found and ready | change | yes |
| 29 | `skillsSync.ts:328` | `warn` | installed effect-solutions shim not found | warning | n-a |
| 30 | `skillsSync.ts:335` | `log` | Bun and effect-solutions linked into local bin | change | yes |
| 31 | `skillsSync.ts:337` | `warn` | effect-solutions binary missing; PATH hint | warning | n-a |
| 32 | `skillsSync.ts:349` | `warn` | effect-solutions bootstrap failed; continuing | warning | n-a |
| 33 | `skillsSync.ts:358` | `echo` | dry-run: prune snapshot does not exist yet | data | n-a |
| 34 | `skillsSync.ts:372` | `echo` | dry-run: remove obsolete kit-managed skill | data | n-a |
| 35 | `skillsSync.ts:381` | `warn` | kit-managed skill removal failed | warning | n-a |
| 36 | `skillsSync.ts:386` | `log` | obsolete kit-managed skills removed | change | yes |
| 37 | `skillsSync.ts:387` | `warn` | aggregate skill-removal failures with npx hint | warning | n-a |
| 38 | `skillsSync.ts:401` | `echo` | summary: universal skills directory | summary | n-a |
| 39 | `skillsSync.ts:403` | `echo` | summary: installed universal skill count | summary | n-a |
| 40 | `skillsSync.ts:408` | `echo` | summary: restart tools to discover new skills | summary | n-a |
| 41 | `parseArgs.ts:22` | `echo` | sync command usage synopsis | usage | n-a |
| 42 | `parseArgs.ts:23` | `echo` | help blank line | usage | n-a |
| 43 | `parseArgs.ts:24` | `echo` | help heading for positional targets | usage | n-a |
| 44 | `parseArgs.ts:25` | `echo` | help: Claude target | usage | n-a |
| 45 | `parseArgs.ts:26` | `echo` | help: Codex target | usage | n-a |
| 46 | `parseArgs.ts:27` | `echo` | help: universal agents target | usage | n-a |
| 47 | `parseArgs.ts:28` | `echo` | help blank line | usage | n-a |
| 48 | `parseArgs.ts:29` | `echo` | help heading for global flags | usage | n-a |
| 49 | `parseArgs.ts:30` | `echo` | help: dry-run flag | usage | n-a |
| 50 | `parseArgs.ts:31` | `echo` | help: reconcile flag | usage | n-a |
| 51 | `parseArgs.ts:34` | `echo` | help: prune flag | usage | n-a |
| 52 | `parseArgs.ts:37` | `echo` | help: skip optional RTK bootstrap | usage | n-a |
| 53 | `parseArgs.ts:38` | `echo` | help: auto-accept toolchain prompts | usage | n-a |
| 54 | `parseArgs.ts:39` | `echo` | help blank line | usage | n-a |
| 55 | `parseArgs.ts:40` | `echo` | help heading for deploy-time modifiers | usage | n-a |
| 56 | `parseArgs.ts:41` | `echo` | help: Claude model modifier | usage | n-a |
| 57 | `parseArgs.ts:44` | `echo` | help: Claude compact-window modifier | usage | n-a |
| 58 | `parseArgs.ts:47` | `echo` | help: Claude permissive modifier | usage | n-a |
| 59 | `parseArgs.ts:50` | `echo` | help: Codex model modifier | usage | n-a |
| 60 | `parseArgs.ts:51` | `echo` | help blank line | usage | n-a |
| 61 | `parseArgs.ts:52` | `echo` | help heading for sticky opt-ins | usage | n-a |
| 62 | `parseArgs.ts:53` | `echo` | help: optional Claude plugin flag | usage | n-a |
| 63 | `parseArgs.ts:70` | `err` | unknown optional Claude plugin | error | n-a |
| 64 | `parseArgs.ts:108` | `err` | Claude model flag is missing its value | error | n-a |
| 65 | `parseArgs.ts:112` | `err` | Codex model flag is missing its value | error | n-a |
| 66 | `parseArgs.ts:115` | `err` | compact-window flag is missing its value | error | n-a |
| 67 | `parseArgs.ts:121` | `err` | Claude plugin flag is missing its value | error | n-a |
| 68 | `parseArgs.ts:126` | `err` | old target flag renamed to positional target | error | n-a |
| 69 | `parseArgs.ts:129` | `err` | force flag renamed to reconcile | error | n-a |
| 70 | `parseArgs.ts:132` | `err` | remove-plugins flag renamed to prune | error | n-a |
| 71 | `parseArgs.ts:135` | `err` | 680k shorthand flag renamed | error | n-a |
| 72 | `parseArgs.ts:138` | `err` | permissive flag renamed | error | n-a |
| 73 | `parseArgs.ts:141` | `err` | Supabase flag renamed to plugin opt-in | error | n-a |
| 74 | `parseArgs.ts:144` | `err` | n8n flag renamed to plugin opt-in | error | n-a |
| 75 | `parseArgs.ts:147` | `err` | no-rtk flag renamed to skip-rtk | error | n-a |
| 76 | `parseArgs.ts:163` | `err` | invalid compact-window token count | error | n-a |
| 77 | `parseArgs.ts:170` | `err` | unknown sync argument | error | n-a |
| 78 | `parseArgs.ts:190` | `err` | required jq missing; platform install hint | error | n-a |
| 79 | `parseArgs.ts:196` | `err` | required curl missing without install hint | error | n-a |
| 80 | `parseArgs.ts:205` | `warn` | Claude model ignored without Claude target | warning | n-a |
| 81 | `parseArgs.ts:209` | `err` | invalid Claude model selection | error | n-a |
| 82 | `parseArgs.ts:215` | `warn` | Codex model ignored without Codex target | warning | n-a |
| 83 | `parseArgs.ts:219` | `err` | malformed Codex model identifier | error | n-a |
| 84 | `toolchain.ts:136` | `warn` | unverified newer tool accepted by yes flag | warning | n-a |
| 85 | `toolchain.ts:147` | `warn` | verified tool version used instead of latest | warning | n-a |
| 86 | `toolchain.ts:150` | `warn` | unverified tool install or upgrade skipped | warning | n-a |
| 87 | `toolchain.ts:162` | `echo` | dry-run: missing tool would be installed | data | n-a |
| 88 | `toolchain.ts:169` | `warn` | latest unknown; installing verified version | warning | n-a |
| 89 | `toolchain.ts:172` | `warn` | latest unknown; installing unverified latest | warning | n-a |
| 90 | `toolchain.ts:187` | `echo` | dry-run: non-tracked tool already present | data | n-a |
| 91 | `toolchain.ts:190` | `log` | non-tracked tool already present | no-op confirmation | yes |
| 92 | `toolchain.ts:197` | `echo` | dry-run: present; latest unavailable; no action | data | n-a |
| 93 | `toolchain.ts:200` | `log` | present; latest unavailable; no action | no-op confirmation | yes |
| 94 | `toolchain.ts:206` | `echo` | dry-run: tracked tool would be upgraded | data | n-a |
| 95 | `toolchain.ts:215` | `echo` | dry-run: tracked tool already up to date | data | n-a |
| 96 | `toolchain.ts:218` | `log` | tracked tool already up to date | no-op confirmation | yes |
| 97 | `toolchain.ts:228` | `echo` | toolchain report header | data | n-a |
| 98 | `toolchain.ts:239` | `echo` | toolchain report row for npx-only pin | data | n-a |
| 99 | `toolchain.ts:257` | `echo` | toolchain report row for probed binary | data | n-a |
| 100 | `modes.ts:25` | `err` | unknown model-mode flag | error | n-a |
| 101 | `modes.ts:30` | `err` | model mode missing required tool argument | error | n-a |
| 102 | `modes.ts:38` | `warn` | deployed Claude settings missing | warning | n-a |
| 103 | `modes.ts:41` | `echo` | deployed Claude model value | data | n-a |
| 104 | `modes.ts:42` | `echo` | Claude model value from SoT | data | n-a |
| 105 | `modes.ts:46` | `warn` | deployed Codex config missing | warning | n-a |
| 106 | `modes.ts:49` | `echo` | deployed Codex model value | data | n-a |
| 107 | `modes.ts:50` | `echo` | Codex model value from SoT | data | n-a |
| 108 | `modes.ts:59` | `err` | invalid direct-mode Claude model | error | n-a |
| 109 | `modes.ts:66` | `err` | invalid direct-mode Codex model | error | n-a |
| 110 | `modes.ts:112` | `err` | invalid toolchain operation usage | error | n-a |
| 111 | `modes.ts:116` | `err` | toolchain ensure missing tool argument | error | n-a |
| 112 | `modes.ts:130` | `err` | toolchain ensure given unmanaged tool | error | n-a |
| 113 | `claudeModel.ts:19` | `echo` | dry-run: delete deployed Claude model | data | n-a |
| 114 | `claudeModel.ts:21` | `echo` | dry-run: set deployed Claude model | data | n-a |
| 115 | `claudeModel.ts:30` | `warn` | Claude settings missing; model change skipped | warning | n-a |
| 116 | `claudeModel.ts:35` | `err` | invalid Claude settings JSON; change skipped | error | n-a |
| 117 | `claudeModel.ts:47` | `log` | deployed Claude model written | change | no — `syncClaudeModel` must return `changed: boolean` |
| 118 | `index.ts:78` | `echo` | summary leading blank line | summary | n-a |
| 119 | `index.ts:79` | `echo` | sync-complete summary heading | summary | n-a |
| 120 | `index.ts:80` | `echo` | summary repository path | summary | n-a |
| 121 | `index.ts:85` | `echo` | summary/next-steps separator blank line | summary | n-a |
| 122 | `output.ts:6` | `log` | success-log emitter function | definition | n-a |
| 123 | `output.ts:10` | `warn` | warning emitter function | definition | n-a |
| 124 | `output.ts:14` | `err` | error emitter function | definition | n-a |
| 125 | `output.ts:18` | `echo` | stdout data emitter function | definition | n-a |
| 126 | `models.ts:41` | `warn` | model catalog unavailable | warning | n-a |
| 127 | `models.ts:59` | `warn` | unverified Claude model accepted | warning | n-a |
| 128 | `models.ts:68` | `warn` | unverified Codex model accepted | warning | n-a |
| 129 | `codexToml.ts:55` | `echo` | dry-run: set deployed Codex model | data | n-a |
| 130 | `codexToml.ts:62` | `warn` | Codex config missing; model change skipped | warning | n-a |
| 131 | `codexToml.ts:66` | `log` | deployed Codex model written | change | no — `syncCodexModel` must return `changed: boolean` |

#### Probe/install-hint sites in these files
| # | Site | Tool | Kind (probe/version/install/hint) | Hint present? | Notes |
|---:|---|---|---|---|---|
| 1 | `skillsSync.ts:40` | npx/skills CLI | version | no | Reads the verified `skills-cli` pin from the manifest. |
| 2 | `skillsSync.ts:61` | node/npx | probe | no | Tests `node`, implicitly assuming npx is bundled and available. |
| 3 | `skillsSync.ts:62` | node/npx | hint | yes | Says to install Node.js, but gives no platform command. |
| 4 | `skillsSync.ts:79` | npx/skills CLI | install | no | Dry-run representation of the pinned skill install. |
| 5 | `skillsSync.ts:90` | npx/skills CLI | install | no | Executes the pinned universal-skill install. |
| 6 | `skillsSync.ts:96` | npx/skills CLI | hint | no | Reports the failed slug without a recovery command. |
| 7 | `skillsSync.ts:114` | npx/skills CLI | hint | yes | Manual command floats `skills` instead of using the pin. |
| 8 | `skillsSync.ts:235` | agent-browser/npm | install | no | Announces install/upgrade selected by `ensure`. |
| 9 | `skillsSync.ts:236` | agent-browser/npm | install | no | Executes global npm install, pinned when version is known. |
| 10 | `skillsSync.ts:237` | agent-browser/npm | hint | yes | Repeats the exact npm command for manual recovery. |
| 11 | `skillsSync.ts:242` | Chrome-for-Testing | install | no | Announces first-install browser download. |
| 12 | `skillsSync.ts:243` | Chrome-for-Testing | install | no | Runs `agent-browser install`; Linux adds `--with-deps`. |
| 13 | `skillsSync.ts:244` | Chrome-for-Testing | hint | yes | Supplies the retry command and platform-derived flags. |
| 14 | `skillsSync.ts:248` | agent-browser | version | no | Runs `agent-browser --version` after installation. |
| 15 | `skillsSync.ts:258` | npm | probe | no | Checks npm before agent-browser toolchain orchestration. |
| 16 | `skillsSync.ts:259` | npm | hint | yes | Says to install Node.js, but gives no platform command. |
| 17 | `skillsSync.ts:263` | agent-browser | install | no | Delegates missing/version/install decisions to `ensure`. |
| 18 | `skillsSync.ts:264` | agent-browser | hint | no | Reports bootstrap failure without a direct install command. |
| 19 | `skillsSync.ts:270` | bun | probe | no | Resolves Bun from PATH. |
| 20 | `skillsSync.ts:274` | bun | probe | no | Checks fallback Bun executables under configured/home paths. |
| 21 | `skillsSync.ts:284` | bun/curl | probe | no | Checks installer dependency only after Bun is absent. |
| 22 | `skillsSync.ts:285` | bun | hint | yes | Requests manual Bun install, but supplies no command here. |
| 23 | `skillsSync.ts:289` | bun | install | no | Announces bootstrap using the verified manifest pin. |
| 24 | `skillsSync.ts:291` | bun | install | no | Downloads the Bun installer to a temporary file. |
| 25 | `skillsSync.ts:293` | bun | install | no | Executes the downloaded installer with `bun-v<pin>`. |
| 26 | `skillsSync.ts:296` | bun | probe | no | Re-probes Bun after the installer runs. |
| 27 | `skillsSync.ts:298` | bun | hint | yes | Supplies download-then-run manual installation commands. |
| 28 | `skillsSync.ts:301` | bun | version | no | Runs the installed Bun executable with `--version`. |
| 29 | `skillsSync.ts:312` | bun | probe | no | Ensures Bun before installing effect-solutions. |
| 30 | `skillsSync.ts:315` | effect-solutions | install | no | Announces Bun-global install or upgrade. |
| 31 | `skillsSync.ts:316` | effect-solutions | install | no | Executes `bun add -g` with a selected version. |
| 32 | `skillsSync.ts:317` | effect-solutions | hint | yes | Repeats the Bun-global command for manual recovery. |
| 33 | `skillsSync.ts:321` | effect-solutions | probe | no | Queries Bun’s global binary directory. |
| 34 | `skillsSync.ts:326` | effect-solutions | probe | no | Windows probe checks `.exe`, `.cmd`, and `.bunx` shims. |
| 35 | `skillsSync.ts:328` | effect-solutions | hint | yes | Directs user to inspect `bun pm -g bin`; no install command. |
| 36 | `skillsSync.ts:331` | effect-solutions | probe | no | Unix probe requires an executable in Bun’s global bin. |
| 37 | `skillsSync.ts:337` | effect-solutions | hint | yes | Says to link onto PATH manually; no concrete command. |
| 38 | `skillsSync.ts:348` | effect-solutions | install | no | Delegates missing/version/install decisions to `ensure`. |
| 39 | `skillsSync.ts:349` | effect-solutions | hint | no | Reports bootstrap failure without a recovery command. |
| 40 | `skillsSync.ts:375` | npx/skills CLI | install | no | Executes pinned removal of a stale managed skill. |
| 41 | `skillsSync.ts:381` | npx/skills CLI | hint | no | Reports removal failure without a command at this site. |
| 42 | `skillsSync.ts:387` | npx/skills CLI | hint | yes | Supplies a manual global skill-removal command. |
| 43 | `toolchain.ts:40` | bun | probe | no | Bun has a specialized multi-location presence probe. |
| 44 | `toolchain.ts:43` | bun | probe | no | Checks Bun on PATH. |
| 45 | `toolchain.ts:44` | bun | probe | no | Checks `$BUN_INSTALL/bin/bun` or its home default. |
| 46 | `toolchain.ts:45` | bun | probe | no | Checks the fixed `~/.bun/bin/bun` fallback. |
| 47 | `toolchain.ts:48` | rtk/agent-browser/LSP binaries | probe | no | Generic PATH probe; also covers effect-solutions and npm. |
| 48 | `toolchain.ts:60` | rtk | version | no | Runs `rtk --version` and reads field two. |
| 49 | `toolchain.ts:66` | bun | version | no | Runs Bun from PATH or the home fallback. |
| 50 | `toolchain.ts:68` | agent-browser | version | no | Runs `agent-browser --version`. |
| 51 | `toolchain.ts:70` | effect-solutions/bun | probe | no | Resolves Bun before querying the global package list. |
| 52 | `toolchain.ts:71` | effect-solutions/bun | probe | no | Rejects a non-executable fallback Bun path. |
| 53 | `toolchain.ts:72` | effect-solutions | version | no | Parses its version from `bun pm -g ls`. |
| 54 | `toolchain.ts:80` | npm | version | no | Runs `npm --version` for the toolchain report. |
| 55 | `toolchain.ts:86` | LSP binaries | version | no | Only `tsc` has a version parser; other LSPs show `?`. |
| 56 | `toolchain.ts:95` | rtk | version | no | Fetches the latest RTK GitHub release tag via curl. |
| 57 | `toolchain.ts:102` | npm | probe | no | Requires npm before registry latest-version queries. |
| 58 | `toolchain.ts:102` | agent-browser/effect-solutions | version | no | Runs `npm view <tool> version` for both tracked tools. |
| 59 | `toolchain.ts:159` | managed tools | probe | no | Generic `ensure` presence decision. |
| 60 | `toolchain.ts:160` | rtk/agent-browser/effect-solutions | version | no | Queries latest version when the managed tool is missing. |
| 61 | `toolchain.ts:162` | managed tools | install | no | Dry-run installation report; no manual hint. |
| 62 | `toolchain.ts:169` | managed tools | install | no | Falls back to verified pin when latest is unavailable. |
| 63 | `toolchain.ts:172` | managed tools | install | no | Falls back to unverified latest when not pinnable. |
| 64 | `toolchain.ts:179` | managed tools | install | no | Invokes the tool-specific installation callback. |
| 65 | `toolchain.ts:182` | managed tools | version | no | Reads installed version after presence succeeds. |
| 66 | `toolchain.ts:194` | rtk/agent-browser/effect-solutions | version | no | Queries latest version for tracked installed tools. |
| 67 | `toolchain.ts:206` | managed tools | install | no | Dry-run upgrade report; no manual hint. |
| 68 | `toolchain.ts:211` | managed tools | install | no | Invokes the tool-specific upgrade callback. |
| 69 | `toolchain.ts:239` | npx/skills CLI | probe | no | Reports manifest-only pin explicitly without probing. |
| 70 | `toolchain.ts:244` | LSP/managed binaries | probe | no | Report probes every non-pin manifest tool for presence. |
| 71 | `toolchain.ts:245` | LSP/managed binaries | version | no | Report requests installed versions; some return empty. |

