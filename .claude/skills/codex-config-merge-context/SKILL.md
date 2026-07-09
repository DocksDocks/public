---
name: codex-config-merge-context
description: "Use when modifying cli/src/engine-native/codexSync.ts syncConfig, scrubDeprecatedFeatures, mergeTopLevelSettings, mergeTableSettings, ensureBubblewrap, syncRules, or cli/src/engine-native/codexToml.ts replaceTopLevelSetting/syncCodexModel; covers line-based TOML merge semantics, deprecated features scrub, Codex rules deployment, and bubblewrap checks."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/codexSync.ts
      lines: "1-250"
    - path: cli/src/engine-native/codexToml.ts
      lines: "1-80"
    - path: SoT/.codex/config.toml
      lines: "1-90"
    - path: SoT/.codex/rules/docks.rules
      lines: "1-140"
  updated: "2026-07-09"
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
`ensureBubblewrap` is the only kit path that may suggest a sudo package-manager
install. It is Linux-only, skipped by `--skip-rtk`, and must continue to warn
rather than fail when system bubblewrap cannot be installed or user namespaces
are blocked.
</constraint>

## When To Use

- Adding a top-level key or table to `SoT/.codex/config.toml`.
- Changing the deprecated `[features].use_legacy_landlock` scrubber.
- Changing `--codex-model` deployment behavior.
- Adding or changing `SoT/.codex/rules/*.rules`.
- Changing bubblewrap detection or install guidance.

## Sync Sequence

`syncConfig(ctx, sotConfig, userConfig)`:

1. First install copies SoT config when no deployed file exists.
2. Existing deployed config is backed up.
3. `scrubDeprecatedFeatures` removes `use_legacy_landlock` and an empty
   `[features]` table.
4. `mergeTopLevelSettings` replaces or inserts SoT top-level `key = value` lines
   before the first table.
5. `mergeTableSettings` deletes each SoT-declared table from the user file and
   appends the SoT block.

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

- Exact table-header matching means trailing spaces on a user table header can
  prevent deletion before append, creating duplicate logical tables.
- Blank-line separators are cosmetic but visible in golden snapshots.
- A user-added table survives only while its exact header is absent from the SoT.

## References

- `references/awk-merger.md` - line-transform spec and edge cases.
- `references/rules-format.md` - Codex command-policy rule syntax.
