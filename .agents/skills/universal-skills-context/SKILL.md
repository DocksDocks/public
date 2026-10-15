---
name: universal-skills-context
description: "Use when modifying cli/src/engine-native/skillsSync.ts (orchestration), skillsInstall.ts syncUniversal/skillsCli, skillsLinks.ts healClaudeSymlink/linkOrCopy/COPY_MARKER, skillsPrune.ts reconcileRemovals/updateSnapshot, skillsManifest.ts normalizeManifest/skillBase, or SoT/.agents/skills.txt; covers source-first skills CLI args, universal storage, symlink healing, and the prune snapshot. Not for Bun bootstrap or toolchain behavior; use toolchain-context."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/skillsSync.ts
      lines: "1-54"
    - path: cli/src/engine-native/skillsInstall.ts
      lines: "1-110"
    - path: cli/src/engine-native/skillsLinks.ts
      lines: "1-216"
    - path: cli/src/engine-native/skillsPrune.ts
      lines: "1-115"
    - path: cli/src/engine-native/skillsManifest.ts
      lines: "1-33"
    - path: SoT/.agents/skills.txt
      lines: "1-3"
  updated: "2026-10-14"
---

# Universal Skills Bootstrap

Universal skills are declared in `SoT/.agents/skills.txt` and installed into
`~/.agents/skills/` so Codex can read them natively and Claude Code can follow a
symlink from `~/.claude/skills/`.

`SoT/.agents/skills.txt` is empty by default.

<constraint>
The slug must precede `-a` in `npx skills@<verified> add`: `skills add <slug> -g
-y -a claude-code codex`. The `-a/--agent` flag is variadic and consumes
following tokens as agent names.
</constraint>

<constraint>
Always name both `claude-code` and `codex`. A single-agent install may copy
directly into one tool directory and skip the canonical `~/.agents/skills/`
path.
</constraint>

<constraint>
`updateSnapshot` must run last in `skillsSync`. It writes the declared slugs
plus `retainedSlugs`. A run without `--prune` retains every previous snapshot
slug. A `--prune` run retains only the slugs that it failed to remove. If a run
aborts mid-way, the snapshot keeps its prior content.
</constraint>

## When To Use

- Adding or removing a slug in `SoT/.agents/skills.txt`.
- Changing `syncUniversal`, manifest parsing, or symlink healing.
- Changing `--prune` removal of kit-managed skills.

## Storage Model

```text
~/.agents/skills/<basename>/        canonical universal skill path
~/.claude/skills/<basename>         symlink -> ../../.agents/skills/<basename>
~/.agents/.kit-managed-skills       sorted snapshot of kit-tracked slugs
```

`skillsManifest.ts skillBase` derives `<basename>` from a slug. An
`<owner>/<repo>@<skill>` slug yields the skill name. Any other slug yields its
last path segment. `skillBase` lowercases the name and replaces each run of
characters outside `[a-z0-9._]` with `-`, as the CLI `sanitizeName` rule does.
It also strips leading and trailing dots and dashes.

`syncUniversal` skips `npx skills@<verified> add` when the canonical directory
already exists, but still calls `healClaudeSymlink` to repair a missing or stale
symlink. After an add exits 0, `syncUniversal` warns when the canonical
directory is still missing. The installed skill name then differs from the slug,
so declare the slug as `<owner>/<repo>@<skill-name>`.

`linkOrCopy` creates the Claude entry. It tries a relative symlink, then
(Windows) an absolute junction, then a recursive copy marked with
`.docks-kit-copied-skill`. Later syncs replace a marked copy, and --prune
reclaims it. Sync leaves unmarked real directories alone with a warning.

## Manifest Parsing

`normalizeManifest` is the shared parser for install, removal, and snapshot
flows. It strips blank lines, whole-line comments, inline comments, and
whitespace before producing one slug per line. Do not parse `skills.txt` ad hoc.

## Correct CLI Invocation

```text
npx --yes skills@<verified> add <slug> -g -y -a claude-code codex
```

`<verified>` is the `skills-cli.verified` pin in `SoT/toolchain.json`. The slug
is positional and must come first. The CLI accepts `add -a '*'`, but that form
installs to every supported agent. The kit therefore names only `claude-code`
and `codex`.

The kit does not call `skills remove`. In the pinned skills-cli 1.7.0, `remove`
without `-a` targets every known agent. It recursively deletes each same-named
skill directory, real directory or link. `skills remove` rejects `-a '*'`
(`Invalid agents: *`, exit 1).

## Prune Snapshot

`reconcileRemovals` runs only when `ctx.prune` is true. It compares the previous
snapshot against the current manifest and removes slugs that were kit-managed
but are no longer declared. It deletes only what the kit created. That is the
canonical `~/.agents/skills/<basename>` when it is a real directory that holds
`SKILL.md`. It also deletes the kit-managed Claude entry: a symlink, a junction,
or a marked copy. It never touches an unmarked real
`~/.claude/skills/<basename>` or the skill directories of other agents.
User-installed skills that never appeared in the snapshot are preserved.

A run without `--prune` keeps the previous snapshot slugs. A later `--prune`
therefore still removes a slug that left `skills.txt` earlier. A failed removal
stays in the snapshot for the next `--prune`. The prune keeps the directories of
a dropped slug when a declared slug still maps to the same basename.

## Gotchas

- With the slug after `-a`, the variadic flag takes the slug as an agent name,
  and skills@1.7.0 exits 1 with `Missing required argument: source`.
- An unmarked real directory at `~/.claude/skills/<name>` masks the canonical
  skill for Claude Code; sync warns but does not delete user content. A copy
  marked with `.docks-kit-copied-skill` is kit-owned; sync replaces it.
- A failed install can still be present in the snapshot because the snapshot
  records kit-tracked slugs, not install success. It holds the declared slugs
  plus previously tracked slugs that no successful --prune removed yet.

## References

- `references/storage-model.md` - path diagram and symlink rules.
- `references/cli-arg-trap.md` - source-first argument-order regression context
  and the reason the kit does not call `skills remove`.
