# Node template — the AGENTS.md node + the root section

## One file per node

A node is `<folder>/AGENTS.md` and nothing else. Do not write a `CLAUDE.md` beside it. omp loads context files when a session starts, by an ancestor walk: the AGENTS.md in the working directory and in each folder above it, up to the repository root, one project context file per folder depth (omp://context-files.md). omp does not load a node below the working directory, so the agent must open it from the root routing table. omp ignores a standalone CLAUDE.md next to an AGENTS.md, and a `.claude/CLAUDE.md` in the working directory wins over the AGENTS.md of that folder. `audit` reports every legacy CLAUDE.md and routes it to `claude-md-migration`; context-tree never edits or deletes one.

## AGENTS.md skeleton

```markdown
# <Folder purpose> (<relative/path/>)

<One paragraph: what lives here and the one thing a reader must know before
editing.>

## Conventions
<The rules owned by this folder, stated in full. Tables and BAD/GOOD beat
prose. Anchor code by `path` — `symbol` — purpose (verify: `command`), never
by bare `path:NN` line numbers. For a volatile fact (count, version, size,
date), never write the value: write the identity + the rule that produces it
+ (verify: `command`).>

## Owned elsewhere
<One line per fact this folder depends on but does not own: what it is + the
owning file as a repo-root-relative backticked path, e.g.
"Validation commands: `scripts/AGENTS.md`". Never copy the fact.>

## Gotchas
<Concrete corrections specific to this folder, if any.>

Pointers here name concepts, not coordinates — if a path or symbol moved,
trust the stated purpose and re-locate it (grep the symbol) before acting.

<!-- machine-readable drift aid — `audit` reads `sources:` to scope its content check -->
## tree (metadata)
- sources: <every file this node's claims cite — `audit` pre-filters on this list>
```

Keep it ≤500 lines (kit policy, enforced by the kit's checks; distinct from the SKILL.md 310 sweet spot). If it grows past that, the folder probably needs to split.

## Pre-write checklist (run before writing each node)

- [ ] Every rule owned by this folder is stated in THIS file (actionable when it is the only file loaded)
- [ ] Every fact owned elsewhere is a backticked repo-root-relative path, not a copy (no `duplicated-fact`)
- [ ] No "see root", "refer to parent", or "as described elsewhere" without a path; every backticked path resolves (no `dead-pointer`)
- [ ] No volatile value: no line number, live count, version, size, score, or date, no "currently" / "now has" / "recently" — identity + rule + `verify:` command instead (no `volatile-value`)
- [ ] No hand-kept list of things that change unless a check compares it with disk (no `unchecked-list`)
- [ ] No live `path:NN` line anchors — durable anchors only; the stale-tolerance line is present
- [ ] Every "X enforces/automates/blocks Y" claim carries a cue that EXERCISES the behavior (should-fail probe), not an existence check — or the claim is cut
- [ ] Reads correctly if it's the ONLY context file loaded (the agent opened it from the root table, or a task subagent read it)
- [ ] No `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` in this folder or above it (each keeps instructions outside AGENTS.md; report it for `claude-md-migration`)
- [ ] AGENTS.md ≤500 lines
- [ ] `## tree` `sources:` lists every file this node's claims cite (so `audit` can verify them)

## Root "Context tree" section

Insert into the root `AGENTS.md`:

```markdown
## Context tree

Per-folder conventions live in nested `AGENTS.md` nodes. omp loads the nodes
from the working directory up to the root when a session starts, so open the
node for the folder you edit from this table. Do not add CLAUDE.md files: omp
ignores a CLAUDE.md next to an AGENTS.md. Edit the node, not this list, when a
folder's rules change. `context-tree audit` checks this table against the
AGENTS.md files on disk.

| Node | Governs |
|---|---|
| `<folder>/AGENTS.md` | <one-line purpose> |
```

This table is the one allowed hand-kept list: it is the single home of the routing fact, and `audit` compares it with disk (a node missing from the table is an orphan; a row whose path does not exist is a `dead-pointer`). Row rule, shared by every checker in the kit: a routed node is a table row, under any heading, whose first cell is the node path in backticks — `` `<folder>/AGENTS.md` ``. An `@` inside the backticks (`` `@<folder>/AGENTS.md` ``) is tolerated: a code span is not imported; checkers strip it. Never write a bare `@<folder>/AGENTS.md` outside backticks: that is an eager import, and omp expands the node into every session that loads the root AGENTS.md (`audit` reports it as `eager-import`). Fill the table from `find . \( -path ./.git -o -path '*/node_modules' \) -prune -o -name AGENTS.md -print` (every hit except `./AGENTS.md` is a node). Each row is a pointer only; the rules live in the node, so the root stays sparse.

## Per-section relocation table (the approval gate)

Alongside the node list, the gate shows a row for EVERY root `^#{1,3}` section so nothing moves (or drops) unseen. Full rules: [`data-preservation.md`](data-preservation.md).

```markdown
| Section (root heading)   | Destination                    | Reason                          |
|--------------------------|--------------------------------|---------------------------------|
| ## Authoring skills      | plugins/docks/skills/AGENTS.md | folder-local authoring rules    |
| ## CI triggers           | .github/AGENTS.md              | CI config change axis           |
| ## Repository purpose    | KEEP in root                   | cross-cutting; not folder-local |
| ## Legacy notes          | DROP (user-confirmed)          | obsolete                        |
```

Unclassified → `KEEP in root` (default safe). `DROP` only on an explicit user mark.
