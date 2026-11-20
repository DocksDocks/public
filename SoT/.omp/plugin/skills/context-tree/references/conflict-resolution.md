# Conflict resolution — existing files, drift, no-op refresh

## Contents

- [Existing-node detection](#existing-node-detection-run-first-always) · [Legacy CLAUDE.md](#legacy-claudemd-report-and-route) · [Merge vs overwrite](#merge-vs-overwrite) · [Per-section relocation](#per-section-relocation-init--full-refresh)
- [Drift detection (`audit`)](#drift-detection-audit--content-accuracy-not-existence) — checkable claims, per-claim verdicts, durable-docs findings, [Graph Lint](#graph-lint-cross-node-health--after-the-per-claim-pass), pre-filter
- [No-op refresh (nudge safety)](#no-op-refresh-nudge-safety)

## Existing-node detection (run first, always)

Before writing anything, find folders that already have a node:

```bash
# a folder is an existing node when it has an AGENTS.md
test -f <folder>/AGENTS.md
```

Existing nodes are PRESERVED by `init` — never clobbered. `docs/` is the canonical subsystem example: `init` detects it and excludes it from the write set. Only an explicit `refresh <folder>` touches an existing node; route setup or refresh of `docs/AGENTS.md` + `docs/PLAN.md` to `plan-workspace`.

## Legacy CLAUDE.md (report and route)

A legacy CLAUDE.md is any `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` in the project, root or nested. omp keeps one project context file per folder depth (omp://context-files.md), so each one keeps instructions outside AGENTS.md. Never write one. `audit` reports each as `legacy-claude-md`. context-tree never edits or deletes a CLAUDE.md: `claude-md-migration` owns every write to it.

```bash
find . \( -path ./.git -o -path '*/node_modules' -o -path '*/vendor' \) -prune -o \( -name CLAUDE.md -o -name CLAUDE.local.md \) -print |
while IFS= read -r f; do   # -name CLAUDE.md also matches .claude/CLAUDE.md
  case "$f" in
    */CLAUDE.local.md) k='not loaded by default (report only)' ;;
    */.claude/CLAUDE.md) k='wins over the folder AGENTS.md when the session starts there' ;;
    *) if [ -f "$(dirname "$f")/AGENTS.md" ]; then k='ignored next to AGENTS.md'; else k='loads in place of a node'; fi ;;
  esac
  echo "legacy-claude-md: $f — $k"
done
```

| Found | omp effect | Fix |
|---|---|---|
| Standalone `CLAUDE.md` next to an `AGENTS.md` | Ignored: one file per depth, so its content does not reach the agent | Route to `claude-md-migration`. `init` stops until it is migrated. |
| Standalone `CLAUDE.md` with no `AGENTS.md` next to it | Loads in place of a node | Route to `claude-md-migration`. `init` stops until it is migrated. |
| `.claude/CLAUDE.md` | Loads only when the session starts in its parent folder, and then wins over the `AGENTS.md` of that folder; not loaded from any other folder | Route to `claude-md-migration`. `init` stops until it is migrated. |
| `CLAUDE.local.md` | Not loaded by default | Report it for `claude-md-migration`; `init` continues. |

## Merge vs overwrite

When `refresh` targets a node that already has hand-written content:

- **Preserve** human-authored rules — `refresh` updates machine-derived parts (the `tree:` metadata, drift-corrected claims), not the prose a person wrote. Treat the existing AGENTS.md as the base; surface proposed changes as a diff at the approval gate.
- **Never** silently overwrite a node whose content diverged intentionally.

## Per-section relocation (init / full refresh)

When content moves *out of* the root into nodes, route it **per section**, not per folder. Full algorithm + verification: [`data-preservation.md`](data-preservation.md). Classification rules:

| Root section looks like | Route to |
|---|---|
| Folder-local authoring/tooling rules (matches one node's scope) | that node's `AGENTS.md` (verbatim) |
| Cross-cutting / repo-wide (purpose, security, tool-agnostic rules) | KEEP in root |
| Obsolete, user-confirmed | `DROP` (explicit only) |
| Can't confidently classify | **KEEP in root** (default safe — never silently move) |

MIXED sections (part folder-local, part cross-cutting) split paragraph-by-paragraph; the unclassified remainder stays in root. The relocation table at the gate must list every `^#{1,3}` root section — no section is left unaccounted. Prune root only in Phase B, after nodes are written and the node check passes (every AGENTS.md non-empty and ≤500 lines, no CLAUDE.md written — via the project's validators when it has them).

## Drift detection (`audit`) — content-accuracy, not existence

`audit` verifies that each node's **source-anchored claims still match current source**, re-derived from disk. Existence is not accuracy: a path can resolve while the node describes it wrongly, and a renamed validator or a changed scoring rule sails through a file-exists check untouched. Read-only — report drift, never auto-fix; the user decides whether to `refresh`.

<constraint>
Vertical accuracy, not horizontal change. The node's git history proves only that text changed — never that it matches source. Ignore both here; open and read the cited source for every claim. Re-derive from disk as it is now: pre-baseline drift (a claim already wrong before the last refresh) is invisible to any date- or diff-based check.
</constraint>

<constraint>
No node may be reported drift-free without stating how many claims were opened and verified — a "no drift" verdict with zero claims checked is a fail, not a pass. Reproduce every drift finding against the cited source before recording it; drop any you cannot reproduce, with a reason.
</constraint>

### What counts as a checkable claim

| Claim type | Example in a node | Verify by |
|---|---|---|
| path / file:line ref | `` `src/db.ts:42` ``, `` `Makefile:18` `` | read it; confirm it says what the node asserts — not just that it resolves. A live `path:NN` whose path exists is ALSO a `line-anchor` finding in its own right (see verdicts) even when accurate today |
| durable anchor | `` `path` — `symbol` — purpose (verify: `cmd`) `` | grep the symbol (defined, matching purpose) and RUN the `verify:` command — confirm it re-derives the stated fact |
| behavior claim | "guard X enforces Y", "CI validates Z", "W is automated" | EXERCISE it — feed the tool an input it claims to reject/handle and confirm it actually does (a should-fail probe); existence/green-run proves nothing about coverage. No probe possible → flag the claim itself |
| code / command snippet | a fenced `bash`/`md` block, a CLI invocation | grep or run it; confirm it still appears / still works |
| named identifier | a validator, script target, env var, config key, function | grep the symbol; confirm it is DEFINED, not merely named |
| policy threshold | "a node is at most 500 lines" | confirm this node owns the rule or points at the file that enforces it; a bare live count or version is a `volatile-value` finding, not a claim to re-verify |
| backticked repo path (pointer) | `` `scripts/AGENTS.md` `` | resolve it from the repo root (`test -e <path>`); confirm the target owns the fact the pointer names. Unresolved → `dead-pointer` |
| hand-kept list | a list of files, skills, nodes, or tables | find the check that compares it with disk; none → `unchecked-list`. The root Context-tree table is checked by the orphan-node and coverage checks below |
| coverage | a new file/folder the node's rules don't mention | flag as a coverage gap (candidate `refresh`) |

Soft prose (rationale, "prefer X" advice) has no source anchor — mark it `unverifiable`, never drift.

### Verdict per claim

`confirmed` · `broken-ref` (path/line gone) · `stale-snippet` (snippet/command drifted) · `fictional-identifier` (named thing not defined) · `drifted-claim` (threshold/behaviour wrong) · `legacy-claude-md` (a `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.local.md` exists in the repo; its omp effect is in "Legacy CLAUDE.md" above; fix owner = `claude-md-migration`) · `line-anchor` (live `path:NN` in the node — even if accurate today it rots on the next edit; fix = convert to the durable `` `path` — `symbol` — purpose (verify: `cmd`) `` form, never just re-point the number; fictional example paths exempt) · `volatile-value` · `duplicated-fact` · `dead-pointer` · `unchecked-list` · `eager-import` (see the durable-docs table below) · `unverifiable`. A node is **CLEAN** only at zero drift AND a non-zero stated claim count; otherwise report it as a `refresh` candidate with its top finding.

### Durable-docs findings

A node is read as current state. These findings apply even when the text is accurate today, because it stops being accurate without any edit to the node. Fenced blocks that teach a BAD example are exempt.

| Finding | Detect | Fix |
|---|---|---|
| `volatile-value` | a line number (`path:NN`), a live count, version, size, score, or date, or "currently" / "as of today" / "now has" / "recently" | delete the value; write the durable identity (symbol, file, config key) + the rule that produces the value + `(verify: <command>)` that re-derives it |
| `duplicated-fact` | a fact restated from the file that owns it (a command defined in another folder, repo-wide policy, generated data) | replace the copy with the owner's repo-root-relative path in backticks; keep the fact only in its owning file |
| `dead-pointer` | a backticked repo path that resolves neither from the node's own folder nor from the repo root, or a "see root" / "see parent" with no path. A path that names a location in another project (consumer repo, upstream) is not a pointer | re-locate the owner by the pointer's stated purpose (grep the symbol) and fix the path; if no owner exists, state the rule in the node or cut the pointer |
| `unchecked-list` | a hand-kept enumeration of things that change, with no check that compares it with disk | replace with the rule + the `find`/`grep` command that lists them; keep a list only when it is the single home of the fact AND a check compares it with disk (the root Context-tree table, checked by `audit`) |
| `line-anchor` | a live `path:NN` anchor | convert to `` `path` — `symbol` — purpose (verify: `cmd`) ``; never re-point the number |
| `legacy-claude-md` | any `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.local.md` in the repo (classifier in "Legacy CLAUDE.md" above) | route to `claude-md-migration`; context-tree never edits or deletes it |
| `eager-import` | a bare `@path` outside backticks and fences in any AGENTS.md, root included (omp expands it inline each time it loads the file, up to five hops). An `@` inside backticks is a code span, not an import. Detect with the snippet below | put the path in backticks; keep a bare import only when the target must always be in context, and say why |

```bash
# eager-import: bare @path outside fences and code spans, in every AGENTS.md
find . \( -path ./.git -o -path '*/node_modules' \) -prune -o -name AGENTS.md -print | while IFS= read -r f; do
  awk '/^[[:space:]]*```/{x=!x; next} x{next} {t=$0; gsub(/`[^`]*`/, "", t); if (t ~ /(^|[[:space:](])@[^[:space:]]*[.\/]/) print "eager-import: " FILENAME ":" NR}' "$f"
done
```

### Graph Lint (cross-node health — after the per-claim pass)

The per-claim checks above judge one node at a time; these five judge the tree as a graph. Same rules apply: read-only, report findings, never auto-fix. (Checklist adapted from the Lint op in Karpathy's LLM Wiki: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f.)

| Lint check | Verify by |
|---|---|
| Contradictions between nodes | Compare rules that govern the same file/tool/threshold across nodes AND the root; two nodes giving incompatible instructions for the same case is a finding, whichever is "right" |
| Orphan node — no inbound link | A node missing from the root `## Context tree` table and unreferenced by any sibling node; omp still loads it when a session starts in its folder, but it is invisible to a reader navigating from the root, and a session started at the root may never open it. The reverse — a table row whose path does not exist — is a `dead-pointer`. Row rule (the same in every kit checker): a table row under any heading whose first cell matches `` `@?<path>AGENTS.md` ``; strip the leading `@`. Check with the snippet below this table |
| Concept mentioned but lacking a node | A folder/subsystem repeatedly named across nodes (or in root) that qualifies as a node under "What counts as a node" yet has no node |
| Missing cross-references | Node A depends on a convention owned by node B without naming B's path; the `refresh` fix is a backticked pointer to B. If A restates the convention, that is also a `duplicated-fact` |
| Web-fillable data gap | A claim that needs an external fact the repo cannot supply (a version, an upstream URL, a spec value) left vague where a source could pin it |

```bash
grep -E '^\|[[:space:]]*`@?[^`]*AGENTS\.md`' AGENTS.md | sed -E 's/^\|[[:space:]]*`@?([^`]*)`.*/\1/' | sort -u > /tmp/ct.routed
find . \( -path ./.git -o -path '*/node_modules' \) -prune -o -name AGENTS.md -print | sed 's|^\./||' | grep -vx AGENTS.md | sort > /tmp/ct.disk
comm -13 /tmp/ct.routed /tmp/ct.disk | sed 's/^/orphan-node: /'
comm -23 /tmp/ct.routed /tmp/ct.disk | sed 's/^/dead-pointer: /'
```

Output: append the graph findings to the per-node report as `graph: <check> — <finding>` lines; each is a `refresh` candidate (or a root `## Context tree` table fix), decided by the user.

### Pre-filter (cheap, not authoritative)

Scope the read with the node's `## tree` `sources:` list (the files its claims cite); the git delta since the node's last commit (`git log -1 --format=%H -- <folder>/AGENTS.md`) narrows where to look first. Neither substitutes for opening every claim — they only order the work.

Output per node: `claims checked | confirmed | broken-ref | stale-snippet | fictional-identifier | drifted-claim | volatile-value | duplicated-fact | dead-pointer | unchecked-list | line-anchor | eager-import | verdict`, plus a dropped-on-failed-reproduction list. Report drift; do not auto-fix in `audit`. The user decides whether to `refresh`.

## No-op refresh (nudge safety)

The docks `context-tree-nudge` omp extension nudges the agent (via added context) to run `refresh <folder>` after every edit inside a node — it never invokes refresh itself. `refresh` MUST therefore be a no-op when nothing semantic changed, or the nudge-refresh cycle write-loops. Reuse the `skill-maintenance` update-only-when-meaning-changed pattern:

```bash
# only rewrite when the derived content actually differs from disk
new=$(render_node <folder>)
old=$(cat <folder>/AGENTS.md 2>/dev/null)
[ "$new" = "$old" ] && exit 0   # no write, no churn
```

This mirrors the skill-maintenance idempotency pattern: compute the would-be content, compare to disk, write only on a real difference.
