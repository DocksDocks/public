---
title: Audit kit-mechanic skills & agents for content-accuracy drift
goal: Content-accuracy audit + pattern scan of the 5 kit-mechanic skills and 5 agents vs current lib/*.sh; emit the skill/agent delta.
status: finished
created: "2026-07-06T11:29:06-03:00"
updated: "2026-07-06T12:17:58-03:00"
started_at: "2026-07-06T11:50:38-03:00"
assignee: null
tags: [skills, agents, audit, content-accuracy]
affected_paths:
  - .claude/skills/
  - .claude/agents/
  - .codex/agents/
related_plans:
  - finished/2026-05-28-skills-audit.md
  - finished/2026-05-28-durable-skill-refs.md
review_status: passed
ship_commit: "3a2515a8d6ba9d48ae80abe6ecc56361ec1650ec"
---

## Goal

Run the `docks:skill-agent-pipeline` evidence phases (1 → 2a → 2c → 2b) over this
repo's kit-mechanic skills and agents at maximum thoroughness, then emit the
skill/agent delta (create / refresh / rewrite / regenerate). Success = every
checkable claim in all 5 skills (SKILL.md + 2 references each) and all 5 agents
verified against **current** `lib/*.sh` / `sync.sh` / `SoT/`, drift adversarially
re-checked, and a reconciled delta the user can `start` to implement.

**Read-only until `start skills-agents-audit`.** Phases 1–6 write nothing to the
skills/agents; only this plan file is written. Implementation (Phase 7) runs on start.

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Phase 0 — state detection (counts, today) | — | done |
| 2 | Phase 1 — exploration (profile, enumerate skills/agents, knowledge areas) | 1 | done |
| 3 | Phase 2c — content-accuracy audit of every skill + agent claim vs source (parallel auditors + adversarial verify) | 2 | done |
| 4 | Phase 2b — net-new pattern scan per source area + coverage map | 2 | done |
| 5 | Phase 2a — categorizer delta, reconciled with 2c escalations | 3,4 | done |
| 6 | Phase 3 — draft SKILL.md/references for each create/refresh/rewrite | 5 | done |
| 7 | Phase 4a/4b/5 — agent role map + regenerate any non-CLEAN agent (`.md` + `.toml`) | 5 | done |
| 8 | Phase 6 — verification (skills + both agent formats + cross-layer) | 6,7 | done |
| 9 | Gate — surface delta; on `start`, Phase 7 implements | 8 | done |

## Acceptance criteria

- Phase 2c table has one row per artifact (5 skills + 5 agents) with a **non-zero**
  `claims checked` count — never a sample. Roll-up states total claims / drift /
  CLEAN·REFRESH·REWRITE (skills) and CLEAN·REGEN (agents).
- Every drift finding was adversarially re-checked (refute-by-default) and only
  CONFIRMED ones survive into the delta.
- Any skill whose parsed `description` > 1024 chars is flagged `rewrite-description`
  (Codex hard-skips it). **Known: `universal-skills-context` = 1056 chars.**
- Phase 6 hard-fails on: over-cap description not flagged, live `path:NN` line anchor
  in a body, 310–500-line body with no `references/`, or a skill-path referenced by an
  agent that is neither on disk nor in the Phase 3 plan.
- No edits to `AGENTS.md` / `CLAUDE.md` from this pipeline (that is `multi-tool-bridge`).

## Phase 0: State

- **Today:** 2026-07-06
- **Claude skills** (`.claude/skills/*/SKILL.md`): **5** (each with 2 `references/*.md` → 15 skill files)
- **Universal skills** (`.agents/skills/*/SKILL.md`): 0
- **Claude agents** (`.claude/agents/*.md`): **5**
- **Codex agents** (`.codex/agents/*.toml`): **5** — clean 1:1 parity with the `.md` set
- **Local `skill-maintenance`:** none (plugin `docks:skill-maintenance` covers both tools) — nothing to flag for removal
- **Plugin `docks:skill-maintenance`:** available (docks 0.11.0)
- **Plan slug:** `skills-agents-audit` (no collision; prior `2026-05-28-skills-audit.md` is in `finished/`)

## Phase 1: Exploration Results

### Project Profile

Portable multi-tool AI-agent **config kit** (not an app). No package manager, no
build, no automated tests. Code = Bash: `sync.sh` (thin orchestrator) + `lib/*.sh`
(~1,691 LOC: `claude.sh` 736, `codex.sh` 487, `skills.sh` 391, `common.sh` 77).
Declarative config under `SoT/` (`.claude/settings.json`, `.codex/config.toml`,
`.codex/rules/*.rules`, `.agents/skills.txt`) deployed to `~/` by sync.

Docs: root `AGENTS.md` (89L, cross-tool source of truth) + `CLAUDE.md` (423L,
Claude-specific, line 1 = `@AGENTS.md` shim). `docs/plans/` is an established
context-tree node. The 5 skills + 5 agents document the regression-prone
bash/awk/jq logic in `lib/*.sh`.

### Existing Skills

| Skill | desc chars | source_files | references/ | updated | flag |
|-------|-----------:|--------------|-------------|---------|------|
| `codex-config-merge-context` | 733 | 3 (`lib/codex.sh` 36-290, `config.toml` 1-23, `docks.rules` 1-50) | `awk-merger.md`, `rules-format.md` | 2026-06-23 | — |
| `plugin-bootstrap-context` | 821 | 4 (`lib/claude.sh` 377-648, `lib/codex.sh` 292-470, `settings.json` 237-268, `marketplace.json` 1-22) | `seven-pass-flow.md`, `tri-state-semantics.md` | 2026-07-05 | — |
| `settings-merge-context` | 972 | 3 (`lib/claude.sh` 71-390, `settings.json` 1-13, `mcp-servers.json` 1-9) | `claude-json-keys.md`, `jq-pipelines.md` | 2026-06-18 | near cap |
| `sync-orchestration-context` | 508 | 2 (`sync.sh` 1-55, `lib/common.sh` 1-77) | `dispatch-flow.md`, `flag-matrix.md` | 2026-07-03 | — |
| `universal-skills-context` | **1056** | 2 (`lib/skills.sh` 1-391, `skills.txt` 1-14) | `cli-arg-trap.md`, `storage-model.md` | 2026-07-03 | **>1024 — Codex skips it** |

All bodies are 138–180 lines (well under the 310 split threshold / 500 cap). All use
the `metadata.source_files[].path + .lines` form (the one sanctioned line-number
touchpoint per the repo's no-`file:NNN` constraint).

### Existing Agents

Each logical agent ships as a `.claude/agents/<name>.md` (body 96–109L) + a
`.codex/agents/<name>.toml` twin (95–108L). All `model: sonnet`, `tools: Read, Grep,
Glob, Bash` (read-only auditors). All descriptions 389–480 chars (under cap). Clean
1:1 parity — no cross-format drift at the file level.

| Agent (logical) | wraps skill | .md / .toml |
|-----------------|-------------|-------------|
| `codex-config-agent` | `codex-config-merge-context` | ✓ / ✓ |
| `plugin-bootstrap-agent` | `plugin-bootstrap-context` | ✓ / ✓ |
| `settings-json-agent` | `settings-merge-context` | ✓ / ✓ |
| `skills-bootstrap-agent` | `universal-skills-context` | ✓ / ✓ |
| `sync-mechanic-agent` | `sync-orchestration-context` | ✓ / ✓ |

### Knowledge Areas Identified (candidate gaps — confirmed by the coverage map in 2b)

Source functions **not** obviously covered by any skill's `source_files`, as located
facts (not yet judged):

- **RTK sync cluster** — `claude::sync_rtk`, `claude::_warn_rtk_outdated` (`lib/claude.sh:650,667`). No skill's `source_files` names them. Candidate new area or explicit "too small."
- **Claude scaffolding** — `claude::sync_scripts`, `sync_hooks`, `sync_claude_md` (`lib/claude.sh:31,44,64`). Plumbing; likely too small.
- **Codex `sync_agents_md`** (`lib/codex.sh:129`) — deploys `SoT/.codex/AGENTS.md`; not in any `source_files`.
- **Per-tool `summary` / `next_steps`** (all 4 lib files) — display-only plumbing; likely too small.

> Note: `claude::sync_680k` (`lib/claude.sh:160`) IS covered by `settings-merge-context`
> (range 71-390) and DOES exist — flagged here only because a naive `[a-z_]+::[a-z_]+`
> grep misses it on the digit. Not a gap.

## Phase 2c: Content-Accuracy Audit

Evidence run `wf_a9a6bee6-d8a` — 35 agents, 2.77M tokens, ~14.5 min. Each artifact
audited by one auditor (every claim vs current source); each drift then
adversarially re-checked (refute-by-default).

| Artifact | kind | claims | drift flagged | CONFIRMED | verdict |
|----------|------|-------:|-------------:|----------:|---------|
| `codex-config-merge-context` | skill | 80 | 3 | 3 | REFRESH |
| `plugin-bootstrap-context` | skill | 74 | 5 | 5 | REFRESH |
| `settings-merge-context` | skill | 76 | 2 | 2 | REFRESH |
| `sync-orchestration-context` | skill | 63 | 1 | 1 | REFRESH |
| `universal-skills-context` | skill | 70 | 0 | 0 | CLEAN (content) |
| `codex-config-agent` | agent | 42 | 1 | 1 | fix |
| `plugin-bootstrap-agent` | agent | 33 | 3 | 3 | fix |
| `settings-json-agent` | agent | 34 | 2 | 1 | fix |
| `skills-bootstrap-agent` | agent | 40 | 1 | 1 | fix |
| `sync-mechanic-agent` | agent | 27 | 0 (audit) | 1 (critic) | fix |

**Roll-up:** 539 claims checked · 18 drift flagged · **16 CONFIRMED** (11 skill, 5
agent) + **1 cross-artifact defect** the critic caught · 1 REFUTED · 2 auditor
self-drops. Skills: 0 REWRITE, 4 REFRESH, 1 content-CLEAN (but over-cap description
— see 2a). Agents: 0 fully-clean — all 5 need a targeted fix.

### Confirmed skill findings (verbatim fixes)

- **S1** `codex-config-merge-context/references/rules-format.md` — the forbidden-tier "examples from docks.rules" cell lists `git push --force-with-lease (to main)`, but **docks.rules has no such rule** (grep returns nothing); the real rules are `--force`/`-f` (`docks.rules:112-115`). `--force-with-lease` would fall through to `prompt`, not `forbidden`. → replace with `git push --force origin main`.
- **S2** `codex-config-merge-context/SKILL.md:129` — body heading carries a raw line-anchor `docks.rules:1-50` (also stale: file is 116 lines). Forbidden by the no-`file:NNN`-in-body rule; frontmatter already holds the exempt range. → drop `:1-50`.
- **S3** `codex-config-merge-context/references/rules-format.md:40` — heading `(lines 1-50)` line-anchor. → drop the range.
- **S4** `plugin-bootstrap-context/references/tri-state-semantics.md` — claims `--force`'s `$user * $repo` merge deletes a removed `enabledPlugins` key. It does **not** (nothing in the merge deletes user-only keys). → attribute stale-key removal to the CLI uninstall (pass 5 / `--remove-plugins`), or state the key must be removed manually.
- **S5** `plugin-bootstrap-context/references/tri-state-semantics.md:47` — example says `context7`/`frontend-design` are absent from `enabledPlugins`; they are declared `true` (already protected). → reword or cite a genuinely-absent plugin.
- **S6** `plugin-bootstrap-context/SKILL.md:160` + `references/seven-pass-flow.md:136` — bash-3.2 portability note anchored to `claude::_cli`; the `echo '<count> <failed>'` pattern lives in `claude::_plugins_add_marketplaces`. → re-anchor both.
- **S7** `plugin-bootstrap-context/SKILL.md:121` — "plugins at step 8"; `sync_plugins` is step **10** in `claude::sync`. → fix ordinal or drop it (state only sync_settings precedes sync_plugins).
- **S8** `plugin-bootstrap-context/SKILL.md:56` — raw line-anchor `SoT/.claude/settings.json:245-257`. → drop suffix; the three named example keys are durable.
- **S9** `settings-merge-context/SKILL.md:147` — `// []` gotcha reasoning is wrong: a single-sided null concatenates fine; the guard matters only when **both** sides lack the key (`null + null` → null → the following `| unique` errors). → reword.
- **S10** `settings-merge-context/SKILL.md:148` — raw line-anchor `settings.json:1` for `$schema`. → drop `:1`.
- **S11** `sync-orchestration-context/references/dispatch-flow.md` — idempotency table attributes the plugin-install pre-check to `claude::_plugins_install` with a bare `jq -e '.plugins[$n]'`; the real guard is the **user-scope** check in `claude::_plugin_user_scope_installed`. → update the cell + attribution.

### Confirmed agent findings (verbatim fixes — apply to `.md` AND its `.toml` twin)

- **A1** `codex-config-agent.md:33` — workflow step asserts a macOS early-return *inside* `codex::ensure_bubblewrap`; the OS guard is `codex::_bwrap_supported_os` (`Darwin*` → `return 1`) and the apt-get→dnf→pacman→zypper order is in `codex::_bwrap_detect_pm_install_cmd`. → rewrite the step to the real helpers.
- **A2** `plugin-bootstrap-agent.md:24-26` — says the Codex `unique_by(.name)` dedup lets **user** entries win; the **SoT/repo** entry wins on a `.name` collision (reverse-unique-reverse keeps last-in-original, `$repo` concatenated last; user-only plugins still survive additively). → correct the causal claim.
- **A3** `plugin-bootstrap-agent.md:56,80` — raw line-anchor `SoT/.claude/settings.json:245-257` (×2). → semantic ref ("the `enabledPlugins` block in …").
- **A4** `plugin-bootstrap-agent.md:30` — "six-pass structure" → **seven-pass** (consistent with the skill).
- **A5** `settings-json-agent.md:97` — gotcha claims jq `unique` preserves first-occurrence order and appends new entries; `unique` **sorts** (lexicographic) then dedups. → reword.
- **A6** `skills-bootstrap-agent.md:104` — gotcha #4 claims a failed-install slug is absent from the snapshot; it **is** recorded (`skills::update_snapshot` mirrors the manifest, not install results). The real limitation: re-attempted every sync via the `$SKILLS_DIR/$basename` dir-existence pre-check, no backoff. → reword.
- **A7 (critic catch — audit couldn't see it)** `sync-mechanic-agent.md:74` — Integration routes `claude::sync_plugins` handoff to `settings-json-agent`, contradicting its own description (line 3: "plugin reconcile → `plugin-bootstrap-agent`"), its line-37 handoff, and `settings-json-agent`'s own exclusion. → remove `claude::sync_plugins` from line 74 (route it to `plugin-bootstrap-agent`).

### Dropped (failed reproduction / refuted)

- `settings-json-agent.md:95` "corrupted settings.json silently skips **the entire sync**" — **REFUTED, keep as-is.** The verifier traced `set -euo pipefail`: `_settings_validate || return` propagates non-zero from `sync_settings`, called as a plain command in `claude::sync`, so `set -e` aborts the whole run (empirically reproduced; `lib/claude.sh:378` comment documents the exact mechanism). The gotcha is accurate; the auditor mis-traced `set -e`.
- Two auditor self-drops in `codex-config-merge-context` (the "only sudo command" superlative; the blank-line-accumulation gotcha) — verified accurate, not findings.

## Phase 2b: Pattern Scanner Findings

Net-new (not covered by existing skills): claude-sh 12 · codex-sh 11 · skills-sh 9 ·
orchestration 4 · sot-config 14 = **50 candidate patterns**. The highest-value are
**latent defects/foot-guns**, split by whether they belong in skill docs or are real
code issues:

### Documentation gaps → fold into the REFRESH skills

- `codex::_enabled_plugin_ids` awk state-machine (`lib/codex.sh:403-433`): `flush_plugin()` on `[`-boundary + END, the comment-tolerant `enabled = true([[:space:]]*(#.*)?)?` regex, and **default-DISABLED** when a plugin table omits `enabled`. Undocumented at implementation level. → `plugin-bootstrap-context` (already REFRESH).
- `codex::_bwrap_detect_pm_install_cmd` + `codex::_bwrap_supported_os` (`lib/codex.sh:73-93`): PM-install matrix + OS gate, named in no skill. → `codex-config-merge-context` (already REFRESH).
- **RTK bootstrap subsystem** — `claude::sync_rtk` + `claude::_warn_rtk_outdated` (`lib/claude.sh:650-710`, ~60 LOC): download-then-run install, GitHub-API numeric version-compare, `rtk init --global` "only when RTK.md absent" gate, `@RTK.md` strip on `--no-rtk` (DRY_RUN-gated), post-install PATH export. **Documented by no skill.** → see 2a coverage decision.

### Code-level defects (OUT of pipeline scope → route to `docks:fix-workflow`)

These are real risks the pattern scan surfaced; the pipeline only documents, it does
not fix code. Listed for the user to triage separately:

1. **RTK hook self-wipe on a fresh machine** — `sync_rtk` (last pass) runs `rtk init --global`, which clears `hooks.PreToolUse` to `[]`; on a brand-new machine (no `~/.claude/RTK.md`) it wipes the RTK hook `sync_settings` just wrote. First `./sync.sh` reports success but RTK compression is silently off until a 2nd sync. (Matches memory `project_rtk_init_clears_hooks`.)
2. **`claude::sync_scripts` unguarded `cp`** — `statusline.sh`/`fetch-usage.sh` copied with no `[[ -f ]]` guard (unlike `notification.mp3`); under `set -e` a missing/renamed SoT script aborts the **entire** Claude sync at pass 1 with only a raw `cp` error.
3. **`common::select_target` sets `TARGET_FILTER_SET=1` before its case** (`lib/common.sh:35`), and the case has no else-arm → a typo'd/missing target arm makes `./sync.sh --newtarget` sync **nothing** and exit 0 (silent no-op read as success).
4. **`codex::sync_agents_md` writes no `.bak`** (unlike sync_config/rules/marketplace) → silently overwrites a hand-edited `~/.codex/AGENTS.md`, unrecoverable.
5. **`--force` is a near-no-op on Codex `config.toml`** — `FORCE` only changes the log wording ("reconciled"); the merge stays additive, so user top-level keys / `[table]` blocks survive. The log actively implies a wholesale reset that didn't happen.
6. **`sed -n -i` policy-bypass** (`docks.rules:100-101`) — load-bearing: `sed -n` is `allow` and matching is argv-prefix, so `sed -n -i 's/…' f` shares the allowed prefix; the rules-format.md reference misdescribes this (says `sed -i` "different second token"), missing the combo. Removing the gate re-opens a silent in-place edit.
7. **`tail -f` / `rg --pre` escalations** (`docks.rules:94-96`) look like duplicates of allowed `tail`/`rg` but are load-bearing (hang / arbitrary-preprocessor exec). Undocumented as load-bearing → deletion risk.

Lower severity: `codex::summary` `grep -c` counts disabled plugins too; `_warn_rtk_outdated` numeric field-sort mis-ranks `-rc` suffixes (advisory only); stale `alert` log string in `sync_scripts` success line; `rm -rf /` deny globs carry a trailing ` *` that a bare `rm -rf /` may not match (PLAUSIBLE — auto-mode classifier bounds it); three duplicate comment-strip implementations in `skills.sh` must stay behaviorally identical.

## Phase 2a: Categorizer Proposals (reconciled with 2c + coverage)

### Skill audit + action

| Skill | 2c | description | Action |
|-------|----|-----------:|--------|
| `codex-config-merge-context` | REFRESH (S1–S3) | 733 ✓ | **REFRESH** — apply S1–S3; add `_bwrap_detect_pm_install_cmd`/`_bwrap_supported_os` section |
| `plugin-bootstrap-context` | REFRESH (S4–S8) | 821 ✓ | **REFRESH** — apply S4–S8; add `_enabled_plugin_ids` awk section |
| `settings-merge-context` | REFRESH (S9–S10) | 972 ✓ | **REFRESH** — apply S9–S10 |
| `sync-orchestration-context` | REFRESH (S11) | 508 ✓ | **REFRESH** — apply S11; optional RTK section (decision below) |
| `universal-skills-context` | content CLEAN | **1056 ✗** | **REWRITE-DESCRIPTION** — trim to ≤1024 (Codex silently skips it today) |

### New-skill decision (open question for the user)

The RTK-bootstrap subsystem is the only genuine coverage gap. Two options:
- **(recommended)** add an `## RTK bootstrap` section to `sync-orchestration-context` — it already owns `--no-rtk` + `SKIP_OPTIONAL_BOOTSTRAP`, and the numeric-version-sort pattern is shared with `skills::_agent_browser_newer_npm`; one anchor, no new skill-listing cost.
- create a new `rtk-bootstrap-context` skill (+ `references/`) + optional wrapper agent — cleaner SRP, but adds a skill + agent pair to the budget.

### Agents

All 5 need a **surgical fix** (A1–A7), not a full regen — each is a single factual/anchor
drift; wholesale regeneration would risk new drift and lose the durable structure. Apply
each fix to the `.claude/agents/*.md` **and** mirror it into the `.codex/agents/*.toml`
twin (shared prose). No new agents; no agent deletions.

### Maintenance skill

None. No local `skill-maintenance` exists; plugin `docks:skill-maintenance` covers both
tools. Nothing to add or remove.

## Phase 3: Skills Plan

Implementation is **surgical edits**, not redrafts — the full spec is the S1–S11 fix list
in Phase 2c plus the two doc-gap sections in Phase 2b. On `start`: back up each touched
`SKILL.md`/`references/*.md` to `<name>.bak`, apply the exact fixes, bump
`metadata.updated` to 2026-07-06 only on the skills actually edited (all 5). The
`universal-skills-context` description rewrite must re-verify ≤1024 chars before/after.

## Phase 4a: Role Mapper Proposals

No role changes — the 5 existing roles map 1:1 to the 5 skills and stay. Audit result:
one broken internal handoff (A7) to fix; no broken skill-path references; no
overlaps/splits. Fold the RTK coverage into `sync-mechanic-agent`'s domain only if the
RTK section lands in `sync-orchestration-context` (recommended option).

## Phase 4b: Pattern Extractor Content

No new agent bodies to extract — fixes are targeted edits to existing prose (A1–A7). The
only additive content is the RTK anchor, pending the 2a decision.

## Phase 5: Agents Plan

Per agent, apply A1–A7 to the `.md` and mirror into the `.toml` `developer_instructions`
(prose is shared; the twin must not drift). Back up each edited file to `<name>.md.bak` /
`<name>.toml.bak`. No frontmatter, model, tools, or `sandbox_mode` changes. Verify `.md`↔`.toml`
name parity holds after edits.

## Phase 6: Verification — PASSED (2026-07-06)

Implemented by workflow `wf_2dfea8ef-25d` (10 implementers + 10 verifiers, 20 agents,
0 errors). All 16 S1–S11 / A1–A7 fixes + 3 doc-gap sections + RTK section + the
`universal-skills-context` description rewrite landed. **Scope: 19 files, +97/−49**
(5 skills + refs, 5 agent `.md` + 5 `.toml` twins). Final sweep:

- ✅ **Zero live line-anchors** in any skill/agent body (S2, S3, S8, S10, A3 gone; repo-wide grep clean).
- ✅ All 5 descriptions ≤1024 — `universal-skills-context` 1056 → **897** (Codex will now load it); others unchanged (`plugin-bootstrap-context` 821 → 825 from the dedup wording fix).
- ✅ All 5 skills `metadata.updated: "2026-07-06"`.
- ✅ `.md`↔`.toml` twins byte-consistent in shared prose; name parity intact.
- ✅ Refuted gotcha (`settings-json-agent` "silently skips the entire sync") preserved verbatim in both twins.
- ✅ No `.bak` files; no `AGENTS.md`/`CLAUDE.md` edits; the 7 code-level defects untouched (separate `fix-workflow`).

### Two extra fixes the verifiers caught (beyond the S/A list)

The per-artifact verifiers surfaced a defect the original 2c skill-audit **missed** —
worth recording because it shows why the verify stage is not optional:

- **`plugin-bootstrap-context` "user-entry-wins" reversal** — the skill body (SKILL.md), its `references/seven-pass-flow.md`, AND its CSO description all claimed the Codex `unique_by(.name)` dedup lets the **user** entry win on a `.name` collision. Ground truth (`lib/codex.sh:316-319`, `($user + $repo) | reverse | unique_by(.name) | reverse`, empirically jq-tested): the **SoT/repo** entry wins (and `unique_by` keeps the *first* occurrence, not the last — the skill's reasoning was doubly wrong). The audit had caught this on the *agent* (A2) but not the skill, so post-A2 the skill contradicted its own wrapper + source. Fixed all 3 spots to mirror A2.
- **3 minor accuracy fixes:** `codex-config-merge-context` `source_files` docks.rules range `1-116`→`1-115` (off-by-one); `sync-orchestration-context/references/dispatch-flow.md` `claude::sync_plugins (six-pass reconcile)`→`(seven-pass)`; added `lib/claude.sh` `650-710` to `sync-orchestration-context` `source_files` (now that its RTK section documents `claude::sync_rtk`).

## Review

- **Goal met:** yes — all 16 S1–S11 / A1–A7 fixes + 3 doc-gap sections (`_bwrap_supported_os`/`_bwrap_detect_pm_install_cmd`, `_enabled_plugin_ids` awk, RTK bootstrap) + the `universal-skills-context` description rewrite (1056→897 chars, ≤1024) all landed and verify against current `lib/*.sh`. Highest-risk claim confirmed: `reverse | unique_by(.name) | reverse` empirically jq-tested — SoT/repo entry wins, `unique_by` keeps the first occurrence, user-only plugins survive additively; the old "user-entry-wins" prose was wrong and is now corrected in SKILL.md, seven-pass-flow.md, the CSO description, and the `plugin-bootstrap-agent` twin (A2).
- **Regressions:** none — no live `file:NN` body line-anchor survives (repo-wide grep clean); `.md`↔`.toml` twins byte-consistent across all 5 agents (A1–A7 identical in both formats); 19 changed files all within `affected_paths` (`.claude/skills/`, `.claude/agents/`, `.codex/agents/`); no `AGENTS.md`/`CLAUDE.md` collateral; no `.bak` residue; all 5 skills bumped to `updated: "2026-07-06"`; refuted `settings-json-agent` gotcha correctly preserved.
- **CI:** n/a — no automated tests; doc-only change, diff-reviewed.
- **Follow-ups:** none — the 7 out-of-scope code-level defects surfaced in Phase 2b (RTK hook self-wipe, unguarded `sync_scripts` cp, `common::select_target` silent no-op, `sync_agents_md` no `.bak`, `--force` Codex no-op logging, `sed -n -i` policy-bypass, `tail -f`/`rg --pre` escalations) are tracked separately for `docks:fix-workflow`, not this plan.
- Filed by: plan-review on 2026-07-06T12:17:58-03:00
