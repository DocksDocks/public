---
name: universal-skills-context
description: "Use when modifying cli/src/engine-native/skillsSync.ts skillsSync, syncUniversal, healClaudeSymlink, reconcileRemovals, updateSnapshot, normalizeManifest, or SoT/.agents/skills.txt; covers source-first skills CLI args, universal storage, symlink healing, and the prune snapshot. Not for Bun bootstrap or toolchain behavior; use toolchain-context."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/skillsSync.ts
      lines: "1-281"
    - path: SoT/.agents/skills.txt
      lines: "1-3"
  updated: "2026-08-15"
---

# Universal Skills Bootstrap

Universal skills are declared in `SoT/.agents/skills.txt` and installed into
`~/.agents/skills/` so Codex can read them natively and Claude Code can follow a
symlink from `~/.claude/skills/`.

`SoT/.agents/skills.txt` is empty by default.

<constraint>
The slug must precede `-a` in `npx skills add`: `skills add <slug> -g -y -a
claude-code codex`. The `-a/--agent` flag is variadic and consumes following
tokens as agent names.
</constraint>

<constraint>
Always name both `claude-code` and `codex`. A single-agent install may copy
directly into one tool directory and skip the canonical `~/.agents/skills/`
path.
</constraint>

<constraint>
`updateSnapshot` must run last in `skillsSync`. If a run aborts mid-way, the
snapshot should still represent the prior known-good manifest.
</constraint>

## When To Use

- Adding or removing a slug in `SoT/.agents/skills.txt`.
- Changing `syncUniversal`, manifest parsing, or symlink healing.
- Changing `--prune` removal of kit-managed skills.

## Storage Model

```text
~/.agents/skills/<basename>/        canonical universal skill path
~/.claude/skills/<basename>         symlink -> ../../.agents/skills/<basename>
~/.agents/.kit-managed-skills       sorted snapshot of kit-declared slugs
```

`syncUniversal` skips `npx skills add` when the canonical directory already
exists, but still calls `healClaudeSymlink` to repair a missing or stale symlink.
Real directories at the Claude path are left alone with a warning.

## Manifest Parsing

`normalizeManifest` is the shared parser for install, removal, and snapshot
flows. It strips blank lines, whole-line comments, inline comments, and
whitespace before producing one slug per line. Do not parse `skills.txt` ad hoc.

## Correct CLI Invocation

```text
npx --yes skills add <slug> -g -y -a claude-code codex
```

The slug is positional and must come first. Remove is also positional:
`skills remove --global <basename> -y`. Do not pass `-a '*'`:
`skills@1.5.15` documents that form but rejects it at runtime.

## Prune Snapshot

`reconcileRemovals` runs only when `ctx.prune` is true. It compares the previous
snapshot against the current manifest and removes slugs that were kit-managed
but are no longer declared. User-installed skills that never appeared in the
snapshot are preserved.

## Gotchas

- Slug after `-a` exits successfully but installs nothing.
- A real directory at `~/.claude/skills/<name>` masks the canonical skill for
  Claude Code; sync warns but does not delete user content.
- A failed install can still be present in the snapshot because the snapshot
  records declared kit intent, not install success.

## References

- `references/storage-model.md` - path diagram and symlink rules.
- `references/cli-arg-trap.md` - source-first argument-order regression context.
