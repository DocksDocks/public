---
title: Deploy standing cross-company review consent
goal: Deploy one concise runtime-global rule that pre-authorizes Docks cross-company plan review without bypassing host security policy or authorizing unrelated exports.
status: finished
created: "2026-07-12T00:37:40-03:00"
updated: "2026-07-14T18:22:02-03:00"
started_at: "2026-07-14T17:57:35-03:00"
assignee: codex
tags: [docks-kit, review-policy, codex, claude, consent]
affected_paths:
  - SoT/.codex/AGENTS.md
  - SoT/.claude/CLAUDE.md
  - AGENTS.md
  - cli/src/generated/sotPayload.ts
  - cli/test/unit/payload.test.ts
  - cli/test/standing-consent-integration.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
related_plans:
  - /home/vagrant/projects/docks/docs/plans/finished/2026-07-12-cross-company-review-policy.md
  - docks-integration-readiness
review_status: passed
ship_commit: ef2e12d2bf74929f622de8c5e6f03140f1a0ddab
---

# Deploy standing cross-company review consent

## Goal

Deploy this owner's standing choice through both existing runtime-global prompt SoTs so the Docks plan-review policy does not ask for cross-company export consent on each review:

> For Docks plan reviews, cross-company review is standing-authorized; do not ask for export consent. This never overrides a host or platform security denial.

The rule is deliberately narrow. It authorizes only Docks plan-review's X leg; it does not authorize arbitrary external messages, pushes, releases, secrets, destructive actions, or a workaround after platform denial. Docks remains the portable policy owner; this repo deploys one user preference through existing prompt precedence and adds no env/config schema.

## Context

- **Owner decision (2026-07-12):** “i always approve cross-review company, dont need to ask that.”
- The Docks policy contract resolves `cross_company_consent` from current-user > runtime-global > skill default. `always` suppresses only the product consent picker; authoritative host/platform denial is recorded `platform_denied` and never retried through another transport.
- The initial docks-kit companion draft incorrectly coupled this immediately actionable preference to a future-blocked session-relay runtime program. Independent review rejected that dependency; this plan is a separate small commit/revert boundary.
- Global SoT prompt files are token-sensitive action rules. The exact two-sentence rule above appears once per runtime, with no timestamp, source citation, history, install instructions, or duplicated policy machinery.

## Steps

| # | Task | Depends | Status | Done condition / revert trigger |
|---|---|---|---|---|
| 1 | Confirm released Docks v0.12.5 resolves runtime-global `cross_company_consent=always` and preserves `platform_denied`. | — | done | Current shipped plan-manager/plan-review contracts contain both rules; no checkout-HEAD equality is required. |
| 2 | Add the exact rule once to each global SoT and one human-facing note to root `AGENTS.md`; regenerate the payload. | 1 | done | Source and generated payload contain exactly one prompt copy per runtime. **Revert:** authorization broadens beyond Docks plan review or overrides host policy. |
| 3 | Verify payload bytes and isolated sync behavior through the release-stage focused/unit/golden gates. | 2 | done | The bounded release-stage acceptance passes once; no authentication-sensitive runtime probe is required. |

## Acceptance criteria

| ID | Command | Expected result |
|---|---|---|
| A1 | `bun cli/scripts/generate-sot-payload.ts && bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; generated payload is current and the second pass is a no-op. |
| A2 | `bun run test:unit -- payload` | Exit 0; embedded Codex and Claude prompt payloads each contain the exact rule once; no broader authorization variant exists. |
| A3 | `bun run golden:dryrun && bun run golden:mutation` | Exit 0; isolated sync deploys both updated global prompt files and only expected content hashes/goldens change. |
| A4 | `bun run typecheck && bun run test:unit && bun run golden:dryrun && bun run golden:mutation && git diff --check` | Exit 0 once at the release boundary; no secrets or unrelated prompt content are introduced. |

## Out of scope

- No change to Docks' portable defaults, model tiers, review bundle/receipt schemas, waiver policy, or host denial classifier.
- No generic user preference file, env var, settings UI, or arbitrary cross-company/export authorization.
- No session-relay runtime, plugin refresh, hook, status, or restart work; `docks-integration-readiness` owns that separately.
- No push, version bump, tag, release, or automatic external action.

## Self-review

Score: **95/100 author candidate; fresh-context review pending**.

- Actionability **16/16** — three small steps with exact rule and revert triggers.
- Dependency order **11/12** — requires the final Docks policy commit, explicitly pinned before edit.
- Evidence re-verify **10/10** — both prompt SoTs, payload generator/tests, goldens, and Docks policy plan were inspected this session.
- Goal coverage **12/12** — Codex, Claude, generated payload, deployment, resolver provenance, and platform denial each have gates.
- Checkable acceptance **11/12** — Claude prompt visibility requires authenticated runtime access.
- Failure mode **10/10** — narrow scope, outer denial, no alternate transport, prompt budget, generated payload, and real-home isolation are explicit.
- Assumption to question **5/6** — no owner decision remains; only final Docks contract SHA is a hard prerequisite.

Cold-handoff result: a fresh worker can execute after the orchestrator inserts the final reviewed Docks policy commit in Sources and verifies A5 targets that exact checkout. No wording choice remains.

## Sources

- `SoT/.codex/AGENTS.md:27-45` — global Codex harness heuristics are the narrow insertion point; no standing cross-company consent rule exists.
- `SoT/.claude/CLAUDE.md:104-111` — current review/model guidance is the narrow Claude insertion point and currently describes the second perspective without standing consent.
- `AGENTS.md:34-41,47-56` — global SoT ownership, idempotency, and prompt-token discipline are repository contracts.
- `cli/scripts/generate-sot-payload.ts` and `cli/src/generated/sotPayload.ts` — SoT edits require generator-driven embedded payload refresh.
- `cli/test/unit/payload.test.ts:31-106` — payload bytes/freshness and planted stale mutations are already enforced.
- [Claude Code `InstructionsLoaded` hook](https://code.claude.com/docs/en/hooks#instructionsloaded) — fires when a `CLAUDE.md` enters context and reports exact `file_path`, `memory_type`, and `load_reason`; a disposable-home probe on Claude Code 2.1.207 produced the expected `User/session_start` record even though the isolated home was unauthenticated.
- `/home/vagrant/projects/docks/docs/plans/active/cross-company-review-policy.md` — Docks owns runtime-global precedence, standing `always`, and non-bypassable `platform_denied`; replace this source with the final reviewed commit before Step 1.

## Review

- Goal met: yes; the runtime-global rule is present exactly once in each SoT
  and in the generated payload.
- Regressions: none found by the fresh bounded completion review.
- CI: payload check, typecheck, 124 unit tests, 25 dry-run cases, and 70
  mutation cases passed.
- Follow-ups: none; the parent docks-integration release deployed the prompt
  to the live Codex home and published CLI 0.6.0.
- Filed by: Codex fresh-context reviewer, 2026-07-14.
