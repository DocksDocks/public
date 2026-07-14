---
title: Finish the docks-kit Docks integration release
goal: Ship low Codex verbosity, standing review consent, and supported Session Relay readiness without claiming unshipped runtime guarantees.
status: ongoing
created: "2026-07-12T00:37:40-03:00"
updated: "2026-07-14T18:17:33-03:00"
started_at: "2026-07-14T17:57:35-03:00"
assignee: codex
tags: [docks-kit, codex, session-relay, release]
affected_paths:
  - AGENTS.md
  - SoT/.codex/config.toml
  - SoT/.codex/AGENTS.md
  - SoT/.claude/CLAUDE.md
  - cli/src/generated/sotPayload.ts
  - cli/src/engine-native/sessionRelayReadiness.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/commands/status.ts
  - .claude/skills/plugin-bootstrap-context/SKILL.md
  - cli/test/lib/harness.ts
  - cli/test/unit/payload.test.ts
  - cli/test/unit/sessionRelayReadiness.test.ts
  - cli/test/unit/statusReadiness.test.ts
  - package.json
  - docs/plans/active/docks-integration-readiness.md
related_plans:
  - standing-cross-company-review-consent
  - /home/vagrant/projects/docks/docs/plans/finished/2026-07-14-relay-worker-lifecycle-primitives-continuation.md
review_status: passed
---

# Finish the docks-kit Docks integration release

## Goal

Release one bounded docks-kit update that:

- makes `model_verbosity = "low"` and
  `model_reasoning_summary = "concise"` the global Codex defaults;
- deploys the owner's narrow standing authorization for Docks cross-company
  plan review while preserving host/platform denial;
- refreshes the three enabled Docks plugins as today, then reports Session
  Relay ready only when `codex plugin list --json` shows exactly one installed,
  enabled `session-relay@docks` row with a version;
- exposes that state through `docks-kit status` as readiness for a newly
  started Codex session; and
- records Effect Kit v0.3.0 as unchanged/current instead of releasing it again.

This plan replaces the previous speculative producer protocol. Session Relay
v0.11.0 does not ship `__install-stable`, a JSON capability doctor, an N/N+1
runtime contract, or historical recovery guarantees, so docks-kit must not
pretend those surfaces exist.

## Context

- Docks v0.12.5 already resolves runtime-global
  `cross_company_consent=always` and keeps host policy authoritative.
- Session Relay v0.11.0 ships managed lifecycle control and a per-session text
  `relay doctor --id`; that doctor is not a machine-global readiness probe.
- Codex 0.144.x currently exposes installed plugin identity, version, installed
  state, and enabled state through `codex plugin list --json`.
- The Codex manual documents `model_verbosity = "low"` for shorter Responses
  API output.
- Effect Kit's current tree is byte-identical to released v0.3.0, whose tag CI
  passed; no Effect Kit implementation or release is required.

## Steps

| # | Task | Depends | Status | Done condition / revert trigger |
|---|---|---|---|---|
| 1 | Deploy low Codex verbosity, the exact two-sentence standing-consent rule to both global prompt SoTs, and the narrow-to-broad verification ladder; regenerate the embedded payload. | — | done | Source and generated payload agree; consent appears exactly once per runtime; low verbosity is documented and tested. Revert if authorization broadens beyond Docks plan review or bypasses host policy. |
| 2 | Add a closed Session Relay readiness classifier over `codex plugin list --json`; verify it after refresh and expose it from human/JSON `status`. | 1 | done | Ready requires exactly one installed+enabled row with a non-empty version and says it applies to new sessions. Missing CLI, command failure, invalid JSON, duplicate, missing, disabled, or uninstalled rows are typed unavailable states. Revert if the CLI scans cache paths, invokes `relay doctor`, or claims lifecycle/old-session health. |
| 3 | Run targeted generation/unit/type checks, the full unit and golden suites once, then one final clean release gate. | 1-2 | done | Every named acceptance command exits 0; later relevant edits invalidate only the affected rung and final gate. |
| 4 | Release cli-v0.6.0, deploy `sync codex`, and verify the live config/plugin inventory. | 3 | in-flight | Remote main/tag/release are published, tag CI passes, live config says low, and live inventory reports Docks 0.12.5, Session Relay 0.11.0, Effect Kit 0.3.0 installed+enabled. |

## Acceptance criteria

| ID | Command | Expected result |
|---|---|---|
| A1 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; generated payload and version are current. |
| A2 | `bunx vitest run cli/test/unit/payload.test.ts cli/test/unit/sessionRelayReadiness.test.ts` | Exit 0; low verbosity, exact prompt authorization, and every readiness classification pass. |
| A3 | `bun run typecheck && bun run test:unit` | Exit 0 once after implementation. |
| A4 | `bun run golden:dryrun && bun run golden:mutation` | Exit 0 once; no unexpected sync/status drift. |
| A5 | `git diff --check && bun cli/scripts/generate-sot-payload.ts --check && bun run typecheck && bun run test:unit && bun run golden:dryrun && bun run golden:mutation` | One final clean release gate exits 0. |
| A6 | `./docks-kit sync codex` followed by `rg '^model_verbosity = "low"$' ~/.codex/config.toml` and `codex plugin list --json` | Real sync exits 0; low is deployed; Docks 0.12.5, Session Relay 0.11.0, and Effect Kit 0.3.0 are installed+enabled. |

## Out of scope

- No stable-runtime installer, cache authenticity, N/N+1 upgrade proof, JSON
  relay capability doctor, historical recovery, or old-session continuity
  guarantee.
- No automatic `relay doctor`: it requires a concrete session identity and
  reports receive-path state, not global plugin installation readiness.
- No Effect Kit source/version change.
- No change-sensitive suppression of Codex restart advice; a refreshed plugin
  may invalidate commands retained by an already-running Codex process.

## Self-review

The original 580-line plan was rejected as unimplementable against the product
that actually shipped. A fresh bounded audit confirmed this replacement uses
only current supported surfaces, names exact files and failure states, and keeps
the public status field narrower than lifecycle health. No open product choice
remains.

## Review

- Goal met: implementation complete; release/deployment pending.
- Regressions: none found by the fresh bounded completion review.
- CI: payload check, typecheck, 124 unit tests, 25 dry-run cases, and 70
  mutation cases passed. Live `codex plugin list --json` matched the classifier
  schema and reported all three Docks plugins installed and enabled.
- Follow-ups: publish `cli-v0.6.0`, sync the live Codex home, and archive this
  plan with the release commit.
- Filed by: Codex fresh-context reviewer, 2026-07-14.
