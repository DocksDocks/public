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
|-- .kit-owned-skills       kit-installed slugs; the only --prune record
|-- .kit-pending-skills     installs in progress
`-- .kit-managed-skills     legacy record of an older kit; read only

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
directories alone with a warning. Verify each step:

- Relative symlink:
  `bunx vitest run cli/test/unit/skillsSync.test.ts -t "creates a real symlink with the relative target"`.
- Junction after a failed symlink:
  `bunx vitest run cli/test/unit/skillsSync.test.ts -t "falls through from a failed symlink"`.
- Marked copy after every link kind fails:
  `bunx vitest run cli/test/unit/skillsSync.test.ts -t "copies the canonical skill when both symlink and junction creation fail"`.
- Marked copy healed, unmarked directory kept with a warning:
  `bunx vitest run cli/test/unit/skillsSync.test.ts -t "heals a marked copy back to a link"`.
- `--prune` reclaims a marked copy:
  `bunx vitest run cli/test/unit/skillsSync.test.ts -t "prunes only kit-created entries"`.

## Record Format

Each record holds one full slug per line, sorted (`skillsRecords.ts`). An owned
line also holds the identity of the directory: `<slug>\t<dev>:<ino>`.

| File | Holds | Writer |
|------|-------|--------|
| `~/.agents/.kit-owned-skills` | The slugs whose canonical directory an install of the kit created, each with the `<dev>:<ino>` of that directory. The only record that lets `--prune` remove a skill, and only while the directory keeps that identity. | `writeSkillRecords`, first, after each install and at the end of the sync |
| `~/.agents/.kit-pending-skills` | The slugs whose install runs. A slug enters only when the canonical directory has no entry. Removed when empty. | `recordPendingInstall` before the install; `writeSkillRecords`, second |
| `~/.agents/.kit-managed-skills` | The legacy snapshot of an older kit. It also names directories that the user made. | None; sync only reads it |

Each non-dry-run sync that runs the `agents` target (`syncDispatch.ts`,
`ctx.syncAgents` branch) writes the owned and pending records. A pending slug
left by a stopped sync moves to the owned record when its directory exists,
else it is dropped. The pending slugs are a separate file, not a prefix in a
shared file. An older kit parses each line with `normalizeManifest`, which
removes all whitespace. So it would read a prefixed line as a slug.

## Gotchas

- User-installed skills that the owned record does not name are never pruned
  by the kit, also when the legacy record names them. `--prune` prints a
  `keep` line for a legacy slug that the SoT dropped and whose directory
  exists.
- `--prune` deletes only the kit-created canonical directory and the
  kit-managed Claude entry. It never touches the skill directories of other
  agents.
- A missing Claude symlink makes a skill invisible to Claude Code even though
  Codex can see the canonical copy.
- Unmarked real directories in `~/.claude/skills/` can diverge from canonical
  content; sync warns but does not delete them. Sync replaces a marked copy.
