---
title: Add workflow model role overrides
goal: Add strict docks-kit workflow-role and review-bound overrides that emit one identical Docks workflow record to Claude and Codex global instructions.
status: ongoing
created: "2026-07-15T18:51:35-03:00"
updated: "2026-07-15T19:49:52-03:00"
started_at: "2026-07-15T19:09:18-03:00"
assignee: null
review_author_company: openai
review_author_tool: codex
review_author_model: gpt-5.6-sol
review_author_effort: xhigh
review_waivers: []
tags:
  - cli
  - workflow-models
  - docks
affected_paths:
  - SoT/models.json
  - SoT/.claude/settings.json
  - SoT/.claude/CLAUDE.md
  - SoT/.codex/AGENTS.md
  - cli/src/workflowModels.ts
  - cli/src/commands/models.ts
  - cli/src/main.ts
  - cli/src/efforts.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/engine-native/workflowDeploy.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/generated/sotPayload.ts
  - cli/test/unit/workflowModels.test.ts
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/payload.test.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/docs/models.md
  - cli/docs/flags.md
  - cli/docs/modifiers.md
  - README.md
  - AGENTS.md
  - CLAUDE.md
related_plans:
  - "docks:workflow-model-roles-and-bounded-reviews"
review_status: null
planned_at_commit: 0dcbd24e8963dfb180e26e24e3a94960057443d8
execution_base_commit: 9caeb7e278c96c6aeb01170ccafdb81a9380cae5
---

## Goal

Ship a strict, self-documenting workflow configuration surface:

- `docks-kit models workflow [--json]` lists the closed profile/selector
  registry, expanded candidates, valid tool models/efforts, and states that live
  availability is checked when used.
- Root flags `--model-orchestrator`, `--model-reviewer`,
  `--model-implementer`, `--review-min-score`, and
  `--review-max-rounds` update one complete workflow record in both deployed
  global instruction files without running an unrelated full sync.
- A normal flagless `docks-kit sync` deploys the default record again.
- Invalid input fails before either global instruction file changes.
- Claude's SoT permission list uses the supported `Edit(...)` matcher for file
  edits and contains no obsolete path-qualified `Write(...)` rules.

## Context & rationale

The released Docks plan-manager/plan-review contract now consumes an
already-loaded, compact `Docks-workflow-models:` record. Docks owns review
dispatch, candidate availability classification, score gating, bounded rounds,
and implementation handoff. This repository owns the user-facing catalog,
strict selector validation, override persistence in deployed prompt files, and
help/docs.

The user selected these defaults:

- Orchestrator: `profile:claude-best`, expanding to
  `claude:fable@high` then `claude:opus@xhigh`.
- Reviewer: `codex:gpt-5.6-sol@xhigh`.
- Implementer: `codex:gpt-5.6-sol@xhigh`.
- Review target: 90.
- Review batch cap: 3.

The `profile:` namespace is deliberate: `claude:best@high` remains Claude's
native one-model alias, while `profile:claude-best` is the Docks-managed
two-candidate chain. This prevents a future native model/profile name collision.

Root override flags are a workflow-only operation, not an alias for
`docks-kit sync`. A partial invocation merges omitted values from the one
currently deployed valid record; when no record exists it starts from defaults.
One valid record may repair a missing parallel record. Conflicting or invalid
deployed records STOP before mutation. The command prepares both output
documents before committing either and restores the first from its snapshot if
the second write fails.

During execution the repository owner added one scoped SoT repair: current
Claude permission diagnostics reject path-qualified `Write(...)` rules because
`Edit(...)` is the matcher that covers all built-in file-editing tools. The SoT
already has the equivalent four `Edit(...)` rules, so this change removes only
the redundant unsupported `Write(...)` entries.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`, branch `main`.
- Planning base: `0dcbd24e8963dfb180e26e24e3a94960057443d8`.
- Runtime/package manager: Bun from `SoT/toolchain.json`; run
  `bun install --frozen-lockfile` only when dependencies are absent.
- Generate embedded SoT after any `SoT/**` edit:
  `bun cli/scripts/generate-sot-payload.ts`.
- Focused unit tests:
  `bun run test:unit cli/test/unit/workflowModels.test.ts cli/test/unit/engine-di.test.ts cli/test/unit/payload.test.ts`.
- Focused golden tests:
  `GOLDEN_FILTER='workflow|role override|review bound' bun run golden:dryrun`
  and the matching `golden:mutation` command.
- Required project CI, once at the pre-commit boundary:
  `bun run typecheck && bun run test:unit && bun run golden:dryrun && bun run golden:mutation`.
- No new dependency or external API is required.

## Interfaces & data shapes

### Strict registry

`SoT/models.json` remains the model source and gains a closed `workflow`
section consumed through the generated payload. `cli/src/workflowModels.ts`
owns parsing, validation, expansion, rendering, and compact lexicographic JCS.
Use readonly/discriminated TypeScript shapes; do not duplicate the registry in
CLI code.

```ts
type WorkflowTool = "claude" | "codex"

type WorkflowCandidate = {
  company: "anthropic" | "openai"
  tool: WorkflowTool
  model: string
  effort: string
}

type WorkflowRole = {
  selector: string
  candidates: readonly WorkflowCandidate[]
}

type WorkflowRecordV1 = {
  schema: 1
  orchestrator: WorkflowRole
  reviewer: WorkflowRole
  implementer: WorkflowRole
  review: {
    minimum_score: number
    max_rounds: number
  }
}
```

The machine helper output is a closed registry, not a live availability report:

```json
{
  "schema": 1,
  "profiles": {
    "claude-best": {
      "candidates": [
        { "company": "anthropic", "tool": "claude", "model": "fable", "effort": "high" },
        { "company": "anthropic", "tool": "claude", "model": "opus", "effort": "xhigh" }
      ]
    }
  },
  "defaults": {
    "orchestrator": "profile:claude-best",
    "reviewer": "codex:gpt-5.6-sol@xhigh",
    "implementer": "codex:gpt-5.6-sol@xhigh",
    "review": { "minimum_score": 90, "max_rounds": 3 }
  },
  "tools": {
    "claude": { "models": ["<all kit-verified ids>"], "efforts": ["low", "medium", "high", "xhigh"] },
    "codex": { "models": ["<all kit-verified ids>"], "efforts": ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] }
  },
  "exact_target_grammar": "<tool>:<model>@<effort>",
  "availability": "checked_when_used"
}
```

### Selector and bound validation

Accepted selector forms are exactly:

```text
profile:<profile-name>
<tool>:<model>@<effort>
```

- `tool` is exactly `claude` or `codex`.
- Profile names must exist in the workflow registry.
- Exact-target model and effort must both be kit-verified for that tool.
- Workflow selectors never inherit the permissive unknown-model behavior in
  `cli/src/engine-native/models.ts`.
- `minimum_score` is a base-10 integer in `0..100`.
- `max_rounds` is a base-10 integer in `1..10`.
- Empty values, whitespace variants, floats, signs, exponents, and leading or
  trailing junk exit 2.

### Deployed record

Both `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` contain exactly one
byte-identical compact-JCS line:

```text
Docks-workflow-models: {"implementer":{"candidates":[{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@xhigh"},"orchestrator":{"candidates":[{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"selector":"profile:claude-best"},"review":{"max_rounds":3,"minimum_score":90},"reviewer":{"candidates":[{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@xhigh"},"schema":1}
```

The upsert removes duplicate identical lines, rejects conflicting/invalid lines
for root overrides, and appends exactly one final record with stable newline
handling. Normal sync renders the embedded default record and therefore resets
prior deploy-time workflow overrides.

## Steps

| # | Task | Files | Depends | Status | Done condition |
|---|---|---|---|---|---|
| 1 | Add the closed workflow registry and pure contract helpers for exact selector parsing, profile expansion, strict model/effort membership, bounded integers, record validation, and compact JCS. Keep existing deploy-time model validators permissive. | `SoT/models.json:1-31`; new `cli/src/workflowModels.ts`; `cli/src/efforts.ts:4-42`; read-only boundary `cli/src/engine-native/models.ts:30-71` | none | planned | Defaults expand exactly as specified; strict workflow validation rejects unknown models/efforts/profiles and bad bounds without changing `validateClaudeModel`/`validateCodexModel` behavior. |
| 2 | Extend the helper and root CLI. `models workflow [--json]` renders the registry; the five root flags route to a dedicated raw `workflow` EngineNative mode. Bare role flags print the workflow helper plus missing-value usage and exit 2; explicit empty/invalid values use the same validation path. | `cli/src/commands/models.ts:1-46`; `cli/src/main.ts:17-84`; `cli/src/engine-native/index.ts:20-105`; `cli/src/engine-native/parseArgs.ts:27-316` | 1 | planned | Root help lists all five flags; root overrides do not run full sync; helper text and JSON agree; every invalid/bare case exits 2 before write preparation. |
| 3 | Deploy the record safely. Add the exact default line to both prompt SoTs, regenerate the embedded payload, share one record-upsert helper between Claude/Codex sync, and implement workflow-only prepare/commit with partial-override merge, duplicate repair, conflict STOP, idempotence, snapshot rollback, and fresh-session guidance. | `SoT/.claude/CLAUDE.md`; `SoT/.codex/AGENTS.md`; new `cli/src/engine-native/workflowDeploy.ts`; `cli/src/engine-native/claudeSync.ts:206-242`; `cli/src/engine-native/codexSync.ts:263-280`; `cli/src/generated/sotPayload.ts` | 1, 2 | planned | Normal sync writes defaults; a root override writes one identical complete line to both deployed prompts; omitted fields persist; invalid/conflicting input leaves both byte-identical to pre-run snapshots; a second identical run is a no-op. |
| 4 | Add focused unit and golden coverage, including generated-payload integrity. At the producer boundary, fixtures prove the ordered Fable→Opus chain is preserved for Docks candidate-specific fallback and that no docks-kit helper/preflight claims provider-wide fallback; Docks remains the runtime classifier. | new `cli/test/unit/workflowModels.test.ts`; `cli/test/unit/engine-di.test.ts`; `cli/test/unit/payload.test.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json` | 1-3 | planned | Tests cover defaults, exact/profile selectors, all bounds, partial/all overrides, bare/empty failures, no-mutation failures, one-sided repair, divergent-record STOP, rollback, idempotent replay, stable JSON/JCS, and producer/runtime availability ownership. Every planted workflow mutation is detected. |
| 5 | Update public help/docs, remove the four obsolete path-qualified Claude `Write(...)` permission rules, regenerate SoT, inspect the diff, then run the focused acceptance inventory and one required broad gate. | `README.md`; `AGENTS.md`; `CLAUDE.md`; `cli/docs/models.md`; `cli/docs/flags.md`; `cli/docs/modifiers.md`; `SoT/.claude/settings.json`; `cli/src/generated/sotPayload.ts` | 1-4 | planned | Docs distinguish `claude:best@high` from `profile:claude-best`, explain reset/partial-update semantics and attempt-as-probe availability; Claude permissions retain the four supported `Edit(...)` rules and no path-qualified `Write(...)` rules; every acceptance row passes, full CI passes once, and `git diff --check` is clean. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `bun cli/scripts/generate-sot-payload.ts --check` | Exits 0; generated payload exactly matches the edited SoT and package inputs. |
| A2 | `bun run test:unit cli/test/unit/workflowModels.test.ts cli/test/unit/engine-di.test.ts cli/test/unit/payload.test.ts` | Exits 0; focused workflow validation, raw-mode dispatch, rollback/idempotence, and payload tests pass. |
| A3 | `GOLDEN_FILTER='workflow|role override|review bound' bun run golden:dryrun` | Exits 0; selected helper/root-flag/default/override/error cases match committed goldens, including no-mutation failures. |
| A4 | `GOLDEN_FILTER='workflow|role override|review bound' bun run golden:mutation` | Exits 0 and reports every selected planted mutation detected. |
| A5 | `bun cli/src/main.ts models workflow --json | jq -e '.schema == 1 and .defaults.orchestrator == "profile:claude-best" and .defaults.reviewer == "codex:gpt-5.6-sol@xhigh" and .defaults.implementer == "codex:gpt-5.6-sol@xhigh" and .defaults.review.minimum_score == 90 and .defaults.review.max_rounds == 3 and .profiles["claude-best"].candidates[0].model == "fable" and .profiles["claude-best"].candidates[1].model == "opus" and .availability == "checked_when_used"'` | Exits 0; machine helper exposes the exact defaults and ordered profile. |
| A6 | `jq -e '(.permissions.allow | index("Edit(./)") != null and index("Write(./)") == null) and (.permissions.deny | index("Edit(**/.env)") != null and index("Edit(**/.env.local)") != null and index("Edit(**/secrets/**)") != null and all(.[]; startswith("Write(") | not))' SoT/.claude/settings.json` | Exits 0; supported Edit rules remain and every obsolete path-qualified Write rule is absent. |

The required project CI is
`bun run typecheck && bun run test:unit && bun run golden:dryrun && bun run golden:mutation`.
Completion runs it once after A1-A6; it is not duplicated as an acceptance row.

## Out of scope / do-NOT-touch

- Docks plan-manager/plan-review policy, scoring, receipts, or review transport:
  released Docks `0.12.6` owns those runtime semantics.
- Session Relay Rust/binaries or review transport: relay remains
  implementation-handoff only.
- A second availability classifier in this repo: docks-kit emits configured
  candidates and never consumes quota or predicts availability.
- Existing permissive `--claude-model` / `--codex-model` behavior:
  workflow selectors are a separate strict validation layer.
- Native Claude fallback flags: the managed profile applies different efforts
  per candidate, so Docks must launch candidates explicitly.
- New dependencies, network probes, background daemons, or secret storage.

## Known gotchas

- The Effect CLI currently routes explicit empty text options through
  `main.ts` normalization; workflow flags need the same empty/bare test
  coverage or the typed CLI may swallow them before EngineNative can print the
  required helper.
- The raw EngineNative channel powers golden tests and must expose the same
  workflow mode and error strings as the public CLI.
- `SoT/models.json` is embedded; editing it without regenerating
  `cli/src/generated/sotPayload.ts` creates source/binary drift.
- Global prompt files are loaded at session start. A successful write does not
  retarget an already-running Claude/Codex parent; print restart/fresh-session
  guidance.
- One-sided write failure can create a conflicting pair. Prepare both outputs
  first and restore the first snapshot if the second commit fails.
- `default` is a deploy-time model pseudo-value and must not become a valid
  exact workflow target unless it represents an executable kit-verified model;
  strict membership tests must make this distinction explicit.

## Global constraints

- Selectors: exactly `profile:<name>` or `<tool>:<model>@<effort>`.
- Defaults: Fable/high then Opus/xhigh; Sol/xhigh reviewer and implementer; score
  90; rounds 3.
- Bounds: `minimum_score` integer `0..100`; `max_rounds` integer `1..10`.
- Output: one compact-JCS `Docks-workflow-models:` line, identical in both
  global instruction files.
- Validation: all five supplied values validate before either file changes.
- Availability: the real Docks operation is the authoritative model probe;
  candidate-specific terminal failures may advance, while provider-wide,
  authentication, billing, shared-quota, generic rate-limit, transport, and
  ambiguous failures STOP rotation.
- Security: no secrets in SoT; no unverified dependency or installer.
- Claude file permission matchers: use `Edit(...)`, which covers all built-in
  file-editing tools; do not add path-qualified `Write(...)` rules.
- Testing: direct acceptance, focused regression, then one full pre-commit gate.

## STOP conditions

- STOP before writes if existing valid Claude/Codex workflow records conflict,
  any existing record is malformed/internally inconsistent, or a requested
  selector/bound is invalid.
- STOP and restore snapshots if the two deployed prompt files cannot be left
  with byte-identical workflow records.
- STOP if implementing root flags requires silently running unrelated sync
  layers or mutating the committed SoT.
- STOP if tests require duplicating Docks runtime availability classification;
  test the producer boundary and keep runtime classification in Docks.
- STOP if a model/effort is not verified in the current catalog; research and
  update the catalog first instead of accepting it with a warning.

## Cold-handoff checklist

- [x] File manifest: every step names exact existing edit anchors and new paths.
- [x] Environment & commands: Bun setup, generation, focused tests, goldens, and
  the one broad gate are explicit.
- [x] Interface & data contracts: selector grammar, registry JSON, record types,
  exact defaults, merge behavior, and output line are closed above.
- [x] Executable acceptance: A1-A5 are ordered commands with binary expected
  outcomes; project CI is recorded separately.
- [x] Out of scope: Docks/session-relay runtime behavior, permissive deploy
  flags, native fallback, probes, dependencies, and secrets are excluded.
- [x] Decision rationale: namespace collision, root-vs-sync scope, partial
  updates, reset semantics, and producer/runtime ownership are explained.
- [x] Known gotchas: Effect parsing, raw harness parity, generated payload,
  session loading, two-file writes, and `default` are recorded.
- [x] Global constraints: selector/default/bound/JCS/availability/security/test
  contracts are copied above.
- [x] No undefined terms / forward refs: every new module, type, command, flag,
  fixture responsibility, and acceptance path is defined.

## Self-review

Score: 96/100 · one local pass · caught: partial flags initially lacked a
stable merge base; root overrides were ambiguous with full sync; the
fallback-fixture requirement risked duplicating Docks' classifier. The revision
defines current-record/default merge, a workflow-only mode, two-file rollback,
and producer-boundary fixtures.

Cross-check (2026-07-15T19:05:21-03:00): [X: anthropic fable high] platform_denied before launch
by managed policy; [S: openai gpt-5.6-sol xhigh] platform_denied before launch
because the host read-only filesystem prevents Codex app-server initialization;
[codex] no reviewer findings were produced. Zero-review progression was
explicitly authorized by the repository owner.
Review-receipt: {"S":{"raw":{"attempts":[{"child_id":null,"denial_source":"sandbox","effort":"xhigh","exit_code":null,"model":"gpt-5.6-sol","output_started":false,"reason":"host read-only filesystem prevents Codex app-server initialization","result":"platform_denied","retry_cause":null,"schema":1,"signal":null,"started":false,"stderr_sha256":null,"stdout_sha256":null,"timeout_mode":null,"timeout_seconds":600,"transport":"cli"}],"decision_evidence":null,"findings":[],"findings_sha256":null,"leg":"S","reason":"host read-only filesystem prevents Codex app-server initialization","request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"9cfa0ee660dc64cc15e157715a6054fd89b9519106ddebb7522b9a48f3575d11","diff_sha256":null,"execution_base_commit":null,"input_sha256":"1238693de765012a9cfde2ca127dcb87c2bc24c0c783d10e7e26df77c3bc74b2","lifecycle_intent":"start","phase":"draft","planned_at_commit":null,"policy":{"anthropic_tiers":[{"effort":"high","model":"fable","transports":["in_session","cli"]},{"effort":"xhigh","model":"opus","transports":["in_session","cli"]}],"cross_company_consent":"always","max_rounds":3,"minimum_score":90,"openai_tiers":[{"effort":"xhigh","model":"gpt-5.6-sol","transports":["in_session","cli"]}],"orchestrator_preference":"auto","provenance":{"anthropic_tiers":"current_user","cross_company_consent":"runtime_global","max_rounds":"current_user","minimum_score":"current_user","openai_tiers":"current_user","orchestrator_preference":"skill_default","zero_reviewer_policy":"skill_default"},"schema":2,"zero_reviewer_policy":"ask"},"policy_sha256":"1731178b4544ddb454feb6e4c2c11efa193d7d5549daaf41251c45b2dd68f5fb","request_id":"0ceda366-8db3-4632-9790-2ddc2139197c","reviewed_commit_or_head":"34abd870c255c2b6af6733be281567c636e84c81","schema":1},"result":"platform_denied","reviewer_output":null,"schema":1,"selected":null,"severity_totals":{"high":0,"low":0,"medium":0},"waiver":null,"waiver_sha256":null},"reconciliation":{"accepted":[],"rejected":[]},"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"9cfa0ee660dc64cc15e157715a6054fd89b9519106ddebb7522b9a48f3575d11","diff_sha256":null,"execution_base_commit":null,"input_sha256":"1238693de765012a9cfde2ca127dcb87c2bc24c0c783d10e7e26df77c3bc74b2","lifecycle_intent":"start","phase":"draft","planned_at_commit":null,"policy":{"anthropic_tiers":[{"effort":"high","model":"fable","transports":["in_session","cli"]},{"effort":"xhigh","model":"opus","transports":["in_session","cli"]}],"cross_company_consent":"always","max_rounds":3,"minimum_score":90,"openai_tiers":[{"effort":"xhigh","model":"gpt-5.6-sol","transports":["in_session","cli"]}],"orchestrator_preference":"auto","provenance":{"anthropic_tiers":"current_user","cross_company_consent":"runtime_global","max_rounds":"current_user","minimum_score":"current_user","openai_tiers":"current_user","orchestrator_preference":"skill_default","zero_reviewer_policy":"skill_default"},"schema":2,"zero_reviewer_policy":"ask"},"policy_sha256":"1731178b4544ddb454feb6e4c2c11efa193d7d5549daaf41251c45b2dd68f5fb","request_id":"0ceda366-8db3-4632-9790-2ddc2139197c","reviewed_commit_or_head":"34abd870c255c2b6af6733be281567c636e84c81","schema":1}},"X":{"raw":{"attempts":[{"child_id":null,"denial_source":"managed_policy","effort":"high","exit_code":null,"model":"fable","output_started":false,"reason":"host managed policy denied sealed bundle export to the external Claude service","result":"platform_denied","retry_cause":null,"schema":1,"signal":null,"started":false,"stderr_sha256":null,"stdout_sha256":null,"timeout_mode":null,"timeout_seconds":600,"transport":"cli"}],"decision_evidence":null,"findings":[],"findings_sha256":null,"leg":"X","reason":"host managed policy denied sealed bundle export to the external Claude service","request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"9cfa0ee660dc64cc15e157715a6054fd89b9519106ddebb7522b9a48f3575d11","diff_sha256":null,"execution_base_commit":null,"input_sha256":"1238693de765012a9cfde2ca127dcb87c2bc24c0c783d10e7e26df77c3bc74b2","lifecycle_intent":"start","phase":"draft","planned_at_commit":null,"policy":{"anthropic_tiers":[{"effort":"high","model":"fable","transports":["in_session","cli"]},{"effort":"xhigh","model":"opus","transports":["in_session","cli"]}],"cross_company_consent":"always","max_rounds":3,"minimum_score":90,"openai_tiers":[{"effort":"xhigh","model":"gpt-5.6-sol","transports":["in_session","cli"]}],"orchestrator_preference":"auto","provenance":{"anthropic_tiers":"current_user","cross_company_consent":"runtime_global","max_rounds":"current_user","minimum_score":"current_user","openai_tiers":"current_user","orchestrator_preference":"skill_default","zero_reviewer_policy":"skill_default"},"schema":2,"zero_reviewer_policy":"ask"},"policy_sha256":"1731178b4544ddb454feb6e4c2c11efa193d7d5549daaf41251c45b2dd68f5fb","request_id":"0ceda366-8db3-4632-9790-2ddc2139197c","reviewed_commit_or_head":"34abd870c255c2b6af6733be281567c636e84c81","schema":1},"result":"platform_denied","reviewer_output":null,"schema":1,"selected":null,"severity_totals":{"high":0,"low":0,"medium":0},"waiver":null,"waiver_sha256":null},"reconciliation":{"accepted":[],"rejected":[]},"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"9cfa0ee660dc64cc15e157715a6054fd89b9519106ddebb7522b9a48f3575d11","diff_sha256":null,"execution_base_commit":null,"input_sha256":"1238693de765012a9cfde2ca127dcb87c2bc24c0c783d10e7e26df77c3bc74b2","lifecycle_intent":"start","phase":"draft","planned_at_commit":null,"policy":{"anthropic_tiers":[{"effort":"high","model":"fable","transports":["in_session","cli"]},{"effort":"xhigh","model":"opus","transports":["in_session","cli"]}],"cross_company_consent":"always","max_rounds":3,"minimum_score":90,"openai_tiers":[{"effort":"xhigh","model":"gpt-5.6-sol","transports":["in_session","cli"]}],"orchestrator_preference":"auto","provenance":{"anthropic_tiers":"current_user","cross_company_consent":"runtime_global","max_rounds":"current_user","minimum_score":"current_user","openai_tiers":"current_user","orchestrator_preference":"skill_default","zero_reviewer_policy":"skill_default"},"schema":2,"zero_reviewer_policy":"ask"},"policy_sha256":"1731178b4544ddb454feb6e4c2c11efa193d7d5549daaf41251c45b2dd68f5fb","request_id":"0ceda366-8db3-4632-9790-2ddc2139197c","reviewed_commit_or_head":"34abd870c255c2b6af6733be281567c636e84c81","schema":1}},"author":{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"},"decision_evidence":{"actor":"repository owner","at":"2026-07-15T19:05:21-03:00","decision":"proceed","input_sha256":"1238693de765012a9cfde2ca127dcb87c2bc24c0c783d10e7e26df77c3bc74b2","kind":"zero_reviewer","reason":"Explicit user direction to proceed, start, and finish this downstream plan despite authoritative host denials","request_id":"0ceda366-8db3-4632-9790-2ddc2139197c","schema":1},"input_sha256":"1238693de765012a9cfde2ca127dcb87c2bc24c0c783d10e7e26df77c3bc74b2","outcome":"zero_degraded","phase":"draft","policy":{"anthropic_tiers":[{"effort":"high","model":"fable","transports":["in_session","cli"]},{"effort":"xhigh","model":"opus","transports":["in_session","cli"]}],"cross_company_consent":"always","max_rounds":3,"minimum_score":90,"openai_tiers":[{"effort":"xhigh","model":"gpt-5.6-sol","transports":["in_session","cli"]}],"orchestrator_preference":"auto","provenance":{"anthropic_tiers":"current_user","cross_company_consent":"runtime_global","max_rounds":"current_user","minimum_score":"current_user","openai_tiers":"current_user","orchestrator_preference":"skill_default","zero_reviewer_policy":"skill_default"},"schema":2,"zero_reviewer_policy":"ask"},"policy_sha256":"1731178b4544ddb454feb6e4c2c11efa193d7d5549daaf41251c45b2dd68f5fb","pre_execution_eligible":true,"reproduced":[],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"9cfa0ee660dc64cc15e157715a6054fd89b9519106ddebb7522b9a48f3575d11","diff_sha256":null,"execution_base_commit":null,"input_sha256":"1238693de765012a9cfde2ca127dcb87c2bc24c0c783d10e7e26df77c3bc74b2","lifecycle_intent":"start","phase":"draft","planned_at_commit":null,"policy":{"anthropic_tiers":[{"effort":"high","model":"fable","transports":["in_session","cli"]},{"effort":"xhigh","model":"opus","transports":["in_session","cli"]}],"cross_company_consent":"always","max_rounds":3,"minimum_score":90,"openai_tiers":[{"effort":"xhigh","model":"gpt-5.6-sol","transports":["in_session","cli"]}],"orchestrator_preference":"auto","provenance":{"anthropic_tiers":"current_user","cross_company_consent":"runtime_global","max_rounds":"current_user","minimum_score":"current_user","openai_tiers":"current_user","orchestrator_preference":"skill_default","zero_reviewer_policy":"skill_default"},"schema":2,"zero_reviewer_policy":"ask"},"policy_sha256":"1731178b4544ddb454feb6e4c2c11efa193d7d5549daaf41251c45b2dd68f5fb","request_id":"0ceda366-8db3-4632-9790-2ddc2139197c","reviewed_commit_or_head":"34abd870c255c2b6af6733be281567c636e84c81","schema":1},"reviewed_at":"2026-07-15T19:05:21-03:00","reviewed_commit":"34abd870c255c2b6af6733be281567c636e84c81","schema":1}

## Review

(filled by plan-review on completion)

## Mistakes & Dead Ends

- None.

## Sources

- `SoT/models.json:1-31` — current model catalog distinguishes Claude aliases
  and IDs from Codex IDs but has no workflow registry.
- `cli/src/commands/models.ts:6-45` — existing `models [tool] [--json]`
  command is the helper extension seam.
- `cli/src/main.ts:17-84` — root has no options today and owns argv
  normalization before Effect CLI dispatch.
- `cli/src/efforts.ts:4-42` — verified per-tool effort sets already have one
  canonical implementation.
- `cli/src/engine-native/models.ts:30-71` — current deploy-time model
  validation is deliberately permissive; workflow validation must stay
  separate and strict.
- `cli/src/engine-native/parseArgs.ts:27-316` — raw flag parsing, missing-value
  help, explicit-empty tracking, and validation are centralized here.
- `cli/src/engine-native/claudeSync.ts:206-242` — Claude global instructions
  are materialized here, including the RTK-import variant.
- `cli/src/engine-native/codexSync.ts:263-280` — Codex global instructions are
  currently copied as one document with backup/restart signaling.
- `cli/scripts/generate-sot-payload.ts:28-73` — deterministic generated
  payload embeds every SoT text input and its hash.
- `cli/test/lib/harness.ts:468-475` — `GOLDEN_FILTER` supports bounded
  command-surface test runs.
- `package.json:22-34` — canonical typecheck/unit/golden scripts and pinned
  Effect/Bun-facing dependencies.
- `SoT/.claude/settings.json:12-97` — the correct `Edit(...)` allow/deny rules
  already exist alongside four obsolete path-qualified `Write(...)` duplicates.
- `https://code.claude.com/docs/en/permissions` — current official permission
  syntax says `Edit` rules apply to all built-in file-editing tools.
- `/home/vagrant/projects/docks/docs/plans/finished/2026-07-15-workflow-model-roles-and-bounded-reviews.md` — released producer/consumer contract and downstream gate.

## Notes

- Docks `0.12.6` release and GitHub CI passed before this plan was created.
- Codex and Claude both report Docks `0.12.6`; source/Codex/Claude
  `review-policy.mjs` SHA-256 is
  `ca394afcd98863c55aba9a0d38421e45a5a48f90597e29010932edbfcaea8d3c`.
