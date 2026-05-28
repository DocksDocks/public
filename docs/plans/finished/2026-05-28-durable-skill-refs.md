---
title: Convert skill/agent lib:line refs to durable function anchors
status: finished
created: 2026-05-28
updated: 2026-05-28
assignee: null
blockers: []
blocked_reason: null
blocked_since: null
ship_commit: 2e8961b89010a8f3d529baa957b10f7c6badbb5a
---

# Convert skill/agent lib:line refs to durable function anchors

## Context

The 5 `*-context` kit-mechanic skills, their 10 `references/` files, the 5
wrapper agents, and the 5 Codex agent TOMLs hardcode **314 inline
`lib/<file>.sh:NNN` line-number references** that break on every refactor of
`lib/*.sh` / `sync.sh`. The `5d6a6b5` "Refactor sync libs (12 SOLID fixes)"
commit invalidated all of them ~1 h after the skills were authored, leaving
them stale for 11 days until the `2026-05-28-skills-audit` plan re-derived and
verified every one (shipped in `a8138e4`).

That refresh fixed the symptom, not the cause: precise line numbers are
inherently fragile. A **durable** reference cites the stable function name plus
a semantic anchor (what the line does), and relies on a single coarse
`source_files` range per file for navigation — so a refactor that moves lines
within a function no longer invalidates the body. This plan does that
conversion. It is the root-cause follow-up flagged in the skills-audit plan's
"Phase 8 finding" and confirmed by `plan-review` (`durable-skill-refs-design`).

## Scope

Convert every inline `lib/<file>.sh:NNN` / `sync.sh:NNN` reference to a
function-name + semantic-anchor form across **25 files (314 refs)**:

| Layer | Files | Refs |
|---|---|---|
| `.claude/skills/*-context/SKILL.md` | 5 | 107 |
| `.claude/skills/*-context/references/*.md` | 10 | 87 |
| `.claude/agents/*.md` (5 keepers) | 5 | 60 |
| `.codex/agents/*.toml` (developer_instructions) | 5 | 60 |

Per-file ref counts (from `2026-05-28` audit): codex-config-merge SKILL 15 /
awk-merger 6 / rules-format 3; plugin-bootstrap SKILL 34 / six-pass-flow 18 /
tri-state 2; settings-merge SKILL 12 / jq-pipelines 5 / claude-json-keys 4;
sync-orchestration SKILL 27 / dispatch-flow 30 / flag-matrix 7;
universal-skills SKILL 19 / cli-arg-trap 5 / storage-model 7; agents
codex-config 13 / plugin-bootstrap 9 / settings-json 11 / skills-bootstrap 15 /
sync-mechanic 12 (each mirrored 1:1 in its `.toml` twin).

**Conversion rule (per ref):**
- `(lib/claude.sh:254)` → `(claude::_plugins_uninstall, the has($n) guard)` —
  name the enclosing function + the semantic anchor; drop the raw line number.
- Code-block captions like ``Pass 5 — `has()` guard (lib/claude.sh:254)`` →
  ``Pass 5 — `has()` guard (claude::_plugins_uninstall)``.
- Keep ONE coarse `metadata.source_files[].lines` range per file (re-derive once
  to the enclosing-function span; it is allowed to be approximate and is the
  single intentional line-number touchpoint).
- Where a precise location genuinely aids navigation, an optional trailing
  "(~line N)" hint is allowed but must be marked approximate so staleness
  triage ignores it — prefer the function name as primary.

**Agent/TOML coupling:** each `.codex/agents/<name>.toml`
`developer_instructions` is a byte-verbatim copy of its `.claude/agents/<name>.md`
body (a cross-layer invariant the audit established and `plan-review` verified).
So every agent `.md` edit MUST be reflected in its `.toml` twin in the same
change, and the twin re-validated with `tomllib`.

## Acceptance criteria

- [x] Zero inline `lib/<file>.sh:NNN` or `sync.sh:NNN` refs remain in the 15
      skill files (grep `(lib/(claude|codex|skills|common)\.sh|sync\.sh):[0-9]` → 0,
      excluding any explicitly-marked "(~line N)" approximate hints).
- [x] Same for the 5 agent `.md` files and the 5 `.codex/agents/*.toml`.
- [x] Every converted ref names a function that actually exists in the cited
      `lib/*.sh` / `sync.sh` (verify each function name via `grep -n '^<fn>()'`).
- [x] Each file's `metadata.source_files[].lines` re-derived to the current
      enclosing-function span (skills only; agents have no source_files).
- [x] All 5 `.codex/agents/*.toml` still parse via `tomllib` with the 3 required
      keys, and each `developer_instructions` remains byte-identical to its
      `.md` twin body.
- [x] `metadata.updated` bumped to the change date on every skill file actually
      edited (no churn-only bumps).
- [x] A short "ref convention" note added to the `docks:write-skill` /
      `docks:skill-maintenance` guidance OR this repo's skill docs, so new
      skills follow the function-anchor style and the regression does not recur.

## Out of scope

- Scrubbing the stale `guard-*.sh`/`score-*.sh` validator refs in
  `SoT/.claude/CLAUDE.md` — **already done** (FU1, same session as this plan's
  creation).
- Creating the missing `guard-skills.sh`/`score-skills.sh`/`guard-agents.sh`/
  `score-agents.sh` validators — separate concern; not required for this plan.
- Changing skill/agent *content* beyond the reference style (no behavior or
  guidance changes).

## Blockers

None — actionable immediately.

## Notes

- **Why not keep line numbers + a regenerator script?** A "re-derive line
  numbers from function names" tool was considered but rejected for this plan:
  it adds a build step and still emits fragile numbers. Function-anchor refs are
  self-documenting and need no tooling. (If a regenerator is later wanted, file
  it separately.)
- **Trade-off accepted:** function-anchor refs lose click-to-line precision in
  the editor. Mitigation: the `source_files` range + function name get a reader
  to the right ~20 lines, and `grep -n '^<fn>()'` is one step. The durability
  win (no staleness on intra-function refactors) outweighs it for docs that are
  re-read far more often than they are navigated to source.
- **Sequencing:** do skills first (15 files), then agents (5 `.md`), then mirror
  into TOMLs (5) — agents/TOMLs reference the same functions, so the skill
  conversions establish the canonical anchor wording to reuse.
- **Related:** root-cause of the `2026-05-28-skills-audit` refresh
  (`docs/plans/finished/2026-05-28-skills-audit.md`, ship `a8138e4`); surfaced
  in its "Phase 8 finding — refactor-wide staleness" and the `## Review`
  follow-ups.

## Implementation

Converted by 5 domain workers (one per skill family: codex-config,
plugin-bootstrap, settings-merge, sync-orchestration, universal-skills), each
owning its `SKILL.md` + `references/` + wrapper `.md` agent + `.codex/*.toml`
twin, then centrally verified and reconciled. Per-domain ref counts converted:

| Domain | SKILL.md | references/ | agent `.md` (= `.toml`) |
|---|---|---|---|
| codex-config | 14 | 5 + 3 | 11 |
| plugin-bootstrap | 18 | 12 + 2 | 7 |
| settings-merge | 13 | 5 + 6 | 8 |
| sync-orchestration | 18 | 14 + 5 | 12 |
| universal-skills | 16 | 5 + 6 | 13 |

**Conversions applied beyond plain inline refs:**
- plugin-bootstrap `SKILL.md` six-pass table: dropped the `(NNN)` start-line
  parentheticals from the "Helper (def)" column and replaced the raw-line-number
  "Op line" column with a semantic "Operation" column (`marketplace add`,
  `plugin install`, …).
- sync-orchestration `dispatch-flow.md` tree: stripped the redundant
  `; lib/x.sh:NNN` fragments from nodes that already name their function.
- `sync.sh` (flat, no functions) refs → section anchors (e.g.
  `sync.sh (Claude dispatch block)`, `sync.sh (summary/next_steps declare-F guards)`).
- hook-file refs (`disable-claudeai-connectors.sh:NN`, bare `(line NN)`) →
  section anchors (e.g. `(the disabledMcpServers jq patch)`).

**Central verification (`/tmp/verify_refs.py`):**
- Residual numeric source refs across all 25 files: **0**.
- All 5 `.codex/agents/*.toml` parse via `tomllib`; required keys
  (`name`/`description`/`developer_instructions`) + `model`/`sandbox_mode` present.
- 48 distinct `tool::function` anchors referenced; **47 resolve to a real
  `lib/*.sh` def**, the 48th being the literal wildcard `claude::_plugins_*`
  (collective prose, not a single function) — not a broken ref.
- All 5 `.md` bodies **byte-identical** to their `.toml` `developer_instructions`
  after reconciling the post-frontmatter leading blank line into the 3 TOMLs
  (`settings-json`, `skills-bootstrap`, `sync-mechanic`) that lacked it.
- `metadata.source_files[].lines` ranges verified current (unchanged since the
  audit set them to coarse function-span ranges; `lib/*.sh` untouched since).

The convention note (criterion 7) landed in this repo's `AGENTS.md` § Skills as
a `<constraint>` — the `docks:write-skill` / `docks:skill-maintenance` guidance
lives in the separate plugin repo, so per the kit's "pipeline content lives in
the plugin, not here" rule, the repo-local skill docs are the correct home.
