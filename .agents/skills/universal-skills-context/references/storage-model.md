# Universal Skills Storage Model

## Critical Constraint

Use two-agent install mode, `-a claude-code codex`, so the skills CLI creates the
canonical universal path and the Claude Code symlink.

## Path Layout

```text
~/.agents/
|-- skills/
|   `-- <basename>/
|       |-- SKILL.md
|       `-- references/
`-- .kit-managed-skills

~/.claude/
`-- skills/
    `-- <basename> -> ../../.agents/skills/<basename>
```

Codex reads `~/.agents/skills/` natively. Claude Code discovers the symlinked
entry under `~/.claude/skills/`. `skillsManifest.ts skillBase` derives
`<basename>` from the slug; see the SKILL.md Storage Model.

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

`healClaudeSymlink` accepts a link (symlink or junction) that resolves to the
canonical directory; relative symlinks are the preferred form. Sync replaces
stale links. `linkOrCopy` tries each kind in `hostOs().directoryLinkKinds`
order (a relative symlink; on Windows, then an absolute junction). Then it falls
back to a recursive copy that holds a `skillsLinks.ts COPY_MARKER` file. Later
syncs replace a marked copy, and --prune reclaims it. Sync leaves unmarked real
directories alone with a warning (verify:
`bunx vitest run cli/test/unit/skillsSync.test.ts -t "creates a real symlink with the relative target"`).

## Snapshot Format

`~/.agents/.kit-managed-skills` contains one full slug per line, sorted. It
holds the declared slugs plus previously tracked slugs that no successful
`--prune` has removed yet. Each non-dry-run sync that runs the `agents` target
(`syncDispatch.ts`, `ctx.syncAgents` branch) recomputes it in
`skillsPrune.ts updateSnapshot`. `--prune` uses it to identify removed
kit-managed skills.

## Gotchas

- User-installed skills without snapshot entries are not pruned by the kit.
- `--prune` deletes only the kit-created canonical directory and the
  kit-managed Claude entry. It never touches the skill directories of other
  agents.
- A missing Claude symlink makes a skill invisible to Claude Code even though
  Codex can see the canonical copy.
- Unmarked real directories in `~/.claude/skills/` can diverge from canonical
  content; sync warns but does not delete them. Sync replaces a marked copy.
