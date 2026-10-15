---
name: codex-config-merge-context
description: "Use when modifying cli/src/engine-native/codexConfig.ts syncConfig, scrubDeprecatedFeatures, removeRetiredPluginTables, cli/src/engine-native/codexSync.ts ensureBubblewrap, syncRules, or cli/src/engine-native/codexToml.ts mergeTopLevelSettings/mergeTableSettings/replaceTopLevelSetting/syncCodexModel; covers line-based TOML merge semantics, deprecated features scrub, Codex rules deployment, and bubblewrap checks."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/codexConfig.ts
      lines: "1-158"
    - path: cli/src/engine-native/codexToml.ts
      lines: "1-248"
    - path: SoT/.codex/config.toml
      lines: "1-44"
    - path: SoT/.codex/rules/docks.rules
      lines: "1-113"
  updated: "2026-10-14"
---

# Codex Config Merge

Codex config sync is a line-based TOML transform, not a TOML parse/reformat.
That preserves user formatting and the established merge contract.

<constraint>
Do not use `jq` on TOML. Top-level keys and table blocks are handled by separate
line transforms: `mergeTopLevelSettings` and `mergeTableSettings`.
</constraint>

<constraint>
Kit-managed table blocks are replaced wholesale. There is no field-level merge
inside a SoT-declared TOML table.
</constraint>

<constraint>
`ensureBubblewrap` is the only kit path that *runs* a sudo package-manager
install (`bwrapDetectPmInstallCmd`). Dependency warnings (`deps.warnMissing`)
may print platform package-manager hints, including sudo on Linux, but never
execute them. ensureBubblewrap is Linux-only, skipped by `--skip-bubblewrap`,
and must continue to warn rather than fail when system bubblewrap cannot be
installed or user namespaces are blocked.
</constraint>

## When To Use

- Adding a top-level key or table to `SoT/.codex/config.toml`.
- Changing the deprecated `[features].use_legacy_landlock` scrubber.
- Changing the retired kit-owned plugin-table cleanup.
- Changing `--codex-model` deployment behavior.
- Adding or changing `SoT/.codex/rules/*.rules`.
- Changing bubblewrap detection or install guidance.

## Sync Sequence

`codexConfig.ts syncConfig, config staging pipeline`:

1. First install copies SoT config when no deployed file exists.
2. Existing deployed config is copied to a staging file; no backup is written yet.
3. `codexConfig.ts scrubDeprecatedFeatures, staging scrub pass` removes
   `use_legacy_landlock` and an empty `[features]` table.
4. `codexConfig.ts removeRetiredPluginTables, staging retirement pass` strips
   retired kit-owned plugin tables.
5. `codexToml.ts mergeTopLevelSettings, staging top-level merge` replaces or
   inserts SoT top-level `key = value` lines before the first table.
6. `codexToml.ts mergeTableSettings, staging table merge` deletes each
   SoT-declared table from the staging file and appends the SoT block.
7. A changed staging file backs up and replaces the deployed config; a byte-identical
   staging file is discarded without writing `config.toml.bak`.

`codexConfig.ts removeRetiredPluginTablesText, retired-plugin line transform`
shares `codexConfig.ts PLUGIN_TABLE_HEADER, plugin-table grammar` with
`codexPlugins.ts enabledPluginIdsFromText, enabled-table scan` and checks ids
against `codexConfig.ts RETIRED_PLUGIN_IDS, curated retirement record`. A retired
plugin header starts skipping and is dropped; skipping ends at the next line
starting with `[`, while a surviving plugin header both matches the regex and
clears skipping.

`codexConfig.ts removeRetiredPluginTables, staging presence guard` returns before
writing when no retired table is present, preserving a clean config byte for
byte. `codexConfig.ts syncConfig, dry-run branch` returns before the staging
pipeline, so this cleanup prints nothing under `--dry-run`.

`syncCodexModel(ctx, model)` reuses `replaceTopLevelSetting` to update only the
deployed top-level `model = "<value>"` line. It never mutates the SoT.

## Rules Deployment

`syncRules` copies kit-managed `*.rules` files from `SoT/.codex/rules/` and
backs up existing deployed files. `~/.codex/rules/default.rules` is user-learned
state and is never touched because it is not present in the SoT rules directory.

`docks.rules` uses:

```text
prefix_rule(pattern=["cmd", "subcmd"], decision="<allow|prompt|forbidden>")
```

Prefix rules match argv prefixes, not shell strings. Include enough tokens that
an allowed prefix cannot be turned into a write or exec by a later flag.

An `allow` rule runs the command outside the sandbox without a prompt. A command
with no rule runs inside the SoT `workspace-write` sandbox with no prompt. For
this reason, `docks.rules` has no allow rule for `sort`, `uniq`, `tree`,
`git diff`, `git log`, `git show`, or `git grep`. Their reachable write or exec
flags are `sort -o`/`--compress-program`, the `uniq` OUTPUT operand, `tree -o`,
`git diff|log|show --output`, and `git grep --open-files-in-pager`/`-O`.
`git mv` is `prompt`, because an allowed `git mv` can move workspace files into
the read-only `.git` directory, for example `.git/hooks`.

## Bubblewrap

`ensureBubblewrap` returns early on macOS, probes Linux for `bwrap`, detects a
package-manager install command when missing, and validates unprivileged user
namespaces with `unshare -Ur true`. Ubuntu AppArmor restrictions can block that
probe after install; the sync should warn and continue.

## Key Decisions

- The merge is additive for user-only top-level keys and tables.
- SoT-declared table headers are ownership boundaries; the SoT block wins
  wholesale.
- The top-level line replacer is shared by SoT merge and `--codex-model`, so
  placement fixes cover both paths.
- Codex config reconcile is not a wholesale reset.

## Gotchas

- SoT ownership is matched by decoded TOML key path, so padded, commented, or
  re-quoted user headers are replaced rather than duplicated.
- Blank-line separators are cosmetic but visible in golden snapshots.
- A user-added table survives only while its key path is absent from the SoT.

## References

- `references/awk-merger.md` - line-transform spec and edge cases.
- `references/rules-format.md` - Codex command-policy rule syntax.
