# Major-folder heuristics — what earns a node

A folder earns an `AGENTS.md` node when a reader needs local rules *before* editing there. A folder qualifies if it hits ANY "qualifies" row and no hard skip.

## Qualifies (any one)

| Signal | Example |
|---|---|
| Distinct authoring convention | `plugins/docks/skills/` — frontmatter + scoring rules unique to skills |
| Distinct change axis / stakeholder | `.github/` — CI config; changes for different reasons than source |
| Local tooling a reader must know | `scripts/` — validators with their own invocation contract |
| A subsystem with its own contract | `docs/` — plan-record routing and issue-body contract |
| ≥ ~5 files sharing a non-obvious rule | a module dir whose files must all follow one pattern |

## Hard skips (never a node)

| Skip | Why |
|---|---|
| The repo root | That's the root context file, not a node |
| A dir of leaf files with no local rules | Nothing to say that root doesn't already cover |
| Build output / `node_modules` / `dist` / `.git` | Generated or vendored |
| A dir that only re-exports / barrels | No conventions of its own |
| `_assets/`, fixture/data dirs | Data, not rules |
| A folder whose only rule is "see parent" | It owns no rules, so it has nothing to state; it isn't a node |
| A subtree already governed by a parent node that states its rules | Prefer one node per major folder; keep child routing in the parent |
| A folder whose tooling lints every `*.md` in it | An `AGENTS.md` there fails that lint (e.g. a plugin `agents/` folder, where a strict plugin validator parses every `*.md` as a subagent). Keep those authoring rules in the nearest parent node |

## Depth rule

Prefer ONE node per major folder, not one per subfolder. Roll child conventions up into the parent's AGENTS.md until two children genuinely diverge on rules — then split. Example: one `plugins/docks/skills/AGENTS.md` covers all categories until `engineering/` and `productivity/` need different authoring rules.

## Detection procedure

1. List top-level dirs and one level down (`find . -maxdepth 2 -type d`, excluding `.git`, `node_modules`, build output).
2. For each, check the "qualifies" table. Note the source files that drive the convention — they become the node's evidence (and the `tree: sources` line).
3. Drop anything matching a hard skip.
4. Mark folders that already have an AGENTS.md as EXISTING — detected, not rewritten (unless `refresh` targets them). See `conflict-resolution.md`.
5. The remainder is the proposed node set for the approval gate.

## Existing nodes

Do not keep a hand list of a repo's nodes; it drifts as folders land. List them from disk:

```bash
find . -name AGENTS.md -not -path "*/node_modules/*" -not -path "./AGENTS.md"   # every hit is a node
```

Before you scaffold a node, check whether a tool lints every markdown file in that folder (see the hard-skip table). Run that tool on a scratch `AGENTS.md` in the folder; if it fails, the folder cannot host a node.
