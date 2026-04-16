# `/docs` + `/team` Merge — Design Spec

- **Date:** 2026-04-16
- **Author:** Eduardo Marquez (via Claude Opus 4.7 brainstorming session)
- **Status:** Approved design — ready for implementation planning.
- **Scope:** Merge `ssot/.claude/commands/docs.md` and `ssot/.claude/commands/team.md` into a single `/docs` command. Remove legacy context-tree migration. Harden subagent permissions.

---

## 1. Summary

The kit currently ships two coupled slash commands:

- `/docs` (880 lines) — bootstraps/manages project skills under `.claude/skills/`. Three internal modes: Bootstrap, Migration (legacy `.claude/context/` → skills), Manage (audit/add/rebalance).
- `/team` (388 lines) — generates `.claude/agents/*.md` files whose system prompts reference the skills produced by `/docs`. Hard-stops if no skills exist.

This spec collapses both into a single non-interactive `/docs` command that, on every run, audits the whole skills-and-agents surface and proposes every improvement it can find in one plan. Migration Mode is deleted entirely. Real YAML frontmatter with a narrow `allowed-tools` list replaces the current cosmetic "Allowed Tools" markdown section. A new shell-avoidance constraint in every subagent task block eliminates the `for … do … find … done` permission prompts the user has been hitting during exploration.

Estimated output: merged `docs.md` ≈ 650 lines (down from combined 1,268), `team.md` deleted.

---

## 2. Motivation

**Coupling.** Agents reference skill paths (`.claude/skills/<x>/SKILL.md`). When a skill moves, splits, or merges, agents break silently. Two commands cannot audit this cross-layer dependency without round-tripping through the user.

**Interactive drag.** Both commands ask `AskUserQuestion` to pick a mode. Every run costs a turn on a decision the command could make deterministically from filesystem state. The user has asked for fully non-interactive behavior: always audit, always fix, always add skills/agents wherever they would help.

**Dead code.** Migration Mode covers `.claude/context/` trees. The user has no such trees in their projects. The mode adds ~155 lines and four Phase 0 branches that fire only for a legacy shape.

**Permission prompts during exploration.** Subagents in the Explorer/Discovery phases compose shell one-liners like `for skill in …; do count=$(find … | wc -l); echo …; done`. Claude Code treats each subcommand of a compound construct independently (per [permissions docs](https://code.claude.com/docs/en/permissions): "A rule must match each subcommand independently"), and flags shell variable expansion with "Contains simple_expansion". No Bash pattern can pre-approve this shape. The fix is to stop composing shell loops and use tool-native equivalents (`Glob`, `Grep`, `Read`).

**Informational allow-list.** The current `## Allowed Tools` markdown section at the bottom of each command is not enforced — it is prose. Claude Code does enforce `allowed-tools` in YAML frontmatter ([docs](https://code.claude.com/docs/en/slash-commands#frontmatter-reference)), but neither command uses frontmatter today, so the kit's allow list is documentation only.

---

## 3. Non-goals / removed behavior

- **No mode selection.** `AskUserQuestion` is removed from both command flows. The command does the full audit-and-improve pass on every invocation. The `ExitPlanMode` gate after Phase 7 is the only user decision point.
- **No context-tree migration.** All Migration Mode content (`Phase 1G`–`Phase 4G`) deleted. `has_context_tree` detection removed. Repos that still have `.claude/context/` are treated as "no skills found" and bootstrapped fresh. No warning, no automatic migration. Users who still need to migrate can do it manually or from git history.
- **No "health check only" mode.** If a user wants to see proposed changes without executing them, they reject the plan at `ExitPlanMode`. Plan Mode already gives them that read.
- **No broad `Bash(rm:*)` or `Bash(git:*)` pre-approval.** With Migration Mode gone, no deletions are needed in the command flow. Git is read-only in planning (`git log`, `git status`); writes are out of scope.

---

## 4. Design overview

### 4.1 Entry point

Single slash command `/docs` (command name unchanged — title updated to "Project Skills & Agents Manager"). No arguments. User types `/docs`; command runs its full pipeline.

### 4.2 Phase structure

Eight phases, two parallel pairs:

| # | Phase | Parallel? | Waits for |
|---|---|---|---|
| 0 | State detection (counts of skills, agents, uncovered source dirs) | — | — |
| 1 | Exploration (single agent reads source tree + existing skills + existing agents) | — | 0 |
| 2 | Skills analysis: **Categorizer ∥ Pattern Scanner** | yes | 1 |
| 3 | Skills Builder (drafts create/update/split/merge deltas + skill-maintenance skill) | — | 2 |
| 4 | Agents analysis: **Role Mapper ∥ Pattern Extractor** — reads *proposed* skill set | yes | 3 |
| 5 | Agents Builder (drafts create/update deltas for `.claude/agents/`) | — | 4 |
| 6 | Unified Verifier (skills + agents + cross-layer reference check) | — | 5 |
| 7 | Present plan + `ExitPlanMode` | — | 6 |
| 8 | Implementation + final verification | — | user approval |

### 4.3 Always-perform rules

The command always proposes the following, based on the Auditor's findings:

- Missing skills → create.
- Stale skills (git shows source churn since `metadata.updated`) → refresh.
- Source dirs uncovered by any skill's `metadata.source_files` → new skill.
- `SKILL.md` > 500 lines → split.
- `SKILL.md` < 50 lines with no `references/` and < 3 distinct claims → merge into sibling.
- Descriptions failing CSO (no "Use when…" prefix, or lacking ≥5 project-specific keywords) → rewrite.
- Missing `.claude/skills/skill-maintenance/SKILL.md` → create. Exists but frontmatter drifted → fix. (Formerly built only in Bootstrap Mode; now always audited.)
- Missing agents whose backing skill warrants one (≥ 3 distinct claims, real domain boundary) → generate.
- Agents whose `.claude/skills/<x>/…` paths no longer exist → fix path (or mark agent for regeneration if the skill was replaced).
- Agents that inline skill content → rewrite to reference the skill.

Guardrails survive from the source commands:

- "No thin skills" — sibling merge instead of new skill.
- "Not every skill needs an agent" — Role Mapper skips skills with minimal content.
- Each agent must have a single responsibility — Role Mapper rejects overlapping scopes.

### 4.4 Cross-layer check (Verifier, Phase 6)

The unified Verifier adds one check the two separate commands could not perform: every `.claude/skills/<x>/…` path referenced by a *proposed* agent must exist in the *proposed* skill set. This catches the case where Phase 3 splits a skill and Phase 5 agents reference the old path. The Verifier reads both pipelines' outputs before `ExitPlanMode`.

---

## 5. Frontmatter and permission hardening

### 5.1 Problem

Current `/docs` and `/team` have an `## Allowed Tools` markdown section at the bottom. This is prose — Claude Code does not enforce it. Real enforcement requires YAML frontmatter (per [slash-commands docs](https://code.claude.com/docs/en/slash-commands#frontmatter-reference): "Custom commands have been merged into skills … `allowed-tools` — Tools Claude can use without asking permission when this skill is active"). Auto mode drops the kit's broad allow-list wildcards from `settings.json` and routes shell through the classifier, which surfaces prompts for `rtk find`, `find`, and compound shell.

### 5.2 Frontmatter block

Add this block at the very top of the merged `docs.md`:

```yaml
---
name: docs
description: Use when bootstrapping or auditing a project's .claude/skills/ and .claude/agents/ directories. Covers skill health (CSO descriptions, size limits, staleness, coverage gaps), agent generation from skills, skill-maintenance skill creation, and cross-layer reference validation between agents and skills.
allowed-tools: >-
  Read Grep Glob Task WebFetch WebSearch
  Bash(date) Bash(ls:*) Bash(find:*) Bash(wc:*)
  Bash(git log:*) Bash(git status)
  Bash(rtk:*) Bash(mkdir:*)
  Edit(.claude/skills/**) Edit(.claude/agents/**)
  Write(.claude/skills/**) Write(.claude/agents/**)
---
```

### 5.3 Risk surface analysis

| Rule | What it allows | Why narrow |
|---|---|---|
| `Bash(date)` | Exact command | Narrow by design. |
| `Bash(ls:*)` | Any `ls` | Read-only directory listing. |
| `Bash(find:*)` | Any `find` | Kept because `find` alone (without `-delete`) is read-only; agents are constrained to Glob by §6. |
| `Bash(wc:*)` | Any `wc` | Counts only, no write. |
| `Bash(git log:*)` | Any `git log` | Read-only. |
| `Bash(git status)` | Exact | Read-only. |
| `Bash(rtk:*)` | Any `rtk` subcommand | RTK proxies other commands, inherits their risk. Kit's token-compression hook rewrites most reads through RTK; without this rule, reads prompt. |
| `Bash(mkdir:*)` | Any `mkdir` | Creates directories — cannot destroy data. |
| `Edit(.claude/skills/**)` | Edits inside skills dir | Scoped. Excludes CLAUDE.md and other config. |
| `Edit(.claude/agents/**)` | Edits inside agents dir | Scoped. |
| `Write(.claude/skills/**)` | Writes inside skills dir | Scoped. |
| `Write(.claude/agents/**)` | Writes inside agents dir | Scoped. Backup files (`.bak`) land here too. |

### 5.4 What this frontmatter explicitly does not allow

- `Bash(rm:*)` — removed. No deletion is needed after Migration Mode is gone.
- `Bash(git:*)` — replaced with the two read-only specifics. Prevents agent-hallucinated `git reset --hard` / `git push --force` / `git clean -fdx`.
- `Edit` / `Write` without a path scope — prevents CLAUDE.md edits (Builder's "Do NOT touch CLAUDE.md" rule is now enforced by permission, not by prayer).
- `Bash(cat:*)`, `Bash(grep:*)`, `Bash(head:*)`, `Bash(tail:*)` — agents must use `Read` / `Grep`, which don't prompt at all (per §6).

If an agent legitimately needs something outside this set mid-run, the normal permission prompt fires. That prompt is a useful signal for review, not a bug.

---

## 6. Shell-avoidance constraint

### 6.1 Problem

Per the permissions docs: "Claude Code is aware of shell operators, so a rule like `Bash(safe-cmd *)` won't give it permission to run the command `safe-cmd && other-cmd`. The recognized command separators are `&&`, `||`, `;`, `|`, `|&`, `&`, and newlines. A rule must match each subcommand independently." The user's observed prompt was a `for skill in …; do count=$(find … | wc -l); echo …; done` loop during skill enumeration. Even if every subcommand (`find`, `wc`, `echo`) is in `allowed-tools`, the compound shape (for-loop + command substitution + pipe) means the shell dialog "Contains simple_expansion" fires.

### 6.2 Fix — shared constraint block

Every subagent task block in the merged command (Explorer, Categorizer, Pattern Scanner, Role Mapper, Pattern Extractor, Skills Builder, Agents Builder, Verifier) gets this block injected near the top of its `<task>`. The audit responsibility that `/docs` Manage Mode previously gave to a separate "Auditor" agent is folded into the Categorizer, which evaluates current skills as part of its proposal work:

```
<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>
```

### 6.3 Pattern replacements

| Old shell pattern | New tool call |
|---|---|
| `ls .claude/skills/` | `Glob(".claude/skills/*/SKILL.md")` |
| `find .claude/skills/$s/references -name "*.md" \| wc -l` (per skill) | `Glob(".claude/skills/*/references/*.md")` once, group by path prefix in-agent |
| `for f in *.md; do wc -l "$f"; done` | `Glob` + `Read` each result and count lines |
| `grep -r "pattern" src/` | `Grep(pattern, path="src/")` |
| `cat file.md` | `Read("file.md")` |
| `git log --oneline --since=<date> -- <file>` | kept — no tool equivalent, and the rule allows it |

### 6.4 Enforcement

The constraint is prose, so it relies on the model's adherence. Three reinforcements:

1. It appears at the top of every `<task>` block, under the existing `<constraint>` tags (model adheres to those more than bold markdown per existing kit conventions).
2. The frontmatter's `allowed-tools` does *not* include broad shell (`Bash(for:*)`, `Bash(cat:*)`, `Bash(grep:*)`), so if an agent tries anyway it hits a prompt — making the shell path more expensive than the tool path.
3. The SubagentStop hook already requires `file:line` references in output; agents that skipped structured enumeration often fail that check, creating a secondary feedback loop.

---

## 7. File-by-file changes

### 7.1 `ssot/.claude/commands/docs.md` — rewritten

- Add YAML frontmatter (§5.2).
- Remove Phase 0 `has_context_tree` branches. Keep only: skills count + agents count.
- Delete Migration Mode (`Phase 1G` through `Phase 4G`, ~155 lines).
- Delete the four `AskUserQuestion` branches in Phase 0.
- Delete the three Manage Mode entry-point branches (folded into always-on flow).
- Merge Bootstrap Mode's Phases 1–6 and Manage Mode's Phases 1M–5M into the unified eight-phase structure from §4.2.
- Add Phase 4 (Agents analysis) and Phase 5 (Agents Builder) from `team.md` — updated to read the *proposed* skill set, not only the current one.
- Add shared shell-avoidance constraint (§6.2) to every `<task>` block.
- Add cross-layer reference check to Phase 6 Verifier (§4.4).
- Replace `## Allowed Tools` markdown section with a single line pointing at the frontmatter (`See frontmatter \`allowed-tools\`.`) to preserve discoverability.
- Update title and lead paragraph: "Project Skills & Agents Manager".

### 7.2 `ssot/.claude/commands/team.md` — deleted

Nothing else in the kit imports or references `team.md`. The only cross-reference outside the file itself is `CLAUDE.md:34` (the command table row), updated in §7.3.

### 7.3 `CLAUDE.md` (project root) — updated

- Line 30 (`/docs` row): update the pipeline description to the new 8-phase flow.
- Line 34 (`/team` row): delete.
- Line 36 (parallel phases list): remove `/team`, keep `/docs` (still has parallel phases in Phases 2 and 4).
- No other references to change.

### 7.4 `ssot/.claude/CLAUDE.md` — no change needed

Line 31 already says "Projects may have a `.claude/skills/` directory with Tool Wrapper skills managed by `/docs`." That remains accurate after merge.

### 7.5 `guard-commands.sh` / `score-commands.sh`

No direct changes required by this spec. The merged command still has `<task>` blocks, Success Criteria sections, a Phase Transition Protocol, and a consistent WebFetch shape, so both validators should continue to pass. The implementation plan will run both as verification.

---

## 8. Open follow-ups (not in this spec)

Tracked separately:

1. **Kit-wide frontmatter + shell-avoidance rollout.** Apply §5.2 (narrow frontmatter) and §6.2 (shell-avoidance constraint) to `/security`, `/fix`, `/review`, `/test`, `/human-docs`, `/refactor`, `/solid`. Each command has its own tool needs, so frontmatter must be audited per-command. Separate spec + plan after this merge ships.

2. **Auto-mode classifier tuning.** The kit runs in auto mode by default. Even with pre-approval via `allowed-tools`, the classifier may still review compound commands under auto. The shell-avoidance constraint (§6.2) removes the compound-command surface entirely, which matters more than classifier config. If prompts persist after this merge, consider `autoMode.environment` entries describing the kit's expected command shapes.

3. **Migration path for users with legacy context trees.** Not this repo, but downstream kit users may still have `.claude/context/`. Current plan: the merged command treats them as "no skills" and bootstraps fresh, discarding nothing (the old tree files remain on disk untouched). If this becomes a real issue, a separate `/migrate-context` throwaway command can be added and deleted after rollout.

---

## 9. Acceptance criteria

The implementation is done when:

1. `ssot/.claude/commands/docs.md` is the single entry point; `team.md` no longer exists in the repo.
2. Running `/docs` in a project with no `.claude/skills/` bootstraps skills *and* proposes agents in one plan.
3. Running `/docs` in a project with skills-but-no-agents proposes only the agents delta.
4. Running `/docs` in a project with full skills+agents produces either a no-op plan or a delta plan, never a prompt for mode selection.
5. Running `/docs` in a project with a stale skill (source modified after `metadata.updated`) proposes a refresh.
6. No `AskUserQuestion` calls remain anywhere in the command.
7. `.claude/skills/skill-maintenance/SKILL.md` is always present after the command's implementation phase, whether created fresh or pre-existing.
8. During a full `/docs` run on a non-trivial project, the user sees zero permission prompts for `find`/`for`/`rtk find`/compound shell during exploration. (Any prompt seen is a bug.)
9. `bash guard-commands.sh` and `bash score-commands.sh` pass.
10. `CLAUDE.md:30` reflects the new single-command pipeline; no `/team` row remains in the command table.

---

## 10. Out of scope

- Changes to other kit commands (tracked in §8.1).
- Changes to `settings.json` permissions (frontmatter in the command is the enforcement point).
- Changes to the SubagentStop hook or any other hook.
- Changes to `.claude/agents/` file format itself (only the generator logic is updated).
- Adding new skill-discovery heuristics beyond what's already in Categorizer and Pattern Scanner.
