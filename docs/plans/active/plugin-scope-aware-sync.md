---
title: Make claude plugin sync scope-aware for the per-scope install registry
goal: Pass-2 install and pass-5 uninstall treat only user-scope records in installed_plugins.json as kit-installed, so a project/local-scope install can no longer break the tri-state contract.
status: in_review
created: "2026-07-02T12:42:58-03:00"
updated: "2026-07-02T13:20:36-03:00"
in_review_since: "2026-07-02T13:20:36-03:00"
started_at: "2026-07-02T13:15:32-03:00"
assignee: null
tags: [sync, plugins, claude]
affected_paths:
  - lib/claude.sh
  - .claude/skills/plugin-bootstrap-context/
  - CLAUDE.md
related_plans: []
review_status: null
planned_at_commit: 3f88657ab19406d2617534a43f19d1de0bb899e8
---

## Goal

`claude::sync_plugins` upholds the tri-state contract ("every SoT-declared plugin is installed at **user scope**") even when a per-scope install record exists for some other scope. Today a project-scope-only record silently satisfies the install check, and the uninstall pass can't remove one.

## Context

Claude Code ≥2.1.198 registers plugin installs per scope in `~/.claude/plugins/installed_plugins.json`: `.plugins` maps each plugin id to an **array of records** carrying `scope: "user" | "project" | "local"` (project/local records also carry `projectPath`). The CLI exposes `-s, --scope <user|project|local>` on both `plugin install` and `plugin uninstall` (default `user`) — verified via `--help` on 2026-07-02.

Observed failure (2026-07-02, healed manually): a SoT-`false` plugin had only a `scope: "project"` record pointing at one repo. Pass 2 saw the key present and never installed at user scope, so every session carried an orphaned `enabledPlugins` reference and `/doctor` reported a persistent `Plugin "<name>" is enabled in project settings but isn't installed` error. Manual fix: `claude plugin uninstall <id> --scope project` from that repo, then `./sync.sh --claude` reinstalled at user scope and pass 7 re-disabled it.

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Scope-aware install predicate in `claude::_plugins_install`: replace the skip test `jq -e '.plugins[$n] // empty'` with a user-scope test — `.plugins[$n] // empty | (if type == "array" then . else [.] end) | any(.scope? == "user")` (the type guard tolerates any legacy single-object format) | — | done |
| 2 | Scope-aware uninstall in `claude::_plugins_uninstall`: pass `--scope user` explicitly, and only attempt uninstall when a user-scope record exists (reuse the step-1 predicate); project/local records are project-owned and out of the kit's jurisdiction | 1 | done |
| 3 | Fixture verification: write 4 synthetic `installed_plugins.json` fixtures to a temp dir (user-only, project-only, both, legacy-object) and run the step-1 jq predicate against each; then `bash -n lib/claude.sh` and `./sync.sh --claude --dry-run` | 1, 2 | done |
| 4 | Docs/skill sync: update `.claude/skills/plugin-bootstrap-context/references/seven-pass-flow.md` (quotes the old pass-2 jq verbatim in its Pass 2 snippet), the SKILL.md pass table if wording changes, bump `metadata.updated`; adjust the CLAUDE.md "Install plugins on a new machine" sentence ("anything missing from installed_plugins.json" → "anything without a user-scope install record") | 1, 2 | done |
| 5 | Steady-state idempotence check: run `./sync.sh --claude` twice; second run must report `plugins: +0 ~0 -0` | 3 | done |

## Acceptance criteria

- Predicate unit check: for the 4 fixtures, `jq -e --arg n <id> '<predicate>'` exits 0 only for user-only and both; exits 1 for project-only and legacy-object-without-user-scope. Command + expected exit codes recorded in the test transcript.
- `bash -n lib/claude.sh` exits 0.
- `./sync.sh --claude` run twice in a row: second run prints `plugins: +0 ~0 -0` (no re-install loop — a failing user-scope install must not retry-thrash when the CLI errors).
- `grep -n "plugins\[\$n\] // empty' " lib/claude.sh` shows the bare presence test only where intentionally retained (pass 3/update iteration may keep key-iteration; the install/uninstall paths must use the scope-aware predicate).
- `references/seven-pass-flow.md` Pass 2 snippet matches the new code verbatim; `metadata.updated` bumped in SKILL.md.

## Out of scope

- Codex plugin sync (`codex::sync_plugins`) — Codex has no per-scope registry.
- Pass 7 (`claude::_plugins_reassert_enabled_state`) — operates on settings, unaffected by registry scope.
- Marketplace passes (1, 3, 6).
- Per-scope *enable* semantics (project `.claude/settings.json` flips) — already documented, unchanged.

## Notes

- Design decision: pass 5 (uninstall) deliberately ignores project/local-scope records for SoT-absent keys — the kit reconciles only what it owns (user scope), consistent with "user-only additions are preserved". Removing a project-scope install is that project's decision.
- Failure mode / revert trigger: if the second `./sync.sh --claude` run shows repeated `+1` installs or new warns, revert the lib/claude.sh hunk (single-commit change) — the old behavior is safe-but-drifty, not broken.

## Sources

- `lib/claude.sh:425` — pass-2 skip test is bare key presence: `jq -e --arg n "$plugin_id" '.plugins[$n] // empty'` (read this session).
- `lib/claude.sh:470` — pass-5 calls `claude plugin uninstall -y "$plugin_id"` with no `--scope` flag (read this session).
- `~/.claude/plugins/installed_plugins.json` (observed 2026-07-02) — per-id record arrays with `scope` + `projectPath` fields.
- `claude plugin install --help` / `claude plugin uninstall --help` (v2.1.198) — `-s, --scope <scope>` on both, default `user`.
- `.claude/skills/plugin-bootstrap-context/references/seven-pass-flow.md:38` — quotes the old pass-2 jq; must be updated in step 4.

## Self-review

Score: 89/100 · trajectory 89 · stopped: single pass (≤6 steps, no risk flag). Rubric: steps carry executable done-conditions; dependency order verified (predicate → callers → fixtures → docs → idempotence); all cited lines read this session at `planned_at_commit`; goal covered by steps 1–2 with 3/5 as proof; acceptance is command+expected-output; revert trigger named in Notes. Cold-handoff: registry format, CLI flags, and the observed failure are restated in Context so a fresh agent needs no conversation history. Remaining assumptions: none requiring user input — the pass-5 jurisdiction call is a noted design decision consistent with existing kit policy.

## Review

(filled by plan-review on completion)
