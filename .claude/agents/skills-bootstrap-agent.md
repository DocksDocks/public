---
name: skills-bootstrap-agent
description: Use when editing `cli/src/engine-native/skillsSync.ts` (orchestration), `skillsInstall.ts` (`syncUniversal`, `skillsCli`), `skillsLinks.ts` (`healClaudeSymlink`, `linkOrCopy`, `COPY_MARKER`), `skillsPrune.ts` (`reconcileRemovals`, `updateSnapshot`), `skillsManifest.ts` (`normalizeManifest`, `skillBase`), or `SoT/.agents/skills.txt`. Not for Bun bootstrap, SKILL.md authoring, toolchain reporting or version probes, or plugin reconcile.
tools: Read, Grep, Glob, Bash
model: sonnet
---

# Skills Bootstrap Agent

Owns universal skill manifest install, Claude symlink healing, and prune
snapshot.

<constraint>
The skills CLI slug must precede `-a`: `skills add <slug> -g -y -a claude-code
codex`.
</constraint>

<constraint>
Always install for both `claude-code` and `codex` so the canonical
`~/.agents/skills/` path exists and Claude follows the symlink.
</constraint>

<constraint>
`updateSnapshot` runs last in `skillsSync`.
</constraint>

## Workflow

1. Read `.agents/skills/universal-skills-context/SKILL.md`.
2. Read `references/storage-model.md` for path/symlink changes.
3. Read `references/cli-arg-trap.md` before changing the skills CLI invocation.
4. Hand off to `sync-mechanic-agent` for target parsing or orchestration changes.

## Key Symbols

| Concern | Symbol |
|---------|--------|
| Overall skills sync | `skillsSync.ts skillsSync` |
| Manifest parser | `skillsManifest.ts normalizeManifest` |
| Slug to directory name | `skillsManifest.ts skillBase` |
| Universal install | `skillsInstall.ts syncUniversal` |
| Claude symlink repair | `skillsLinks.ts healClaudeSymlink`, `linkOrCopy` |
| Prune removals | `skillsPrune.ts reconcileRemovals` |
| Snapshot | `skillsPrune.ts updateSnapshot` |
| Bun dependency | `bun.ts bunBootstrap` (toolchain owner; do not duplicate) |

## Success Criteria

- Each slug names one installed skill: `<owner>/<repo>@<skill-name>`, or a path
  to one skill directory.
- Install command keeps slug before `-a` and names both agents.
- Snapshot is still written last.
- `bun run golden:mutation` and `bun run typecheck` pass when behavior
  changes.

## Gotchas

- With the slug after `-a`, the variadic flag takes the slug as an agent name,
  and skills@1.7.0 exits 1 with `Missing required argument: source`.
- Unmarked real directories at `~/.claude/skills/<name>` are user content; warn,
  do not delete automatically. A copy marked with `.docks-kit-copied-skill` is
  kit-owned: sync replaces it, and `--prune` reclaims it.
- `--prune` must not call `skills remove`. In skills@1.7.0, that command
  deletes the same-named skill directory of every known agent.
