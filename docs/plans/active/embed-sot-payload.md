---
title: Embed the SoT payload
goal: Make every sync/config read independent of a runtime SoT/ directory by generating one deterministic embedded payload for compiled and Bun/npm execution.
status: in_review
created: "2026-07-10T00:32:24-03:00"
updated: "2026-07-10T02:46:14-03:00"
started_at: "2026-07-10T01:40:37-03:00"
assignee: "codex gpt-5.6-sol xhigh (orchestrated by claude)"
tags: [cli, engine-native, payload, windows]
affected_paths:
  - SoT/.agents/skills.txt
  - SoT/models.json
  - SoT/toolchain.json
  - SoT/.claude/CLAUDE.md
  - SoT/.claude/mcp-servers.json
  - SoT/.claude/settings.json
  - SoT/.claude/statusline.sh
  - SoT/.claude/fetch-usage.sh
  - SoT/.claude/hooks/notify.sh
  - SoT/.codex/AGENTS.md
  - SoT/.codex/config.toml
  - SoT/.codex/plugins/marketplace.json
  - SoT/.codex/rules/docks.rules
  - notification.mp3
  - cli/scripts/generate-sot-payload.ts
  - cli/src/generated/sotPayload.ts
  - cli/src/payload.ts
  - cli/src/kitHome.ts
  - cli/src/manifests.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/engine-native/models.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/engine-native/exec.ts
  - cli/src/engine-native/DESIGN.md
  - cli/build-binaries.sh
  - docks-kit
  - package.json
  - .github/workflows/parity.yml
  - .github/workflows/windows-entrypoints.yml
  - README.md
  - AGENTS.md
  - cli/docs/overview.md
  - cli/docs/install.md
  - cli/docs/platforms.md
  - cli/test/unit/kitHome.test.ts
  - cli/test/unit/payload.test.ts
related_plans: [windows-support, engine-full-di]
review_status: passed
planned_at_commit: af68176d0ba9f0fed2b2b63bfebbfd20bfd04a23
---

## Goal

Ship one docks-kit executable/package that carries the complete declarative sync payload itself. A release binary copied into an otherwise empty directory and an npm/Bun global install launched from a foreign working directory must both perform Claude, Codex, agents, model, status, and toolchain operations without locating or reading a runtime `SoT/` directory. `SoT/` remains the reviewed authoring source in this repository; a deterministic build step turns its live files plus `notification.mp3` into the CLI payload.

The current Claude hook/statusline design is intentionally preserved. The three shell scripts remain authoring files, are embedded in the payload, and deploy with the same bytes, settings, permissions, operation order, and messages as before.

## Context & rationale

The release binary previously embedded the Bun runtime but not the kit payload. `kitHome()` required `SoT/` plus `package.json`, EngineNative used checkout paths for config reads and gates, and the npm package worked only because it published `SoT/` and `notification.mp3` beside `cli/src`. Runtime readers existed across Claude, Codex, agents, model, status, toolchain, orchestration gates, and the root launcher.

A generated TypeScript module gives standalone, packaged TypeScript, and checkout development the same in-memory contract. Bun's static file imports are not sufficient: standalone compilation can expose `/$bunfs/` assets, while direct Bun/npm execution still resolves file imports to disk. The 16,128-byte sound is small enough for base64.

User decisions retained:

1. **both Claude and Codex sync paths covered**
2. **SoT/ remains in the repo as build-time authoring source only — it stops being a runtime read dependency**

Scope decisions after the 2026-07-10 split:

- The prior decisions “statusline is KEPT — ported as a subcommand with byte-identical output, never dropped”, “jq necessity removed”, and “check if the current statusline could be better written as well, keeping the behavior/ui” transfer to a forthcoming research-first statusline-redesign plan. They are not implemented here.
- The per-user full-CLI hook runner decision is **WITHDRAWN**. No runner, hook subcommand, settings materializer, token-cache migration, latency benchmark, or native hook cutover belongs in this plan.
- The later Claude-presence runner-gate amendment is also **WITHDRAWN** because the runner itself is no longer part of this plan.
- Deployed shell hooks/statusline remain exactly as today. Their bytes come from the embedded payload instead of runtime authoring paths. `jq`/`curl` registry rows, preflight behavior, settings commands, and documentation claims stay unchanged.

## Interfaces & data shapes

### Generated payload contract

`cli/scripts/generate-sot-payload.ts` owns this exact stable allowlist:

```text
SoT/.agents/skills.txt
SoT/models.json
SoT/toolchain.json
SoT/.claude/CLAUDE.md
SoT/.claude/mcp-servers.json
SoT/.claude/settings.json
SoT/.claude/statusline.sh
SoT/.claude/fetch-usage.sh
SoT/.claude/hooks/notify.sh
SoT/.codex/AGENTS.md
SoT/.codex/config.toml
SoT/.codex/plugins/marketplace.json
SoT/.codex/rules/docks.rules
notification.mp3
```

UTF-8 files are exact strings and `notification.mp3` is base64 in committed `cli/src/generated/sotPayload.ts`. Stable key order is the list above. The generated header names the regeneration command and forbids hand edits. The generator also owns one marked `BUN_PIN="<verified>"` line in root `docks-kit`; the no-Bun bootstrap uses it directly without opening `SoT/toolchain.json` or invoking `jq` to select the pin.

```ts
export type PayloadPath = typeof GENERATED_PAYLOAD_PATHS[number]

export function payloadText(path: Exclude<PayloadPath, "notification.mp3">): string
export function payloadBytes(path: PayloadPath): Buffer
export function payloadPaths(prefix: string): ReadonlyArray<PayloadPath>
export function payloadDisplayPath(path: PayloadPath, kitHome?: string): string
```

`payloadDisplayPath` is presentation-only: when a checkout/package root exists it preserves existing `.../SoT/...` labels; otherwise it returns `embedded:<path>`. No sync decision or read depends on the display path.

The completeness inventory permits only `SoT/.codex/agents/.gitkeep` as an explicit authoring exclusion. The empty `SoT/.codex/bin/` directory has no bytes to embed. Any future file or exclusion requires an explicit generator/test decision.

`bun cli/scripts/generate-sot-payload.ts --check` exits 0 only when both the generated module and launcher pin are current. Binary builds and package prepack run this check before producing artifacts.

### Kit-home, engine, and asset contract

`kitHome()` no longer proves payload availability. It identifies an optional checkout/package home for update behavior and source labels only: `DOCKS_KIT_HOME` → nearest docks-kit `package.json` → package root → standalone executable directory. `Ctx.repoDir` remains the presentation/update home to avoid message churn.

All product runtime reads use `payloadText`, `payloadBytes`, or `payloadPaths`. User destination paths, merge order, backups, JSON/TOML bytes, plugin/model semantics, and output bytes stay unchanged. Claude's `syncScripts` and `syncHooks` retain their existing branches and messages while writing embedded script/sound bytes and repairing executable bits as before.

The npm package publishes the CLI (including the generated module), bundled docs, launcher, AGENTS, and README. It does not publish `SoT/` or `notification.mp3` as standalone files.

## Environment & how-to-run

- Repository root; Bun `1.3.14` (current verified pin). All mutation proofs use golden homes or temp homes; never mutate deployed user config.
- After every slice run separately:
  - `bun x tsc --noEmit -p cli/tsconfig.json` → exit 0.
  - `bun x vitest run` → all pass.
  - `bun cli/test/golden-dryrun.ts` → `golden-dryrun: OK (22 case(s))`.
  - `bun cli/test/golden-mutation.ts` → `golden-mutation: OK (47 case(s))`.
  - `bun cli/test/golden-dryrun.ts --prove-red` → contains `prove-red OK`, exits 1.
  - `bun cli/test/golden-mutation.ts --prove-red` → contains `prove-red OK`, exits 1.
- After payload changes, `bun cli/scripts/generate-sot-payload.ts --check` exits 0. Unit tests copy generator inputs to a temp root and prove independent `notification.mp3` and launcher-pin drift makes the check red without dirtying the checkout.
- Final standalone/package proof:
  1. Build `linux-x64` and copy the executable to a foreign temp directory.
  2. Pack/install the npm tarball and confirm its listing contains neither `package/SoT/` nor `package/notification.mp3`.
  3. For each artifact, unset `DOCKS_KIT_HOME`, use a foreign cwd/temp home with deterministic external-command stubs, and run `sync --dry-run`, `models claude`, `status --json`, `toolchain check`, and real `sync claude --skip-rtk`.
  4. Assert the real sync writes `statusline.sh`, `fetch-usage.sh`, `hooks/notify.sh`, `notification.mp3`, settings, CLAUDE.md, and mcp state with the authoring payload bytes/semantics.
- `.github/workflows/parity.yml` checks payload freshness and both relevant workflow path filters include `notification.mp3` plus root `docks-kit`. Windows entrypoint smoke runs the `.exe` from a foreign directory and the packed shim without published authoring files.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Generate and verify the initial payload.** Add the deterministic fixed-allowlist generator, committed text/base64 module plus identity, payload API, launcher Bun-pin marker, build/prepack freshness gates, full authoring inventory, and temp-root dirty-input tests. Keep package membership and consumers unchanged in this slice. | — | done |
| 2 | **Substitute non-hook readers without depublishing assets.** Migrate Claude/Codex/agents/model/toolchain/status/orchestration reads to the payload contract, make `kitHome` payload-independent, preserve output and merge/copy behavior, and leave the three Claude script reads plus launcher lookup for the final slice. Keep `SoT/` and sound in the package so intermediate artifacts remain functional. Prove compiled-checkout and packed-foreign-cwd real Claude sync. | 1 | done |
| 3 | **Complete the payload-only cutover.** Add all three Claude scripts to the payload; make the unchanged script/hook deployment branches consume embedded bytes; reduce the completeness exclusion to `.gitkeep`; remove `SoT/` and `notification.mp3` from npm files; replace the launcher runtime jq/SoT lookup with the generated pin; require the final runtime-read grep to be empty; add workflow freshness/trigger and foreign-cwd coverage; update only payload/runtime-delivery documentation. Do not change hook/settings/dependency behavior or any golden. Run the complete gate and final standalone/package proof. | 2 | done |

## Authorized golden changes

None. `--update-goldens` is not permitted in this plan. Dry-run remains 22 cases and mutation remains 47 cases. Any golden diff is a defect in the implementation slice.

## Acceptance criteria

- [x] The generator allowlist is exactly the 14 paths above; the only completeness exclusion is `.gitkeep`; every allowlisted generated byte matches its authoring source and the payload hash is deterministic.
- [x] `git grep -n -E 'readFileSync\([^\n]*SoT|p\([^\n]*"SoT"|join\([^\n]*"SoT"|existsSync\([^\n]*SoT|SoT/toolchain\.json' -- cli/src docks-kit` finds no product runtime read/gate. Remaining matches are generated data, documentation, display text, or generator/test authoring reads.
- [x] `bun cli/scripts/generate-sot-payload.ts --check` exits 0; temp-root tests independently prove sound and launcher-pin drift fail with the named stale surface.
- [x] The Linux standalone binary and installed packed-tarball shim run the identical foreign-cwd matrix from Environment with no checkout, `DOCKS_KIT_HOME`, or adjacent `SoT/`; no command reports “kit home not found.”
- [x] A foreign-cwd real Claude sync deploys all three existing shell scripts, notification bytes, settings, CLAUDE.md, and MCP state from the payload; deployed script/sound bytes equal authoring bytes and all existing settings commands/shape remain unchanged.
- [x] The packed tar listing contains neither `package/SoT/` nor `package/notification.mp3`; prepack and binary build reject stale generated state.
- [x] Root `docks-kit` obtains its Bun bootstrap pin only from the generated marker. Existing jq/curl preflight and deployed hook requirements remain unchanged.
- [x] Both relevant workflow push/pull-request filters include `notification.mp3` and `docks-kit`; parity runs the payload freshness gate; Windows entrypoint coverage exercises foreign-cwd embedded payload behavior.
- [x] No golden changes: normal suites report 22 dry-run and 47 mutation cases; both prove-red legs print `prove-red OK` and exit 1.
- [x] Typecheck, full Vitest, all golden legs, payload check, Linux build, packed-package inspection, and both artifact smokes meet the expected results above.

## Out of scope / do-NOT-touch

- Do not redesign, port, remove, reformat, or otherwise change the Claude statusline/hooks, their settings commands, output bytes, cache/security behavior, or player behavior. That work moves to the forthcoming research-first statusline-redesign plan.
- Do not add a compiled per-user runner, hook namespace, settings materializer, latency benchmark, token-cache migration, Claude-presence runner gate, or legacy-script cleanup.
- Do not change `jq`/`curl` registry classification, preflight behavior, requirement documentation, or remaining consumers.
- Do not delete `SoT/`, make generated code the authoring source, or hand-edit generated payload/golden files. Human changes begin in `SoT/` or `notification.mp3` and regenerate.
- Do not change settings merge/reconcile semantics, TOML order, plugin/model/toolchain behavior, universal-skill behavior, backups, messages, or operation order.
- Do not introduce a runtime extraction directory, network config fetch, second payload source, Node requirement, or new package dependency.
- Do not publish, push, or release from this plan. Implementation ends with green evidence and an in-review plan transition.

## Known gotchas

- Static `with { type: "file" }` imports alone do not satisfy npm/dev execution: Bun returns a disk path outside standalone mode. Keep the generated-module boundary.
- `.sh` uses Bun's shell-script loader and is unavailable to the bundler as ordinary code. Embedding exact script strings avoids that loader and retains the deployed files.
- `payloadDisplayPath` is presentation-only. A path label may name an authoring/package location that runtime logic never opens.
- `engineCapture` re-spawns `process.execPath`; compiled mode omits `main.ts` while Bun/npm mode includes it. Payload work must not disturb this argv seam.
- Package `prepack` runs the freshness check. A tarball that omits authoring files is valid only because every runtime reader, including Claude scripts and the root Bun pin, has already moved in the same final slice.
- Workflow filters must include indirect generator inputs (`notification.mp3` and root `docks-kit`) or a stale payload can bypass CI.

## Cold-handoff checklist

- **Files:** exact authoring inputs, generated/runtime modules, consumers, package/workflows, tests, and docs are in `affected_paths`.
- **Commands:** all regression gates, payload freshness, foreign-cwd artifact matrix, tar listing, and real Claude sync assertions are explicit in Environment.
- **Interfaces:** stable allowlist/order, public payload functions, display-only paths, kit-home role, script deployment, launcher pin, and package membership are fixed above.
- **Behavior:** message bytes, settings, scripts, jq/curl policy, operation order, and goldens must remain unchanged.
- **Split scope:** all native hook/statusline/runner work is explicitly transferred or withdrawn and fenced in Out of scope.

## Self-review

- The reduced plan keeps the complete runtime-reader audit while removing every native-hook assumption and artifact from the prior draft.
- The split would have left a package regression if the three shell scripts stayed authoring-only; they are now explicit payload entries and their existing sync branches consume embedded bytes before `SoT/` is depublished.
- The root launcher remains a distinct runtime reader; the generated Bun marker removes that read without changing jq/curl engine policy.
- CI trigger inputs include both non-`cli/**` payload surfaces, and artifact tests prove the absence of published authoring files rather than relying only on source-tree unit tests.
- Zero authorized golden changes is consistent with the retained hook/settings/message contract.

## Notes

- **2026-07-10T01:48:37-03:00 — Step 1 done.** Added the deterministic fixed-allowlist generator, committed in-memory text/base64 payload plus SHA-256 identity, payload reader API, generated launcher Bun pin, build/prepack freshness gates, whole-SoT completeness inventory with the four pre-cutover exclusions, and temp-root red tests for `notification.mp3` and `docks-kit`. Drift audit from `af68176` found no in-scope code changes before the slice. Gates: `tsc` exit 0; Vitest 7 files/40 tests passed; dry-run golden `OK (22 case(s))`; mutation golden `OK (47 case(s))`; both prove-red legs printed `prove-red OK` and exited 1; payload `--check` exit 0; `bun pm pack --dry-run` ran prepack and retained the pre-cutover SoT/sound; Linux x64 standalone build exit 0. No goldens changed and no runtime consumer was wired.
- **2026-07-10T01:59:15-03:00 — Step 2 done.** Replaced every non-hook runtime SoT/sound read in Claude, Codex, agents, model, toolchain, status/manifests, and orchestration with the generated payload; made `kitHome` package/executable-location-only; added text/byte write primitives; preserved all display labels, merge order, backups, and initial bytes. The required grep found only the three deferred legacy hook/script reads plus the deferred launcher jq lookup. Gates: `tsc` exit 0; Vitest 7 files/40 tests passed; dry-run golden `OK (22 case(s))`; mutation golden `OK (47 case(s))`; both prove-red legs printed `prove-red OK` and exited 1; payload `--check` exit 0; rebuilt Linux x64 binary performed a real temp-home Claude sync from the checkout; a freshly packed/global-installed tarball retained `SoT/` + sound and performed the same real sync from a foreign cwd. No goldens changed.
- **2026-07-10T02:10:00-03:00 — Scope split (user decision, orchestrator-relayed).** The native hooks/statusline half was cancelled and moves to a forthcoming research-first statusline-redesign plan. Decisions 1/2/6 from the prior hook draft transfer there; the per-user full-CLI runner and later Claude-presence gate are withdrawn. This plan now ends at a payload-only final slice: the three scripts remain embedded and deployed unchanged, package authoring files are removed, the launcher uses its generated pin, and payload CI/docs close the delivery contract.
- **2026-07-10T02:16:37-03:00 — Step 3 done.** Embedded the three retained Claude shell scripts and changed only their existing source reads to payload strings; removed `SoT/` and `notification.mp3` from npm membership; made the generated Bun pin the launcher's sole version source; added payload freshness/path-filter coverage and foreign-cwd Windows entrypoint assertions; and updated runtime-delivery documentation without changing hook/settings/jq/curl behavior. Runtime-read audit found no product filesystem read/gate; remaining matches are payload calls, generated data, or descriptions. Gates: `tsc` exit 0; Vitest 7 files/40 tests passed; dry-run golden `OK (22 case(s))`; mutation golden `OK (47 case(s))`; both prove-red legs printed `prove-red OK` and exited 1; payload `--check` exit 0; no golden files changed. Linux x64 standalone build exit 0. `bun pm pack` ran prepack and listed 50 files with neither `package/SoT/` nor `package/notification.mp3`; both the copied standalone and temp-global installed shim passed `sync --dry-run`, `models claude`, `status --json`, `toolchain check`, and real `sync claude --skip-rtk` from a foreign cwd with no `DOCKS_KIT_HOME`, then byte-verified statusline, fetch-usage, notify, settings, sound, and MCP deployment. Plan moved to `in_review` for the separate review pass.
- **2026-07-10T02:43:30-03:00 — Review fix round 1.** F1 corrected the stale invalid-`DOCKS_KIT_HOME` diagnostic to describe the actual docks-kit package-root contract and added a focused regression test; the test first failed with the old `SoT/ + package.json` message, then passed with the new package-name requirement. F2 removed the zero-caller `copyFileIfChanged`/`copyTreeIfChanged` helpers and their now-unused filesystem imports; a repository search finds no remaining symbol reference. Gates: `tsc` exit 0; Vitest 8 files/41 tests passed; dry-run golden `OK (22 case(s))`; mutation golden `OK (47 case(s))`; both prove-red legs printed `prove-red OK` and exited 1; payload `--check` exit 0; no golden update or diff.

## Sources

- `cli/src/engine-native/claudeSync.ts`, `syncScripts` and `syncHooks` — existing asset-copy branches, exact messages, executable repair, and pipeline order retained by the payload substitution.
- `cli/src/engine-native/codexSync.ts` — Codex config/rules/AGENTS/marketplace consumers moved from paths to payload text.
- `cli/src/engine-native/skillsSync.ts`, `models.ts`, `modes.ts`, `toolchain.ts`, `manifests.ts`, and `index.ts` — secondary payload readers and orchestration gates included in the runtime-read audit.
- `cli/src/kitHome.ts` — optional checkout/package/update home resolution after payload availability is removed from the contract.
- `docks-kit` — generated Bun pin and former launcher jq/SoT runtime lookup.
- `package.json` — npm bin/prepack/package membership.
- `.github/workflows/parity.yml` and `.github/workflows/windows-entrypoints.yml` — freshness, trigger inputs, compiled `.exe`, and packed-shim smoke surfaces.
- https://bun.sh/docs/bundler/executables — official Bun standalone compile and embedded-file behavior.
- https://bun.sh/docs/bundler/loaders — official Bun loader behavior, including the shell-script loader limitation.
- https://bun.sh/docs/pm/cli/pack — official package lifecycle behavior used by the prepack freshness gate.

## Review

**Verdict: PASSED** — the goal (every sync/config read independent of a runtime `SoT/` directory, via one deterministic embedded payload for compiled AND Bun/npm delivery) is delivered and independently re-verified from the plan's own commands (implementation range `9bb3b94..HEAD`: 4ed8b2e, 0e6f68b, 090969b, 907dcae).

- **Goal met:** yes — a fresh `linux-x64` standalone copied alone into an empty foreign dir (no `SoT/`, no `DOCKS_KIT_HOME`) ran `sync --dry-run`, `models claude`, `status --json`, `toolchain check`, and real `sync claude --skip-rtk`; no command reported "kit home not found". The packed tarball ships the CLI without authoring files yet carries the generated payload module.
- **Regressions:** none. Runtime-read grep (`readFileSync|p(…"SoT")|join(…"SoT")|existsSync(…SoT)|SoT/toolchain.json` over `cli/src docks-kit`) returns only `payloadText(...)` payload-key calls, generated data, comments, and display strings — zero product filesystem reads/gates. Deployed `statusline.sh`, `fetch-usage.sh`, `hooks/notify.sh`, and `notification.mp3` are byte-identical to authoring sources with exec bits repaired; `CLAUDE.md` differs by exactly the pre-existing `@RTK.md` import-strip (claudeSync.ts:201, triggered by `--skip-rtk`), not a payload defect. Scope-drift: every changed file is within `affected_paths`.
- **Acceptance criteria:** all verified from source commands, not checkboxes — allowlist is 14 paths (13 text + `notification.mp3`), sole exclusion `SoT/.codex/agents/.gitkeep`; `generate-sot-payload.ts --check` exit 0; `tsc` exit 0; Vitest 8 files/41 tests; golden dry-run `OK (22 case(s))` and mutation `OK (47 case(s))`; both prove-red legs print `prove-red OK` and exit 1; `bun pm pack` → 50 files, neither `package/SoT/` nor `package/notification.mp3`, prepack freshness gate ran; `docks-kit` Bun pin sourced only from `BUN_PIN="1.3.14"` marker (no jq/SoT lookup); both `parity.yml` and `windows-entrypoints.yml` push/PR filters include `notification.mp3` + `docks-kit`, parity runs the freshness gate.
- **Cross-check:** [codex gpt-5.6-sol xhigh] 2 findings (2 low) — 2 accepted, both fixed in 907dcae (red/green proven); [claude] independently verified closure.
- **CI:** pass — tsc, Vitest (41), dry-run (22) + mutation (47) goldens, both prove-red legs (exit 1), payload `--check`, `linux-x64` build, tarball inspection, and both foreign-cwd artifact smokes all green this session.
- **Follow-ups:** none blocking. Native hooks/statusline/runner scope was split by user decision to a forthcoming research-first statusline-redesign plan (retained shell hooks + jq/curl requirements are that plan's scope, not gaps here).
- **Filed by:** 2026-07-10T02:46:14-03:00
