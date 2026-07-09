# Universal Skills Storage Model

## Critical Constraint

Use two-agent install mode, `-a claude-code codex`, so the skills CLI creates the
canonical universal path and the Claude Code symlink.

## Path Layout

```text
~/.agents/
|-- skills/
|   `-- agent-browser/
|       |-- SKILL.md
|       `-- references/
`-- .kit-managed-skills

~/.claude/
`-- skills/
    `-- agent-browser -> ../../.agents/skills/agent-browser
```

Codex reads `~/.agents/skills/` natively. Claude Code discovers the symlinked
entry under `~/.claude/skills/`.

## Two-Agent vs Single-Agent Install

| Invocation | Canonical path | Claude path | Codex coverage |
|------------|----------------|-------------|----------------|
| `-a claude-code codex` | Created | Symlink | Yes |
| `-a claude-code` | May copy direct | Real copy | No |
| `-a codex` | May copy direct | Missing | Yes |

## Symlink Target

```text
~/.claude/skills/<name> -> ../../.agents/skills/<name>
```

`healClaudeSymlink` compares the exact relative target. Correct symlinks are
left alone, stale symlinks are replaced, and real directories are preserved with
a warning.

## Snapshot Format

`~/.agents/.kit-managed-skills` contains one full slug per line, sorted. It is
written after successful real syncs and used by `--prune` to identify removed
kit-managed skills.

## Gotchas

- User-installed skills without snapshot entries are not pruned by the kit.
- A missing Claude symlink makes a skill invisible to Claude Code even though
  Codex can see the canonical copy.
- Real directories in `~/.claude/skills/` can diverge from canonical content;
  sync warns but does not delete them.
