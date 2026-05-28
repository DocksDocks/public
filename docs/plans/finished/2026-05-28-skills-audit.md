---
title: Audit project skills + emit Codex agent TOMLs
status: finished
created: 2026-05-28
updated: 2026-05-28T17:19:28-03:00
assignee: null
blockers: []
blocked_reason: null
blocked_since: null
ship_commit: a8138e44ee803fc7bb742cc64cc2af9b414aed13
review_status: passed
---

# Audit project skills + emit Codex agent TOMLs

`skill-agent-pipeline` run. Scope: whole project (`/home/docks/projects/public`).
Phases 1–6 are read-only; implementation (Phase 8) runs only after `start`.

## Phase 0: State

- Date anchor: 2026-05-28
- `.claude/skills/*/SKILL.md`: **6**
- `.agents/skills/*/SKILL.md` (project-local): **0**
- `.claude/agents/*.md`: **6**
- `.codex/agents/*.toml`: **0**  ← agent-track delta
- Local `skill-maintenance` skill: **present**
- Plugin `docks:skill-maintenance`: **available** (cache 0.5.4, updated 2026-05-26)

## Phase 1: Exploration Results

### Project Profile

Shell/config kit — no language manifest (`package.json`/`Cargo.toml`/etc.).
Source of truth: `sync.sh` (orchestrator) + `lib/{common,claude,codex,skills}.sh`
(per-tool sync), deploying `SoT/.{claude,codex,agents}/` to user config.
Docs: `AGENTS.md` (cross-tool SoT), `CLAUDE.md` (Claude extension), `docs/plans/`.

### Existing Skills

| name | lines | source_files | refs/ | updated | desc_chars |
|---|---|---|---|---|---|
| codex-config-merge-context | 160 | lib/codex.sh, SoT/.codex/config.toml, SoT/.codex/rules/docks.rules | 2 | 2026-05-17 | 698 |
| plugin-bootstrap-context | 144 | lib/claude.sh, lib/codex.sh, SoT/.claude/settings.json, SoT/.codex/plugins/marketplace.json | 2 | 2026-05-17 | 607 |
| settings-merge-context | 127 | lib/claude.sh, SoT/.claude/settings.json, SoT/.claude/hooks/disable-claudeai-connectors.sh | 2 | 2026-05-17 | 547 |
| skill-maintenance | 131 | (empty `[]`) | 2 | 2026-05-17 | 465 |
| sync-orchestration-context | 136 | sync.sh, lib/common.sh | 2 | 2026-05-17 | 434 |
| universal-skills-context | 147 | lib/skills.sh, SoT/.agents/skills.txt | 2 | 2026-05-17 | 693 |

All bodies well under the 500-line cap; all descriptions start `Use when…`, <1024 chars, identifier-rich. Structurally healthy.

### Existing Agents

6 Claude `.md` agents, **0 Codex `.toml`** — every agent is present in only ONE format (cross-format drift: all 6 need a `.toml`). Clean 1:1 agent→skill wrapping:

| agent (.md) | model | tools | wraps skill |
|---|---|---|---|
| codex-config-agent | sonnet | Read, Grep, Glob, Bash | codex-config-merge-context |
| plugin-bootstrap-agent | sonnet | Read, Grep, Glob, Bash | plugin-bootstrap-context |
| settings-json-agent | sonnet | Read, Grep, Glob, Bash | settings-merge-context |
| skill-author-agent | sonnet | Read, Grep, Glob, Bash, **Edit, Write** | **skill-maintenance** |
| skills-bootstrap-agent | sonnet | Read, Grep, Glob, Bash | universal-skills-context |
| sync-mechanic-agent | sonnet | Read, Grep, Glob, Bash | sync-orchestration-context |

None declare `Agent` in `tools` → no inter-agent dispatch → all port to Codex at default `agents.max_depth` (no raise needed).

### Knowledge Areas Identified

All source subsystems already covered by a skill's `source_files`:
`sync.sh`+`common.sh`→sync-orchestration-context · `claude.sh`→settings-merge + plugin-bootstrap · `codex.sh`→codex-config-merge + plugin-bootstrap · `skills.sh`→universal-skills-context. **No uncovered knowledge area → no new skill warranted.** This run is an audit (refresh + agent-format reconcile + redundant-skill removal), not a bootstrap.

### Located facts (for Phase 2a/2b/6, not judged here)

- `lib/codex.sh` last commit **2026-05-26** > skills' `updated: 2026-05-17` → codex-config-merge-context + plugin-bootstrap-context list it as `source_files`.
- `guard-skills.sh` / `score-skills.sh` / `guard-agents.sh` / `score-agents.sh` referenced in `CLAUDE.md` and `.claude/skills/skill-maintenance/SKILL.md:59` but absent from the repo.
- `skill-author-agent` body references `.claude/skills/skill-maintenance` (coupling to the removal candidate).

## Phase 2b: Pattern Scanner Findings

Net-new findings (drift not yet documented), `file:line` evidence. Two `lib/codex.sh` commits landed after the skills' `updated: 2026-05-17`: `6025ac1` (2026-05-26, plugin-flow rewrite) and `e345efd` (2026-05-26, removed `codex::sync_rtk`, −~40 lines). `lib/codex.sh` is now 506 lines.

### Architecture (call-graph drift)
- `codex::sync` no longer calls `codex::sync_rtk` — function deleted (`e345efd`). `lib/codex.sh` has no `sync_rtk`. (verified: `grep sync_rtk lib/codex.sh` → none)
- `codex::bootstrap_marketplace` deleted (`6025ac1`); replaced by `codex::remove_legacy_docks_marketplace` (`lib/codex.sh:383`) + `codex::sync_plugins` (`lib/codex.sh:454`). (`grep` → defs confirmed)
- `claude::sync_rtk` still exists but moved: `lib/claude.sh:351` (skills/refs cite `234-288`).

### Conventions (current function offsets in lib/codex.sh)
| Function | Cited (stale) | Current |
|---|---|---|
| `codex::ensure_bubblewrap` | 49-102 | **38** |
| `codex::sync_rules` | 104-121 | **107** |
| `codex::sync_config` | 162-184 | **146** |
| `codex::scrub_deprecated_features` | 190-229 | **184** |
| `codex::merge_top_level_settings` | 231-272 | **221** |
| `codex::merge_table_settings` | 274-301 | **264** |
| `codex::install_launcher` | 304-318 | **294** |
| `codex::sync_marketplace` | 355-396 / 320-356 | **315** |
| `codex::remove_legacy_docks_marketplace` | 423-442 | **383** |
| `codex::sync_plugins` | 494-529 | **454** |

Offset is non-uniform (functions both added at 6025ac1 and removed at e345efd) — refresh must re-derive each ref, not apply a blanket delta.

### Gotchas (silent-break, concrete)
- `.claude/skills/skill-maintenance/SKILL.md:59` + `.claude/agents/skill-author-agent.md:13,37,99` + `CLAUDE.md` cite `guard-skills.sh`/`score-skills.sh`/`guard-agents.sh`/`score-agents.sh` — **none exist in the repo** (`find . -name … -not -path ./.git/*` → empty). Any agent/skill that runs them silently no-ops.
- `.claude/agents/skill-author-agent.md:37` hardcodes `/home/vagrant/projects/public/guard-skills.sh` — wrong home (repo is `/home/docks/...`) **and** a non-existent script.
- `plugin-bootstrap-context` body was edited `2026-05-26` (`6025ac1`) but `metadata.updated` still reads `2026-05-17` — the date never got bumped, so staleness triage under-reports it.

Per-domain counts: Architecture 3 · Conventions 10 · Gotchas 3.

## Phase 2a: Categorizer Proposals

### Skill Audit (6 checks each)
| Skill | Size | Stale? | Coverage | CSO | desc len | Deleted src | Action |
|---|---|---|---|---|---|---|---|
| codex-config-merge-context | 160 ✓ | **YES** — codex.sh refs shifted | ok | ✓ | 698 ✓ | none | **REFRESH** |
| plugin-bootstrap-context | 144 ✓ | **YES** — codex.sh refs −40; date not bumped | ok | ✓ | 607 ✓ | none | **REFRESH** |
| settings-merge-context | 127 ✓ | no (claude.sh @2026-05-17) | ok | ✓ | 547 ✓ | none | keep |
| sync-orchestration-context | 136 ✓ | **YES** — `references/dispatch-flow.md` Codex branch stale + 2 removed fns | ok | ✓ | 434 ✓ | none | **REFRESH (ref file)** |
| universal-skills-context | 147 ✓ | no (skills.sh @2026-05-17) | ok | ✓ | 693 ✓ | none | keep |
| skill-maintenance | 131 ✓ | n/a (src `[]`) | redundant | ✓ | 465 ✓ | n/a | **PROPOSE REMOVAL** |

### New Skill Proposals
None. Every source subsystem (`sync.sh`+`common.sh`, `claude.sh`, `codex.sh`, `skills.sh`) is covered. No uncovered knowledge area.

### Maintenance Skill
Local `skill-maintenance` has `source_files: []` and is generic skill-authoring guidance fully covered by plugin `docks:skill-maintenance` (updated 2026-05-26, `pattern: reviewer`) + `docks:write-skill` + this `docks:skill-agent-pipeline`. Its only project-specific bits are (a) the universal-skills `-a claude-code` gotcha — already owned by `universal-skills-context`, and (b) references to `guard-skills.sh`/`score-skills.sh` that **don't exist**. → **PROPOSE REMOVAL** (`git rm -r .claude/skills/skill-maintenance/`). Ripple: `skill-author-agent` depends on it (see Phase 4a). Gate decision **D2**.

### Skipped Knowledge Areas
None.

## Phase 3: Skills Plan

Refreshes are **surgical** (re-derive `file:line` + bump `updated`), not rewrites — matches the kit's "surgical changes only" rule. No `metadata.pattern` field is added (the kit's existing skills don't use one; preserve frontmatter shape).

### REFRESH `.claude/skills/codex-config-merge-context/SKILL.md`
- Re-derive every `lib/codex.sh:NNN` ref in body + constraints from the Phase 2b offset table (e.g. constraint cites `231-302`→merge passes now `221-293`; `87`→bubblewrap install now ~`75`; `65-66`→bubblewrap skip now ~`54`; call-sequence `162-184`→`146-…`; scrub `190-229`→`184-…`; bubblewrap `49-102`→`38-…`; rules `104-121`→`107-…`).
- `metadata.source_files[lib/codex.sh].lines: "49-302"` → recompute (ensure_bubblewrap@38 … merge_table end ≈ 293) → `"38-293"`.
- `metadata.updated: "2026-05-17"` → `"2026-05-28"`.
- Verify no `sync_rtk`/`bootstrap_marketplace` mention (none expected — confirmed not in body).

### REFRESH `.claude/skills/plugin-bootstrap-context/SKILL.md`
- Body `lib/codex.sh` refs −40: `sync_marketplace 355-396`→`315-…`; `remove_legacy 423-442`→`383-…`; `sync_plugins 494-529`→`454-…`. `lib/claude.sh` refs unchanged (claude.sh untouched).
- `metadata.source_files[lib/codex.sh].lines: "355-529"` → `"315-506"`.
- `metadata.updated: "2026-05-17"` → `"2026-05-28"`.

### REFRESH `.claude/skills/sync-orchestration-context/references/dispatch-flow.md` (62 lines)
- Line 22 `claude::sync_rtk … lib/claude.sh:234-288` → `lib/claude.sh:351-…`.
- Line 25 `ensure_bubblewrap 49-102`→`38-…`; L26 `sync_config 162-184`→`146-…`; L27 `sync_rules 104-121`→`107-…`.
- **Line 29 DELETE** `codex::sync_rtk (… lib/codex.sh:133-160)` — function removed.
- Line 30 `install_launcher 304-318`→`294-…`; L31 `sync_marketplace 320-356`→`315-…`.
- **Line 32 REPLACE** `codex::bootstrap_marketplace (… 358-379)` → two lines: `codex::remove_legacy_docks_marketplace (… lib/codex.sh:383-…)` + `codex::sync_plugins (codex plugin add refresh; lib/codex.sh:454-…)`.
- Bump parent `sync-orchestration-context/SKILL.md` `metadata.updated` → `"2026-05-28"` (ref file is its content).

### REMOVE `.claude/skills/skill-maintenance/` (gate D2)
Sentinel: `git rm -r .claude/skills/skill-maintenance/` — only on D2=remove.

## Phase 4a: Role Mapper Proposals

### Agent Roster
Existing 6 agents are a clean 1:1 wrap of the 6 skills, SRP-correct, minimal tools, `model: sonnet`. No new roles. Actions: **update** 2 (stale fn refs), **decision** on 1 (skill-author).

### Existing Agent Audit
| Agent | Issue | Action |
|---|---|---|
| codex-config-agent | body L91 hand-off cites removed `codex::bootstrap_marketplace` | **UPDATE** → `codex::remove_legacy_docks_marketplace` / `codex::sync_plugins` |
| plugin-bootstrap-agent | description cites removed `codex::bootstrap_marketplace` | **UPDATE** → replace with the two successor fns |
| skill-author-agent | wraps removal-candidate `skill-maintenance` (steps 1-3, Context, Integration); cites non-existent `guard-skills.sh`/`score-skills.sh` (L13,37,99); `/home/vagrant` path (L37) | **D2-dependent** (remove with the pair, or keep+repoint+fix) |
| settings-json-agent, skills-bootstrap-agent, sync-mechanic-agent | none | keep (still need `.toml` twin) |

### Skipped Skills / Cross-Cutting
None. No agent spans >1 skill.

## Phase 4b: Pattern Extractor Content

Agent bodies already exist and follow the kit's agent shape (Role → constraints → Workflow → Patterns → Integration → Anti-Hallucination → Success → Gotchas). No re-authoring — the `.toml` `developer_instructions` reuses each (corrected) `.md` body verbatim. Only the 2 updated agents (+ optional skill-author) change content; the other 4 are byte-stable.

## Phase 5: Agents Plan

### Claude `.md` edits (apply BEFORE generating `.toml` twins)
- `plugin-bootstrap-agent.md:3` — in description replace `` `codex::bootstrap_marketplace` `` with `` `codex::remove_legacy_docks_marketplace` / `codex::sync_plugins` ``.
- `codex-config-agent.md:91` — replace `codex::bootstrap_marketplace` with `codex::remove_legacy_docks_marketplace` / `codex::sync_plugins`.
- `skill-author-agent.md` — D2-dependent (see gate).

### Codex `.codex/agents/*.toml` (NEW — main delta, gate D1)
Translation per `codex-agents-builder.md`. All source agents are `model: sonnet` → **`gpt-5.3-codex`** (no Codex model pinned in `SoT/.codex/config.toml`). `developer_instructions` = the agent's **corrected** `.md` body verbatim, triple-quoted. None declare `Agent` → no `max_depth` concern.

| `.codex/agents/<name>.toml` | model | sandbox_mode | from |
|---|---|---|---|
| codex-config-agent.toml | gpt-5.3-codex | read-only | codex-config-agent.md (corrected) |
| plugin-bootstrap-agent.toml | gpt-5.3-codex | read-only | plugin-bootstrap-agent.md (corrected) |
| settings-json-agent.toml | gpt-5.3-codex | read-only | settings-json-agent.md |
| skills-bootstrap-agent.toml | gpt-5.3-codex | read-only | skills-bootstrap-agent.md |
| sync-mechanic-agent.toml | gpt-5.3-codex | read-only | sync-mechanic-agent.md |
| skill-author-agent.toml | gpt-5.3-codex | **workspace-write** (has Edit/Write) | D2-dependent |

Worked example — `.codex/agents/sync-mechanic-agent.toml`:
```toml
name = "sync-mechanic-agent"
description = "Use when editing sync.sh, lib/common.sh, the flag parser (--force / --remove-plugins / --no-rtk / --dry-run / --claude / --codex / --agents), the TARGET_FILTER_SET default-all-three logic, or any cross-cutting sync invariant. Not for tool-specific JSON merge (use settings-json-agent), plugin reconcile (use plugin-bootstrap-agent), or skill SKILL.md authoring (use skill-author-agent)."
model = "gpt-5.3-codex"
sandbox_mode = "read-only"
developer_instructions = """
<verbatim body of .claude/agents/sync-mechanic-agent.md, lines 7-EOF>
"""
```
(Backticks stripped from `description` — TOML strings don't render markdown; the Claude CSO carries over otherwise 1:1. Each other `.toml` follows this exact shape.)

## Phase 6: Verification

### Skills Report
- All refreshed skills: body ≤500 ✓ (160/144/62-line ref), CSO `Use when…` ✓, desc <1024 ✓, no angle brackets ✓, descriptions quoted-safe ✓.
- Reference accuracy: spot-checked 10 `lib/codex.sh` refs by `grep` (offset table) — all confirmed shifted; refresh targets verified against current defs.
- Maintenance skill: removal proposed; plugin `docks:skill-maintenance` present. No kept local copy → no kit-internal-validator hard-fail.

### Agents Report
- Claude `.md`: names kebab ≤64 ✓, no "claude"/"anthropic" ✓, descriptions <1024 3rd-person ✓, bodies <200 lines ✓, tools minimal ✓, no scope overlap ✓. 2 carry stale-fn refs (fixed in Phase 5); skill-author also has dead-validator + `/home/vagrant` refs.
- Codex `.toml`: schema = 3 required keys present ✓; `model = gpt-5.3-codex` ∈ valid IDs ✓; `sandbox_mode` ∈ {read-only, workspace-write} ✓; `name` == Claude twin ✓. No `Agent`-dispatch → no depth hard-fail.

### Cross-Layer Integrity
Every `.claude/skills/…` path an agent references exists in the Phase 3 plan **except** `skill-author-agent`→`skill-maintenance` (removal candidate). If D2=remove without handling skill-author → **hard fail** (dangling ref). Resolved by removing or repointing skill-author (gate D2).

### Replaced-Skill Sentinel
`git rm -r .claude/skills/skill-maintenance/` carried to gate (D2). If D2 also removes skill-author: `git rm .claude/agents/skill-author-agent.md`.

### Issues to Fix
- **hard fail (must resolve at gate):** D2 — skill-author/skill-maintenance dangling ref must be resolved before any apply.
- **should fix:** stale `lib/codex.sh` refs in 2 skills + dispatch-flow.md; stale fn refs in 2 agents; `plugin-bootstrap-context` `updated` date.
- **minor / out-of-scope (flag, not fixed here):** missing `guard-*.sh`/`score-*.sh` validators referenced in `CLAUDE.md` (docs+scripts → `human-docs-workflow` or new plan); `/home/vagrant` path (fixed only if skill-author kept).

### Dropped (failed reproduction)
None.

## Decisions (gate 2026-05-28)

- **D1 = Generate all Codex TOMLs.**
- **D2 = Remove both (cascade) — CONFIRMED** with full blast radius. Repoint sibling hand-offs/exclusions to `docks:skill-maintenance` / `docks:write-skill` (available in both Claude and Codex via the enabled `docks` plugin).

### D2 blast radius (skill-author-agent is referenced by all 5 siblings)
| File | Ref | Edit needed |
|---|---|---|
| skills-bootstrap-agent.md | L3 desc exclusion + L81 hand-off | drop clause + drop/repoint hand-off |
| sync-mechanic-agent.md | L3 desc exclusion | drop clause |
| settings-json-agent.md | L75 hand-off | drop/repoint |
| plugin-bootstrap-agent.md | L74 hand-off | drop/repoint |
| codex-config-agent.md | L92 hand-off | drop/repoint |
| AGENTS.md:62 | "skill-maintenance meta" in kit-skill list | **out-of-scope doc follow-up** (don't edit here) |

Each of the 5 sibling `.md` edits also flows into its `.toml` twin. So D2=remove-both ≈ rm 2 files + edit 5 agents + 5 `.toml` reflect it + 1 AGENTS.md follow-up (~13 touches), vs D2=keep-and-fix ≈ fix skill-author's 3 broken refs only (+ 6th `.toml`).

## Phase 8 Manifest (locked — runs only on `start`)

**Modify — skills (4):**
1. `.claude/skills/codex-config-merge-context/SKILL.md` — re-derive all `lib/codex.sh` refs (Phase 2b table); `source_files` `49-302`→`38-293`; `updated`→`2026-05-28`.
2. `.claude/skills/plugin-bootstrap-context/SKILL.md` — `lib/codex.sh` refs −40; `source_files` `355-529`→`315-506`; `updated`→`2026-05-28`.
3. `.claude/skills/sync-orchestration-context/references/dispatch-flow.md` — fix `claude::sync_rtk`→`351`; codex offsets; DELETE `codex::sync_rtk` line; REPLACE `bootstrap_marketplace` line with `remove_legacy_docks_marketplace`@383 + `sync_plugins`@454.
4. `.claude/skills/sync-orchestration-context/SKILL.md` — `updated`→`2026-05-28`.

**Delete — skill (1):** `git rm -r .claude/skills/skill-maintenance/`

**Modify — Claude agents (5):**
5. `codex-config-agent.md` — L91 `bootstrap_marketplace`→successors; L92 hand-off→`docks:skill-maintenance`/`docks:write-skill`.
6. `plugin-bootstrap-agent.md` — L3 desc `bootstrap_marketplace`→successors; L74 hand-off→docks skills.
7. `settings-json-agent.md` — L75 hand-off→docks skills.
8. `skills-bootstrap-agent.md` — L3 drop `…use skill-author-agent` clause; L81 hand-off→docks skills.
9. `sync-mechanic-agent.md` — L3 drop `…use skill-author-agent` clause.

**Delete — Claude agent (1):** `git rm .claude/agents/skill-author-agent.md`

**Create — Codex agents (5):** `.codex/agents/{codex-config-agent,plugin-bootstrap-agent,settings-json-agent,skills-bootstrap-agent,sync-mechanic-agent}.toml` — `model = "gpt-5.3-codex"`, `sandbox_mode = "read-only"`, `developer_instructions` = the corrected `.md` body verbatim.

**Out-of-scope follow-ups (do NOT edit here):**
- `AGENTS.md:62` "skill-maintenance meta" phrase (→ `human-docs-workflow`).
- `CLAUDE.md` cites missing `guard-agents.sh`/`score-agents.sh`; repo also missing `guard-skills.sh`/`score-skills.sh` (→ new plan: create validators or scrub the refs).

## Phase 8 finding — refactor-wide staleness (RESCOPE)

Phase 2a undercounted staleness. Commit `5d6a6b5` "Refactor sync libs (12 SOLID fixes)" landed **2026-05-17 21:38**, exactly **1 h after** the skills were created (`2026-05-17 20:38`). It reorganized every `lib/*.sh`, invalidating the `lib:line` refs in ALL 5 remaining skills — not just the 2 codex ones flagged earlier. `sync.sh` was untouched (its refs are fine).

| Skill | Source refactored | Severity |
|---|---|---|
| settings-merge-context | `sync_settings` SPLIT into `_settings_validate/_install/_reconcile/_merge` | **misdirects** — `claude.sh:91-97` now lands in the wrong helper |
| universal-skills-context | line drift + `heal_claude_symlink`(110) inserted | **misdirects** — `skills.sh:140-143` now inside a different fn |
| codex-config-merge-context | uniform −~14 line shift | off-by-N (right fn, wrong line) |
| plugin-bootstrap-context | codex.sh −40 (claude.sh refs OK) | off-by-N |
| sync-orchestration-context | `common.sh` −~1; `dispatch-flow.md` removed-fn names | mixed (dispatch-flow actively wrong) |

Each skill also has 1-2 `references/*.md` with their own embedded refs (`jq-pipelines.md`, `storage-model.md`, `awk-merger.md`, …) — ~30 refs across ~15 files to re-derive + verify.

**Root-cause observation (not fixed here):** the `*-context` skills hardcode dozens of `lib:line` refs that break on every refactor (stale 11 days). A durable design cites function names + one `source_files` range, not 30 inline line numbers. Candidate for its own plan.

Rescope **resolved: Full refresh** — executed below.

## Phase 8 — Implementation (executed 2026-05-28)

Every `lib:line` ref re-derived from current source and verified (content + in-range). Final source-of-truth offsets used (post-`5d6a6b5` refactor): claude.sh 420 ln, codex.sh 506 ln, skills.sh 278 ln, common.sh 71 ln, sync.sh 54 ln.

**Skills refreshed (5 SKILL.md + 8 references/, all `updated: 2026-05-28`):**
- `settings-merge-context/` — SKILL + jq-pipelines.md + claude-json-keys.md. Helper split mapped: `_settings_validate`@69 (jq empty 72-74), `_settings_install`@80, `_settings_reconcile`@88-99 (jq 91-92), `_settings_merge`@103-119 (jq 106-112, perms 109-111), `sync_settings`@121-145, `sync_claude_json`@147-170 (jq 160). source_files claude.sh `69-170`.
- `codex-config-merge-context/` — SKILL + awk-merger.md + rules-format.md. `ensure_bubblewrap`@38-71 (eval 60), `sync_rules`@107-129, `sync_config`@146-178, `scrub`@184-219 (grep 189), `merge_top`@221-262, `merge_table`@264-292 (extract 272-278, delete 281-285, append 287-290, header-grep 291). source_files codex.sh `38-292`.
- `universal-skills-context/` — SKILL + cli-arg-trap.md + storage-model.md. `sync`@13-35, strip 50-53, pre-check 66-72, npx 78, `heal`@110-143 (rel_target 115, readlink-cmp 122, rm 129, real-dir 130-132, ln 141), `browser`@145-192 (--with-deps 151), `_remove_one_slug` npx-remove@211, `reconcile`@219-251 (early-return 227-232), `update_snapshot`@252-264. Also fixed cli-arg-trap.md's stale plan path → `finished/2026-05-14-…`. source_files skills.sh `1-278`.
- `plugin-bootstrap-context/` — SKILL + six-pass-flow.md + tri-state-semantics.md. Re-mapped six passes onto the new `_plugins_*` helpers + `sync_plugins`@292-329 orchestrator: add-mp@183-201 (192), install@204-222 (213, keys 219), update@226-243 (mp-update 230, plugin-update 235), uninstall@247-266 (has() 254, uninstall 255), remove-mp@270-290 (official-guard 277, remove 279); pre-check 189. Codex: `sync_marketplace`@315-356 (unique_by 341), `remove_legacy_docks_marketplace`@383-402 (395), `sync_plugins`@454-489 (add 471). source_files claude.sh `176-329`, codex.sh `315-489`.
- `sync-orchestration-context/` — SKILL (sync.sh 4/6/14-30/35-54; common.sh 4-11/30-37/43-49/53/57-61/65-69; claude.sh 11/27-30/230/399) + dispatch-flow.md (fixed `sync_plugins` 292-332→**292-329**, idempotency pre-check 57→**66**, removed-fn lines) + flag-matrix.md (45-46/30-37/53/57-61; codex bubblewrap-skip 47; claude rtk-skip 354).

**Deletions (git rm, per D2 confirmed):** `.claude/skills/skill-maintenance/` (SKILL + 2 refs) + `.claude/agents/skill-author-agent.md`.

**Claude agents refreshed (5):** all stale `lib:line` refs re-derived (not just the manifest's `bootstrap_marketplace`/clause edits — see scope note); skill-author hand-offs/exclusions repointed to `docks:skill-maintenance` / `docks:write-skill`; `codex::bootstrap_marketplace` → `codex::remove_legacy_docks_marketplace` + `codex::sync_plugins`.

**Codex agents created (5):** `.codex/agents/{codex-config,plugin-bootstrap,settings-json,skills-bootstrap,sync-mechanic}-agent.toml` — `model="gpt-5.3-codex"`, `sandbox_mode="read-only"`, `developer_instructions` = corrected `.md` body verbatim. All parse-validated (tomllib) with the 3 required keys.

### Scope decisions made during execution (beyond the locked manifest)
1. **Agent bodies fully ref-refreshed, not just the 2 manifest edits.** The 5 keeper agents carried the same refactor-stale `lib:line` refs as the skills (e.g. `claude.sh:198`→254, `codex.sh:87`→60), and their own Anti-Hallucination sections instruct readers to verify those now-wrong lines; leaving them would ship knowingly-wrong refs into both the `.md` and the verbatim `.toml` twin. Refreshed all to honor the "Full refresh"/accuracy mandate.
2. **Codex `developer_instructions` use TOML `'''` literal strings, not the reference's `"""`.** `codex-config-agent`'s body contains awk regex backslashes (`/^\[/`, `^[A-Za-z0-9_.-]+`); TOML `"""` basic strings process backslash escapes → invalid TOML. `'''` literal preserves backslashes verbatim (standard TOML 1.0). The builder reference's `"""` worked example simply never contained a backslash.

### Verification
- Every `lib:line` ref content-verified against current source during re-derivation; programmatic in-range check across all skills+agents+tomls → 0 out-of-range.
- Dangling-ref greps clean: no `bootstrap_marketplace`, `codex::sync_rtk`, `skill-author-agent`, or local `skill-maintenance` path refs remain.
- 5 TOMLs parse valid (tomllib) with required `name`/`description`/`developer_instructions`.

### Out-of-scope follow-ups (still NOT done — flagged only)
- `AGENTS.md:62` "skill-maintenance meta" phrase (→ `human-docs-workflow`).
- `CLAUDE.md` cites missing `guard-agents.sh`/`score-agents.sh`; repo also missing `guard-skills.sh`/`score-skills.sh` (→ new plan: create validators or scrub refs).
- Root-cause: durable skills should cite function names + one `source_files` range, not dozens of inline line numbers (candidate plan).

**Not committed** — changes staged/working-tree only; awaiting user go-ahead to commit + ship (move to `finished/`, set `ship_commit`).

## Review

- **Goal met:** yes — ship_commit `a8138e4` delivers all four manifest buckets plus the Phase 8 "Full refresh" rescope. Verified against current source (claude.sh 420 / codex.sh 506 / skills.sh 278 / common.sh 71 / sync.sh 54): (1) 5 keeper skills + 8 `references/` files refreshed, all `updated: "2026-05-28"`; `source_files` ranges re-derived (codex `38-292`, claude `69-170` settings, claude `176-329` + codex `315-489` plugin-bootstrap, skills `1-278`); (2) D2 cascade — `.claude/skills/skill-maintenance/` and `.claude/agents/skill-author-agent.md` deleted; (3) 5 keeper Claude agents ref-refreshed; (4) 5 `.codex/agents/*.toml` twins created (`model="gpt-5.3-codex"`, `sandbox_mode="read-only"`). All 5 TOMLs parse via tomllib with the 3 required keys (`name`/`description`/`developer_instructions`), and each `developer_instructions` is byte-identical to its corrected `.md` body post-frontmatter (verbatim claim confirmed).
- **Regressions:** none — 316 `lib:line` refs across all shipped skills+agents are in-range (0 out-of-range); named anchors content-verified against current source (e.g. `lib/claude.sh:69` `claude::_settings_validate`, `:103` `_settings_merge`, `:121` `sync_settings`, `:147` `sync_claude_json`, `:292` `sync_plugins`; `lib/codex.sh:38` `ensure_bubblewrap`, `:315` `sync_marketplace`, `:383` `remove_legacy_docks_marketplace`, `:454` `sync_plugins`; `lib/skills.sh:110` `heal_claude_symlink`, `:219` `reconcile_removals`). Dangling-ref greps clean across `.claude`/`.codex`: no `bootstrap_marketplace`, `codex::sync_rtk`, `skill-author-agent`, `.claude/skills/skill-maintenance` path, `/home/vagrant`, or `guard-*.sh`/`score-*.sh` refs remain.
- **CI:** n/a — repo has no `scripts/ci.sh` and AGENTS.md states "No automated tests yet". Substituted regression scan (per ship-review request): (a) all 316 `lib:line` refs validated in-range + anchor-verified against current source; (b) 5 `.codex/agents/*.toml` parse-valid via `tomllib` with all 3 required keys. Both substitute gates pass.
- **Follow-ups:** none required for goal. Plan-flagged out-of-scope items remain open (carried verbatim, not created here): `scrub-stale-validator-refs` (`CLAUDE.md` cites missing `guard-skills.sh`/`score-skills.sh`/`guard-agents.sh`/`score-agents.sh` — create the validators or scrub the refs; also `AGENTS.md:62` "skill-maintenance meta" phrase), `durable-skill-refs-design` (root-cause: `*-context` skills hardcode dozens of `lib:line` refs that break on every refactor — cite function names + one `source_files` range instead).
- Filed by: plan-review on 2026-05-28T17:19:28-03:00
