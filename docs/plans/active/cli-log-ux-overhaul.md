---
title: CLI log UX overhaul — verbosity discipline + Effect services (SOLID)
goal: Default runs print only actual changes, actionable warnings with install hints, and the summary; operations report changed/unchanged and no-op confirmations move behind --verbose via injected Logger/DependencyManager/Platform services.
status: ongoing
created: "2026-07-09T16:04:45-03:00"
updated: "2026-07-09T16:29:36-03:00"
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
| 1 | **Audit**: one artifact — a `### Audit inventory` section appended under `## Notes` of THIS plan — with one row per `log`/`warn`/`err`/`echo` call site in `cli/src/engine-native/` (file:line, message, classification: `change` / `no-op confirmation` / `warning` / `data` / `summary`, and whether the emitting operation can detect changed/unchanged today) plus one row per external-tool probe/install-hint site. Done-condition: `grep -rn "\b\(log\|warn\|err\|echo\)(" cli/src/engine-native --include="*.ts" | wc -l` equals the row count (zero omissions). | — | in-flight |
| 2 | **Policy spec** in `cli/src/engine-native/DESIGN.md`: (a) method-to-channel table — `change`/`warn`/`error` → stderr always visible; `verbose` → stderr only with verbosity on; `data`/dry-run/summary → stdout always; pin prefixes and ANSI codes; (b) the change-detection contract — every mutating operation reports `changed: boolean` and unchanged outcomes log at `verbose`; (c) missing-dep warns MUST carry the platform-correct install command; (d) the default summary schema per `sync`/`model`/`toolchain` and the rule that next-step blocks print only when a relevant change occurred or verbosity is on; (e) flags: `--verbose`/`-v` on `sync`, `model`, `toolchain` command surfaces + `DOCKS_KIT_VERBOSE=1` for the raw channel. | 1 | planned |
| 3 | **Research gate**: confirm the pre-resolved Effect idioms against current effect 3.21 docs (`Context.Tag` + `Layer.succeed`, Layer composition at the Bun CLI entry, why not `Logger.minimumLogLevel` here) using the effect-ts-specialist skill + current docs; record confirmations/corrections in `## Notes` before writing service code. | — | done |
| 4 | **Harness upgrade (test-first)**: extend `cli/test/lib/harness.ts` to capture stdout and stderr separately (keeping a merged view for existing goldens during migration); add channel assertions (`status --json` stdout must `JSON.parse`; dry-run stdout with verbose stderr noise present); add a sequential same-HOME replay case (run sync twice, second run's default stderr contains only warns + summary trigger lines); add public-CLI integration cases for `--verbose` and `-v` on all three command surfaces and `DOCKS_KIT_VERBOSE=1` on the raw channel. Prove-red discipline: `bun cli/test/golden-dryrun.ts --prove-red` and `bun cli/test/golden-mutation.ts --prove-red` must each print `prove-red OK` and exit non-zero, before and after. | 2 | planned |
| 5 | **Tier 1 — Logger + change detection + reclassification**: add `cli/src/engine-native/logger.ts` (`Logger` interface: `change/warn/error/verbose` → stderr, level-filtered; `data` writer → stdout); `output.ts` becomes a thin shim then is deleted once call sites migrate. Give mutating operations changed/unchanged results per the Step-1 audit column; reclassify every call site (no-op → `verbose`, real change → `change`, missing-dep warns gain hints); thread verbosity `parseArgs.ts → Ctx`. Update BOTH goldens in the same commit; golden matrix rows for default + verbose. | 3, 4 | planned |
| 6 | **Tier 2 — DependencyManager** (`cli/src/engine-native/deps.ts`): typed contract — `ToolId` union (git, claude, codex, rtk, bun, npx, agent-browser, chrome-for-testing, LSP binaries); `DependencySpec { id, requirement: "required" \| "optional", probe, versionCmd, installHint(platform) }`; `ProbeResult = present(version?) \| missing \| broken(reason)`. Required-missing stays a hint-bearing error preserving today's exit codes; optional-missing = exactly one deduplicated `[warn] <tool> not installed — <install command>` per run. `SoT/toolchain.json` remains the single source of version/pin policy — `toolchain.ts` keeps gate/ensure orchestration and consumes the manager for probe/hint; the duplicated git hint collapses to one definition. | 5 | planned |
| 7 | **Tier 3 — Platform service** (`cli/src/engine-native/os.ts`): narrow capability seam — `platform()` (`linux/darwin/windows`), package-manager style for hints (winget/brew/apt-style wording only; per-tool package identifiers stay in `DependencySpec`), shell-rc applicability; symlink stays try-then-fallback (capability/error-driven, not platform-predicted). Scattered `process.platform` branches in sync modules route through it; pure path/exec helpers in `exec.ts` are exempt and listed in the policy spec. | 6 | planned |
| 8 | **Effect integration at the rim**: define `Context.Tag`s + live `Layer.succeed` layers for Logger/DependencyManager/Platform built from one shared factory; compose once at `cli/src/main.ts` and hand sync interfaces through the `engine.ts` seam; `native-raw` and `engineCapture` call the same factory directly. Test layers demonstrated in one unit test per service. | 5, 6, 7 | planned |
| 9 | **Verify + docs**: full suite green (`bun run test:unit`, `bun run golden:dryrun`, `bun run golden:mutation`, both prove-red legs `prove-red OK` + non-zero exit, `bun run typecheck`); manual smoke: first sync on a fresh fixture HOME shows changes + warns with hints, immediate re-run's default stderr shows warns/summary only; update `cli/docs/flags.md` + `cli/docs/overview.md`; CHANGELOG entry. | 5–8 | planned |

## Acceptance criteria

- [ ] Same-HOME replay golden case: second consecutive `sync` run at default verbosity emits **zero** stderr lines matching `already|present \(|up to date|left as-is|unchanged`; the same run with `--verbose` emits them. Verify: the Step-4 replay case asserts both.
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
- Step 3 research gate (2026-07-09, via the kit's own channels — `effect-solutions` CLI + the effect-kit `effect-ts-specialist` skill, which is pinned to Effect 3.x like this repo): CONFIRMED — for effect 3.21.4, `Context.Tag` + a separate `Layer` is the documented idiom for interface-first services with multiple implementations (live + test); `Effect.Service` is the one-obvious-impl sugar; provide layers ONCE at the application boundary (matches the one-composed-Layer-at-main.ts decision). VERSION TRAP recorded: `effect-solutions` v0.5.3 examples track the Effect 4 API line (`Context.Service`, `Schema.TaggedErrorClass`, `effect/unstable/*`) — never copy its shapes verbatim into this 3.21.4 repo; validate any API against the repo's own `effect` typings / language service. CONFIRMED — `Logger.minimumLogLevel` is a Layer filtering `Effect.log*` fiber events only; it cannot filter direct `process.stderr.write` calls from sync engine code → injected synchronous Logger with explicit filtering stands.
