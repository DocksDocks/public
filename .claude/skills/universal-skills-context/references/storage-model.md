# Universal Skills Storage Model

## Critical Constraint

Two-agent form (`-a claude-code codex`) is REQUIRED to produce the canonical `~/.agents/skills/` path + symlink. Single-agent form copy-directs into the tool's own directory and skips the canonical path. (lib/skills.sh:11-13 comment)

## Path Layout

```
~/.agents/
├── skills/
│   └── agent-browser/       ← canonical (universal path; Codex reads natively)
│       ├── SKILL.md
│       └── references/
└── .kit-managed-skills      ← snapshot file (one slug per line, sorted)

~/.claude/
└── skills/
    └── agent-browser        ← SYMLINK → ../../.agents/skills/agent-browser
```

## Two-Agent vs Single-Agent Install

| Invocation | Canonical `~/.agents/skills/<n>/` | `~/.claude/skills/<n>` | Codex coverage |
|-----------|----------------------------------|----------------------|----------------|
| `-a claude-code codex` | Created | Symlink to canonical | Yes (reads `~/.agents/skills/`) |
| `-a claude-code` only | NOT created (copy-direct) | Real copy in `~/.claude/skills/` | No |
| `-a codex` only | NOT created (copy-direct) | Not created | Yes, but Claude Code uncovered |

## Symlink Target

```
~/.claude/skills/agent-browser → ../../.agents/skills/agent-browser
```

Relative path: two levels up from `~/.claude/skills/` reaches `~`, then `.agents/skills/<basename>`. This matches the upstream `installer.ts:createSymlink` in vercel-labs/skills (lib/skills.sh:101 comment).

## What `skills::heal_claude_symlink` Checks

```bash
# lib/skills.sh:110
local rel_target="../../.agents/skills/$basename"
```

Exact string match on `readlink` output (lib/skills.sh:117). Any deviation (absolute path, different relative path) triggers a replace.

## Snapshot File Format (`~/.agents/.kit-managed-skills`)

```
vercel-labs/agent-browser
```

One full slug per line, sorted. Written after every real (non-dry-run) sync by `skills::update_snapshot` (lib/skills.sh:236-247). Used by `skills::reconcile_removals` to detect removed slugs.

## Gotchas

- `~/.agents/skills/` must exist before the pre-check `[[ -d "$SKILLS_DIR/$basename" ]]` (lib/skills.sh:63). `mkdir -p "$SKILLS_DIR"` at lib/skills.sh:22 creates it in non-dry-run mode.
- A skill installed by the user manually into `~/.agents/skills/` WITHOUT a corresponding snapshot entry is not tracked by the kit. `--remove-plugins` will not remove it even if it's not in `skills.txt`.
- Claude Code discovers skills at `~/.claude/skills/*/SKILL.md`. If the symlink is missing, the skill is invisible to Claude Code even though the canonical copy exists at `~/.agents/skills/`.
