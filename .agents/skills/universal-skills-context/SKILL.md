---
name: universal-skills-context
description: "Use when modifying cli/src/engine-native/skillsSync.ts (orchestration), skillsInstall.ts syncUniversal/skillsCli, skillsLinks.ts healClaudeSymlink/linkOrCopy/COPY_MARKER, skillsPrune.ts reconcileRemovals, skillsRecords.ts readSkillRecords/recordPendingInstall/settlePendingSlug/writeSkillRecords, skillsManifest.ts normalizeManifest/skillBase, or SoT/.agents/skills.txt. Covers source-first skills CLI args, universal storage, symlink healing, and the ownership records that --prune reads. Not for Bun bootstrap or the skills-cli pin entry (use toolchain-context), or sync targets and flag parsing (use sync-orchestration-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/engine-native/skillsSync.ts
      lines: "1-57"
    - path: cli/src/engine-native/skillsInstall.ts
      lines: "1-129"
    - path: cli/src/engine-native/skillsLinks.ts
      lines: "1-216"
    - path: cli/src/engine-native/skillsPrune.ts
      lines: "1-104"
    - path: cli/src/engine-native/skillsRecords.ts
      lines: "1-93"
    - path: cli/src/engine-native/skillsManifest.ts
      lines: "1-36"
    - path: SoT/.agents/skills.txt
      lines: "1-3"
    - path: SoT/toolchain.json
      lines: "1-38"
    - path: cli/src/engine-native/os/posix.ts
      lines: "1-83"
    - path: cli/src/engine-native/os/windows.ts
      lines: "1-184"
    - path: cli/src/engine-native/syncDispatch.ts
      lines: "1-211"
  updated: "2026-11-07"
---

# Universal Skills Bootstrap

Universal skills are declared in `SoT/.agents/skills.txt` and installed into
`~/.agents/skills/` so Codex can read them natively and Claude Code can follow a
symlink from `~/.claude/skills/`.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

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
Only `~/.agents/.kit-owned-skills` lets `--prune` remove a skill. Record a slug
there only when an install of the kit created its canonical directory:

- `syncUniversal` adds a slug to `~/.agents/.kit-pending-skills` before
  `npx skills add`, and only when `lstat` finds no entry at the canonical
  directory (`skillsRecords.ts canonicalAbsent`, `recordPendingInstall`).
- After the install, `settlePendingSlug` moves the slug to the owned record
  when the directory exists, and drops it otherwise.
- A canonical directory that existed before is reused and never recorded.
- `writeSkillRecords` writes the owned record first, then the pending record,
  and removes an empty pending record. A sync that stops between the two
  writes keeps the pending slugs for the next sync.
- Sync reads the legacy `~/.agents/.kit-managed-skills` and never writes it.

(verify: `bunx vitest run cli/test/unit/skillsDurability.test.ts -t "skill ownership records"`)
</constraint>

## When To Use

- Adding or removing a slug in `SoT/.agents/skills.txt`.
- Changing `syncUniversal`, manifest parsing, or symlink healing.
- Changing `--prune` removal of kit-managed skills.

## Storage Model

```text
~/.agents/skills/<basename>/        canonical universal skill path
~/.claude/skills/<basename>         symlink -> ../../.agents/skills/<basename>
~/.agents/.kit-owned-skills         sorted slugs that the kit installed; --prune reads only this
~/.agents/.kit-pending-skills       slugs whose install runs; absent when empty
~/.agents/.kit-managed-skills       legacy snapshot of an older kit; read only
```

`skillsManifest.ts skillBase` derives `<basename>` from a slug. An
`<owner>/<repo>@<skill>` slug yields the skill name. Any other slug yields its
last path segment. `skillBase` lowercases the name and replaces each run of
characters outside `[a-z0-9._]` with `-`, as the CLI `sanitizeName` rule does.
It also strips trailing dots and dashes (verify:
`bunx vitest run cli/test/unit/skillsManifest.test.ts -t "installs for acme/pack@My"`).
The same regex strips leading dots and dashes. Unprobed: no unit test covers a
leading dot or dash. Read the strip call in `skillsManifest.ts skillBase` (verify:
`grep -nF '/^[.-]+|[.-]+$/' cli/src/engine-native/skillsManifest.ts`).

`syncUniversal` skips `npx skills@<verified> add` when the canonical directory
already exists, but still calls `healClaudeSymlink` to repair a missing or stale
symlink. After an add exits 0, `syncUniversal` warns when the canonical
directory is still missing. The installed skill name then differs from the slug,
so declare the slug as `<owner>/<repo>@<skill-name>` (verify:
`bunx vitest run cli/test/unit/skillsSync.test.ts -t "reuses an existing canonical skill"`
and
`bunx vitest run cli/test/unit/skillsSync.test.ts -t "warns when a successful install creates no directory"`).

A reused directory is not kit-owned. For a declared slug whose directory
existed before and is in neither the owned nor the legacy record, each sync
warns `Universal skill <slug>: reused the existing ~/.agents/skills/<base>; the
kit did not install it, so --prune keeps it`. A dry run prints no such line
(verify:
`bunx vitest run cli/test/unit/skillsDurability.test.ts -t "never records a skill directory that existed before the install"`).

`linkOrCopy` creates the Claude entry. It tries each directory link kind in
`hostOs().directoryLinkKinds` order (`cli/src/engine-native/os/posix.ts`: a
relative symlink; `cli/src/engine-native/os/windows.ts`: a relative symlink,
then an absolute junction). Then it falls back to a recursive copy that holds a
`skillsLinks.ts COPY_MARKER` file. Later syncs replace a marked copy, and
--prune reclaims it. Sync leaves unmarked real directories alone with a warning
(verify: `bunx vitest run cli/test/unit/skillsSync.test.ts -t "falls through from a failed symlink"`
and
`bunx vitest run cli/test/unit/skillsSync.test.ts -t "heals a marked copy back to a link"`).

## Manifest Parsing

`normalizeManifest` is the shared parser for install, removal, and record
flows. It strips blank lines, whole-line comments, inline comments, and
whitespace before producing one slug per line. Do not parse `skills.txt` ad hoc.
Verify: `bun -e 'import { normalizeManifest } from "./cli/src/engine-native/skillsManifest.ts"; console.log(normalizeManifest("  acme/pack@demo  # note\n# comment\n\n"))'`
prints `[ "acme/pack@demo" ]`.

## Correct CLI Invocation

```text
npx --yes skills@<verified> add <slug> -g -y -a claude-code codex
```

`<verified>` is the `tools["skills-cli"].verified` pin in `SoT/toolchain.json`,
which `skillsInstall.ts skillsCli` reads (verify:
`bun -e 'console.log((await Bun.file("SoT/toolchain.json").json()).tools["skills-cli"].verified)'`).
The slug is positional and must come first. The CLI accepts `add -a '*'`, but
that form installs to every supported agent. The kit therefore names only
`claude-code` and `codex`.

The skills CLI behavior in this skill and its references holds for the pinned
version. When the pin changes, re-check it in that version's `dist/cli.mjs`
(verify: `v=$(bun -e 'console.log((await Bun.file("SoT/toolchain.json").json()).tools["skills-cli"].verified)'); curl -s "https://unpkg.com/skills@$v/dist/cli.mjs" | grep -n 'function parseAddOptions\|function removeCommand\|Missing required argument: source'`,
then read both functions).

The kit does not call `skills remove`. In the pinned CLI, `remove` without
`-a` targets every known agent. It recursively deletes each same-named skill
directory, real directory or link. `skills remove` rejects `-a '*'`
(`Invalid agents: *`, exit 1).

## Ownership Records And Prune

`skillsSync.ts skillsSync` runs in this order:

1. `readSkillRecords` reads the owned, pending, and legacy records.
2. A leftover pending slug from a stopped sync moves to the owned record when
   its directory exists, else it is dropped (`settlePendingSlug`). Sync writes
   the records.
3. `syncUniversal` installs the declared slugs (see the constraint above).
4. With `--prune`, `reconcileRemovals` removes owned slugs that the SoT no
   longer declares.
5. `writeSkillRecords` writes the records.

`reconcileRemovals` runs only when `ctx.prune` is true. It visits only the
slugs in `records.owned`. It deletes only what the kit created. That is the
canonical `~/.agents/skills/<basename>` when it is a real directory that holds
`SKILL.md`. It also deletes the kit-managed Claude entry: a symlink, a junction,
or a marked copy. It never touches an unmarked real
`~/.claude/skills/<basename>`. It does not call `skills remove`, so it never
touches the skill directories of other agents (verify:
`bunx vitest run cli/test/unit/skillsSync.test.ts -t "prunes only kit-created entries"`).
User-installed skills that the owned record does not name are preserved
(verify:
`bunx vitest run cli/test/unit/skillsDurability.test.ts -t "never records a skill directory that existed before the install"`).

A legacy entry never authorizes a removal, because an older kit also recorded
directories that the user made. For each legacy slug that the SoT dropped, that
is not owned, and whose canonical directory still exists, `--prune` prints
`keep <slug>: an older kit recorded it, so the kit cannot prove it installed
it; remove it by hand if the kit did` (verify:
`bunx vitest run cli/test/unit/skillsDurability.test.ts -t "keeps a legacy snapshot entry on prune and names it"`).

A run without `--prune` keeps every owned slug. A later `--prune` therefore
still removes a slug that left `skills.txt` earlier. A failed removal stays in
the owned record for the next `--prune` (verify:
`bunx vitest run cli/test/unit/skillsDurability.test.ts -t "keeps a dropped slug tracked through a plain sync"`
and
`bunx vitest run cli/test/unit/skillsDurability.test.ts -t "retains a failed removal"`).
The prune keeps the directories of a dropped slug when a declared slug still
maps to the same basename (`reconcileRemovals`, `currentBases` guard).

## Gotchas

- With the slug after `-a`, the variadic flag takes the slug as an agent name,
  and the pinned CLI exits 1 with `Missing required argument: source`.
- An unmarked real directory at `~/.claude/skills/<name>` masks the canonical
  skill for Claude Code; sync warns but does not delete user content. A copy
  that holds a `COPY_MARKER` file is kit-owned; sync replaces it.
- A failed install leaves no record: `settlePendingSlug` drops a pending slug
  whose directory does not exist (verify:
  `bunx vitest run cli/test/unit/skillsDurability.test.ts -t "drops a pending slug whose install failed"`).
- A skill that an older kit really installed is no longer pruned on its own,
  because only the legacy record names it. The keep line names it.
- A directory that the user creates between a stopped sync and the next sync,
  at the path of a pending slug, becomes kit-owned.

## References

- `.agents/skills/universal-skills-context/references/storage-model.md` - path
  diagram and symlink rules.
- `.agents/skills/universal-skills-context/references/cli-arg-trap.md` -
  source-first argument-order context and the reason the kit does not call
  `skills remove`.
