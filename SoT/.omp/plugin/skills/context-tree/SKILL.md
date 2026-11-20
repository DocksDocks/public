---
name: context-tree
description: "Use when a repo's root AGENTS.md grew too large and per-area conventions should load per folder — scaffolding, auditing, or refreshing nested AGENTS.md nodes per major folder (skills/, scripts/, .github/). Ops: init / audit / refresh folder / refresh all. Not for single-root-context repos, legacy CLAUDE.md migration (use claude-md-migration), generic doc generation, plan workspace setup/refresh (use plan-workspace), or one-shot full repo setup (use agent-first-setup)."
user-invocable: true
metadata:
  pattern: meta-skill
  updated: "2026-11-20"
  content_hash: "32c45cd94305f95ce56e05295dcb4352f5008845faef4bc851b6531d823b6e85"
---

# Context Tree — per-folder AGENTS.md

A *context tree* is a repo where each major folder carries its own `AGENTS.md` (conventions for that area). omp loads context files when a session starts, by an ancestor walk: the `AGENTS.md` in the working directory and in each folder above it, up to the repository root, one project context file per folder depth (omp://context-files.md). omp does not load a node below the working directory, so the agent must open that node itself — the root routing table is how a session finds it. So the **root context file stays sparse**: per-area rules load when the session starts in that area, or when the agent follows the root table to the node. This skill scaffolds, audits, and refreshes that structure. The pattern is canon, not invention — `docs/` already runs it as the plan-record routing node, and it converges with Google's Open Knowledge Format (OKF: markdown + YAML-frontmatter knowledge directories) and Karpathy's LLM-Wiki (schema layer + a Lint maintenance op, which the `audit` graph Lint adapts).

<constraint>
**A node is a single `<folder>/AGENTS.md`. Never write a `CLAUDE.md`.** A legacy CLAUDE.md is any `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` in the project, root or nested. omp keeps one project context file per folder depth (omp://context-files.md). So omp ignores a standalone `CLAUDE.md` next to an `AGENTS.md`, and its content does not reach the agent. A standalone `CLAUDE.md` alone at its depth loads in place of a node. omp reads `.claude/CLAUDE.md` only in the working directory, and there it wins over the `AGENTS.md` of that folder. omp does not load `CLAUDE.local.md` by default. In each case, instructions stay outside AGENTS.md. This skill never edits or deletes a CLAUDE.md: `audit` reports each one, and `claude-md-migration` owns every write to it (migrate the content into AGENTS.md, delete the file).
</constraint>

<constraint>
**One fact, one home — a node is actionable alone.** omp loads a node only when the session starts in its folder or below; in every other session the agent opens the node by hand from the root table, and a task subagent gets no `AGENTS.md` context file at all (omp://context-files.md). So a node must be actionable when it is the only file loaded. It states the rules owned by ITS folder (what an agent needs to edit files there). A fact owned elsewhere (a command defined in another folder, repo-wide policy, generated data) is a pointer: the owning file's repo-root-relative path in backticks, e.g. `scripts/AGENTS.md`. Never restate that fact, and never write "see root" or "refer to the parent" without a path. Use a bare `@path` import only when the target must always be in context: omp expands it inline each time it loads the file, up to five hops. An `@path` inside backticks is a code span, not an import. `audit` reports every bare `@path` outside backticks and fences as `eager-import`. Copy a fact into a second file only when you delete it from the first. A pointer must resolve: a dead pointer is worse than a stale copy.
</constraint>

<constraint>
**Durable facts only.** A node is read as current state, so it never holds a value that changes when code changes: no line numbers (`file.ts:42`), no live counts, versions, sizes, scores, or dates, no "currently" / "as of today" / "now has" / "recently". Write the durable identity (symbol, file name, constant, config key) + the rule that produces the value + `(verify: <command>)` that re-derives it. A stable policy threshold that IS the rule (e.g. "a node is at most 500 lines") is durable in the file that owns the rule. A hand-kept list of things that change is allowed only when it is the single home of that fact AND a check compares it with disk: the root Context-tree routing table qualifies because `audit` checks it against the AGENTS.md files on disk; any other enumeration is an `unchecked-list` finding.
</constraint>

<constraint>
**Intent gate — NOT Plan Mode.** `audit`, `--dry-run`, and an explicit preview/proposal request are read-only and end after the report. An explicit `init`, `refresh`, or "fix the audit findings" request renders the node list and the per-section relocation table; when a canonical plan is warranted, the unified `plan-manager` creates and freshly reviews it first. Then the approval gate applies: print the tables, then ask for approval with the omp `ask` tool. An error, empty, or default result is not approval: print the question, write nothing, and end the turn. Batch all open questions for the gate into one call. A plain-text "Approve? yes/no" in the reply is wrong when the `ask` tool is available. If the session has no `ask` tool (headless or print-mode runs), print the question as the final message and end the turn; do not invent a tool call. Do not write until the user answers; silence is not consent; an ambiguous answer re-shows the tables. After approval, write Phase A. Before Phase B prunes root, show the exact lines to remove and ask again, as a separate question, for the second confirmation. No lifecycle command beyond these two approvals is required. Unclassified sections stay in root; only an explicit user mark makes a row `DROP`.
</constraint>

Prerequisite: the docks-kit kit plugin (`docks-kit-omp`) must be installed. If `plan-workspace` or `plan-manager` is unavailable, STOP, name the missing docks-kit kit plugin, and do not create or mutate a plan.

<constraint>
**No content loss when relocating — per-section, NOT byte-percentage.** A split *adds* scaffolding (node headings, breadcrumbs, `## tree` metadata), so output is normally ≥100% of input — a byte-% floor is the wrong primary check (a lost section hides under added bytes). Instead: (1) inventory every source `^#{1,3}` section before writing; (2) the relocation table accounts for EACH section → a destination or an explicit user `DROP` (unclassified → KEEP in root); (3) relocate verbatim (reformat OK, reword NOT); (4) two-phase write — nodes first + the node check (every AGENTS.md non-empty, ≤500 lines, no CLAUDE.md written), then re-read the source preimage and prune root LAST; (5) the `## Verification` block confirms every source section survives downstream + flags any net shrink. On a miss: stop, restore, locate it — do NOT report success. Full algorithm: [`references/data-preservation.md`](references/data-preservation.md).
</constraint>

## Operations

| Op | What it does | Writes? |
|---|---|---|
| `context-tree init` | First-time scaffold: detect major folders, build the node and relocation tables, run manager review when canonical, stop at the approval gate, write every node, insert the `## Context tree` routing table into root `AGENTS.md`. Idempotent — re-running detects existing nodes and leaves them. | yes |
| `context-tree audit` | Read-only. Report drift: legacy CLAUDE.md files (any `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md`, root or nested — reported and routed to `claude-md-migration`), AGENTS.md claims that no longer match **current source** (every path/snippet/identifier verified by reading — not just file existence), volatile values, duplicated facts, dead pointers, unchecked lists, eager `@path` imports, folders that newly qualify as nodes — plus the graph **Lint**: contradictions between nodes, orphan nodes with no inbound link, concepts mentioned but lacking a node, missing cross-references, web-fillable data gaps. | no |
| `context-tree refresh <folder>` | Regenerate one node from current disk state. First re-derive whether anything SEMANTIC changed in the folder (compare the node's claims against current source, the same check `audit` runs); if nothing did, it's a no-op (no write). | only if changed |
| `context-tree refresh` | Regenerate every node (use when the convention itself changes). Same intent-aware manager handoff and approval gate as `init`. | yes |

## Plan lifecycle handoff

`context-tree` is not a plan operator, but multi-node writing can warrant a canonical plan. Keep `audit`, dry runs, and preview-only requests read-only. For an explicit `init`, full `refresh`, or "fix the audit findings" request, route missing-workspace bootstrap to `plan-workspace`; the unified `plan-manager` owns any canonical-plan creation, fresh review, start checkpoint, lifecycle, and finish/archive. The manager review comes before the approval gate; it does not replace it. After the user approves the tables, write without a new lifecycle command; stop again only for the Phase B confirmation, an unresolved section destination, an explicit `DROP`, a concurrent change, or a verification failure. Never edit or delete a CLAUDE.md here — route every one to `claude-md-migration`.

## What counts as a node

A folder earns a node when it has **its own conventions a reader needs before editing there** — distinct authoring rules, a distinct change axis, or tooling local to that folder. Trivial folders (a dir of leaf files with no local rules) do not. Full heuristics + the skip-list: [`references/major-folder-heuristics.md`](references/major-folder-heuristics.md).

## The node (the core pattern)

```text
plugins/docks/skills/
└── AGENTS.md      # the conventions for authoring skills in this folder
```

No sibling file. omp loads it at session start when the session starts in `plugins/docks/skills/` or below; otherwise the agent opens it from the root table.

The AGENTS.md skeleton (sections, the pre-write checklist, optional `tree:` metadata) is in [`references/node-template.md`](references/node-template.md).

## BAD / GOOD — node content

```markdown
<!-- BAD — pathless pointer, a copied fact, and a volatile value -->
# skills/ conventions
For authoring rules, see root.
Validate with `node scripts/validate.mjs --strict` (copied from scripts/).
The folder currently holds 42 skills.

<!-- GOOD — states the folder's own rules; points at facts owned elsewhere -->
# Authoring skills (plugins/docks/skills/)
Frontmatter: name matches dir, description starts "Use when…", ≤1024 chars.
Body ≤500 lines (sweet spot 80–310).
Validation commands: owned by `scripts/AGENTS.md`.
Skill count (verify: `find plugins/docks/skills -name SKILL.md | wc -l`).
```

**Durable anchors — how a node references code.** Nodes are long-lived: a bare `path:42`
line anchor rots on the next edit above it and then misleads. Anchor by
`` `path` — `symbol/config key` — purpose (verify: `command`) ``. For a volatile fact
(count, floor, version), never write the value: write its identity, the rule that produces
it, and the `verify:` command that re-derives it. Line numbers survive only in
clearly-fictional teaching examples. Each emitted node carries one stale-tolerance line:
"Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated
purpose and re-locate it (grep the symbol) before acting."

**Behavior claims need an exercising cue.** "Guard X enforces Y" / "Z is automated" is the
drift that hides longest: the tool exists, runs, and passes while doing less than the
sentence says. Its cue must EXERCISE the behavior — a should-fail probe ("add a violating
line → the guard run must fail naming it; revert"), never an existence check. A behavior
claim with no probe is not written into a node.

```markdown
<!-- BAD — a CLAUDE.md next to the node: omp keeps one file per depth and ignores it, so its content does not reach the agent -->
scripts/AGENTS.md
scripts/CLAUDE.md          (contains: "Run the linter before commit.")

<!-- GOOD — the node alone; omp loads it by the ancestor walk -->
scripts/AGENTS.md
```

## Workflow — `context-tree init`

1. **Acknowledge state.** Note whether a root `AGENTS.md` exists, whether any nested nodes already exist (e.g. `docs/`), and list every legacy CLAUDE.md (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, root or nested). Never clobber an existing node — detect and preserve it. Never edit or delete a CLAUDE.md here: route every one to `claude-md-migration`. A new node next to a standalone `CLAUDE.md` makes omp ignore that file, and a `.claude/CLAUDE.md` wins over the node of the session folder, so `init` stops until `claude-md-migration` migrates every `CLAUDE.md` and `.claude/CLAUDE.md`. omp does not load `CLAUDE.local.md` by default: report it and continue.
2. **Detect candidates.** Apply the heuristics (`references/major-folder-heuristics.md`) to enumerate major folders. Exclude already-existing nodes from the write set.
3. **Inventory + propose (per-section).** Copy the root `AGENTS.md` and every existing node the run will change into the backup directory outside the repo (`references/data-preservation.md` step 1), and list every source `^#{1,3}` section. Render TWO tables: (a) node list — `folder | new? | sources | one-line summary`; (b) **relocation table — `Section | Destination | Reason`** covering EVERY root section; unclassified → `KEEP in root` (only an explicit user instruction may mark a row `DROP`). A `--dry-run` or preview-only request stops here after also printing the post-prune root preview + each node preview. For an implementation request, resolve only genuine open decisions and route the complete proposal through `plan-manager` when canonical. Then print the tables and ask for approval with the omp `ask` tool (the approval gate; fallback in the Intent gate). Write nothing until the user answers.
4. **Phase A — write nodes (root untouched).** For each approved folder: write `<folder>/AGENTS.md` (actionable alone, sections relocated **verbatim** per the table). Never write a `CLAUDE.md`. Confirm each `AGENTS.md` is non-empty and ≤500 lines. Root is still fully intact — a halt here leaves duplication (recoverable), never loss.
5. **Phase B — prune root after preimage verification.** Re-read the root and verify it still matches the backed-up preimage, show the exact lines assigned to written nodes, and confirm those sections are present there. Then ask for the second confirmation as a new `ask` call (same fallback); delete them from root only after the user confirms. Never delete a section whose content you cannot point to in an already-written node.
6. **Root section.** Insert/update the `## Context tree` routing table in root `AGENTS.md`: one row per node, first cell `` `<folder>/AGENTS.md` `` (see `references/node-template.md`).
7. **Verify (fail loud).** Run the `## Verification` block below (per-section presence + net-shrink tripwire), then re-confirm each node is well-formed, confirm every node on disk has a row in the root table, and run the project's own checks (lint / tests / CI), if it has any. Any `LOST SECTION` / `NET SHRINK` line ⇒ restore from the backup and do NOT report success.

## Workflow — `refresh` / `audit`

- `audit` first lists every legacy CLAUDE.md (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, root or nested) as a `legacy-claude-md` finding, with its omp effect: a standalone `CLAUDE.md` next to an `AGENTS.md` is ignored; a standalone `CLAUDE.md` alone at its depth loads in place of a node; a `.claude/CLAUDE.md` wins over the `AGENTS.md` of its folder when the session starts there; a `CLAUDE.local.md` does not load by default. The fix owner is `claude-md-migration`; `audit` and `refresh` never edit or delete a CLAUDE.md. Then `audit` walks tracked nodes and verifies every source-anchored claim (path, symbol, snippet, identifier, and any live `path:NN` line anchor, which is itself a `line-anchor` finding: convert to the durable form, don't just re-point the number) against **current source** — content, not just existence — re-derived from disk and ignoring git history; it reports drift with the count of claims checked, and never writes. The same pass reports the durable-docs findings, each with its fix: `volatile-value` (a line number, live count/version/size/date, or "currently" / "now has" — replace with identity + rule + `verify:` command), `duplicated-fact` (a fact restated from its owning file — replace with a backticked path to the owner), `dead-pointer` (a backticked repo path that does not resolve — re-locate the owner by its stated purpose and fix the path, or cut the pointer), `unchecked-list` (a hand-kept enumeration of changing things with no check against disk — replace with the rule + the `find`/`grep` command that lists them), `eager-import` (a bare `@path` outside backticks and fences in any AGENTS.md, root included — omp expands that file into every session that loads the AGENTS.md; put it in backticks unless the target must always be in context). After the per-claim pass it runs the cross-node **graph Lint**: contradictions between nodes (two nodes asserting incompatible rules), orphan nodes with no inbound link (unreferenced by the root `## Context tree` table or any sibling), concepts mentioned but lacking a node, missing cross-references, and web-fillable data gaps. Full procedure: [`references/conflict-resolution.md`](references/conflict-resolution.md). Use it to decide whether a `refresh` is warranted.
- `refresh <folder>` regenerates one node only if the maintainer's content predicate says something semantic changed (avoids nudge write-loops). `refresh` (no arg) re-runs the full convention across every node behind the intent-aware manager handoff.

Drift handling, existing-file merges, and the already-a-node detection live in [`references/conflict-resolution.md`](references/conflict-resolution.md).

## Verification (run after any relocation — fail loud)

```bash
# Step 3 copied the original root into the backup directory:  SOURCE_BEFORE="$BACKUP/AGENTS.md"
# 1. per-section presence — every original section must survive somewhere downstream.
# Strip the leading #s so a promoted/demoted heading (### → ##) still matches.
grep -E '^#{1,3} ' "$SOURCE_BEFORE" | sed -E 's/^#{1,3} +//' | while IFS= read -r h; do
  grep -rqF "$h" <written-nodes> AGENTS.md || echo "LOST SECTION: $h"
done
# 2. net-shrink tripwire — a split ADDS scaffolding, so total should be >= original
before=$(wc -c < "$SOURCE_BEFORE")
after=$(cat AGENTS.md <every-written-node> | wc -c)
awk -v b="$before" -v a="$after" 'BEGIN{ if (a < b) print "NET SHRINK — a section was dropped, investigate" }'
```

Any `LOST SECTION` / `NET SHRINK` line ⇒ restore root from `"$SOURCE_BEFORE"`, locate the content; never report the tree complete with an open miss. This per-section check (not a byte-% floor) is the safeguard every content-transforming skill must carry.

## Gotchas

| Gotcha | Fix |
|---|---|
| Wrote a `CLAUDE.md` next to a node | omp keeps one context file per folder depth and ignores a standalone CLAUDE.md next to an AGENTS.md, so its content does not reach the agent. Never write one; route its removal to `claude-md-migration`. |
| Legacy `CLAUDE.md` or `.claude/CLAUDE.md` holds instructions | Instructions outside AGENTS.md: omp ignores the file next to an AGENTS.md, or loads it in place of the node. Do not edit or delete it here. Root or nested → `claude-md-migration` (it migrates the content into AGENTS.md and deletes the file). |
| Root table row is a bare `@scripts/AGENTS.md` | `eager-import`: omp expands that node into every session that loads the root AGENTS.md. Write the row as `` `scripts/AGENTS.md` `` (an `@` inside the backticks is tolerated). |
| Node says "see root for the full rules" | Pathless pointer. State the folder's own rules in the node; for a fact owned elsewhere, name the owning file as a backticked path. |
| Node restates a command or policy owned by another file | `duplicated-fact`. Replace the copy with the owner's backticked path; one fact, one home. |
| Node writes "currently 12 validators" or "v2.3" | `volatile-value`. Write the identity + rule + `verify:` command, never the value. |
| Node keeps a hand list of files, skills, or nodes | `unchecked-list`, unless a check compares it with disk (the root Context-tree table is checked by `audit`). Replace with the rule + the command that lists them. |
| `init` tried to clobber `docs/AGENTS.md` | Detect existing nodes first and exclude them; route setup or refresh of `docs/AGENTS.md` + `docs/PLAN.md` to `plan-workspace`. |
| Fixed a multi-node audit directly without a reviewed handoff | Risks unbound relocation and root pruning. Route the implementation request through unified `plan-manager`, then stop at the approval gate before any write. |
| Relocated a section into a node but left it in root too | Duplicated context loads twice. Delete from root when you move it; leave only a breadcrumb. |
| Pruned a section from root before it was written to a node | Content lost. Two-phase only: write nodes (Phase A) + the node check, prune root LAST (Phase B). |
| Used a byte-% "didn't shrink more than X%" as the loss check | Backwards for a split — scaffolding inflates output. Use per-section presence; byte-delta is only a net-shrink tripwire. |
| The nudge leads to `refresh` after every edit, and `refresh` rewrites unchanged nodes | `refresh <folder>` must first re-derive whether anything semantic changed and no-op when nothing did. |
| `audit` passed a node as "no drift" on a file-exists check | Existence ≠ accuracy — a renamed validator or changed rule sails through. `audit` verifies every claim's content against current source and states the count checked. |
| Node cites a live `path:NN` line anchor | It rots on the next edit. Convert to the durable form — `` `path` — `symbol` — purpose (verify: `command`) `` — and keep line numbers only on fictional example paths. |
| AGENTS.md grew past 500 lines | Past the node-body ceiling (kit policy, enforced by the kit's checks). Split the folder or tighten to keep every node ≤500 lines. |

## When NOT to use

- A small repo with one root context file that fits comfortably — a tree adds indirection with no payoff.
- Plan workspace setup or refresh for `docs/AGENTS.md` + `docs/PLAN.md` — use `plan-workspace`; context-tree `init` detects the existing `docs/` node and leaves it.
- Generating generic docs/READMEs — this skill only manages the nested AGENTS.md node convention.
- Rewriting a consumer project's non-conforming AGENTS.md — `audit` surfaces them; it does not auto-rewrite.

## References

- [`references/major-folder-heuristics.md`](references/major-folder-heuristics.md) — what qualifies as a node, detection rules, the skip-list.
- [`references/node-template.md`](references/node-template.md) — the AGENTS.md skeleton, the root `## Context tree` routing table, the pre-write checklist.
- [`references/conflict-resolution.md`](references/conflict-resolution.md) — existing-file detection, drift/audit logic, merge-vs-overwrite, no-op refresh.
- [`references/data-preservation.md`](references/data-preservation.md) — the section-inventory algorithm, per-section relocation table, two-phase write, and the verbatim verification snippet (self-contained; references stay one level deep).
- Companion: `plan-manager` (create, review, execute, and finish a durable plan) · `skill-maintenance` (the update-only-when-meaning-changed discipline the refresh op mirrors) · `claude-md-migration` (owns every legacy CLAUDE.md write: migrate and delete; same split discipline).

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks-kit repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
