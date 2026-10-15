# Line-Based TOML Merger

The implementation is TypeScript, but it deliberately keeps the old line-based
TOML transform semantics. Do not replace it with a TOML parser that rewrites
formatting.

## Critical Constraints

- Pass order is fixed: scrub deprecated features, remove retired plugin tables,
  merge top-level keys, then replace table blocks.
- Table blocks are replaced wholesale.
- Writes go through a temporary file/replacement path.
- `replaceTopLevelSetting` is shared by SoT top-level merge and
  `syncCodexModel`.

## Pass 1: Top-Level Key Replacement

`mergeTopLevelSettings` extracts SoT `key = value` lines before the first table
header and calls `replaceTopLevelSetting` for each line.

`replaceTopLevelSetting(content, key, replacement)`:

- Replaces an existing matching pre-table key line.
- Inserts the replacement immediately before the first table when the key is
  absent.
- Appends at EOF when the file has no table.
- Leaves matching text inside tables untouched.

## Pass 2: Wholesale Table Replacement

`mergeTableSettings` finds each SoT table header, extracts the whole SoT block,
deletes every deployed block whose header decodes to the same TOML key path
(`codexToml.ts tomlTableHeader`: whitespace inside the brackets, a trailing
`# comment`, and quoted/escaped keys are normalized, so `[ tui ] # note` and
`[plugins.'docks@docks']` match), then appends the SoT block with a blank-line
separator.

A run of blank and `#` comment lines directly after the last key line of a
deleted block is kept, without its leading blank lines. Such a run usually
belongs to the next table or is commented-out config. Comment lines before a
later key line of the same block are interior to the block and are deleted.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User top-level key absent from SoT | Preserved. |
| SoT table absent from user config | Appended at EOF. |
| User table absent from SoT | Preserved. |
| User table header differs only in padding, trailing comment, or key quoting | Recognized as the same table; deleted and replaced, no duplicate. |
| Comment run after the last key of a SoT-owned user table | Kept in place of the deleted block. |
| `[features]` only contains `use_legacy_landlock` | Scrubber removes the whole table. |

## Deprecated Feature Scrub

`codexConfig.ts scrubDeprecatedFeatures, pre-merge staging scrub` removes a
`use_legacy_landlock` entry inside `[features]` (the header must be a bare
`[features]` line) and removes an empty `[features]` table
left behind. It runs before merge passes so the deprecated key cannot survive
through table replacement.

## Retired Plugin Table Removal

`codexConfig.ts removeRetiredPluginTablesText, retired-plugin line transform`
shares `codexConfig.ts PLUGIN_TABLE_HEADER, plugin-table grammar` with
`codexPlugins.ts enabledPluginIdsFromText, enabled-table scan` and tests ids
against `codexConfig.ts RETIRED_PLUGIN_IDS, curated retirement record`. A matching
retired header starts skipping and is dropped. Skipping ends at the next line
starting with `[`. A surviving plugin header matches the same regex, clears
skipping, and is emitted.

`codexConfig.ts removeRetiredPluginTables, staging presence guard` returns without
writing when no retired table is present, so a clean config stays byte-identical
and `codexConfig.ts syncConfig, change-sensitive backup` does not create a
spurious `config.toml.bak`. The pass runs on the staging copy after
`codexConfig.ts scrubDeprecatedFeatures, staging scrub pass` and before
`codexToml.ts mergeTopLevelSettings, staging top-level merge`; `codexConfig.ts
syncConfig, dry-run branch` returns before staging, so the pass prints nothing
under `--dry-run`.

## Gotchas

- Blank-line separators are visible in snapshots.
- Header identity is the decoded TOML key path, not the raw header text.
- User fields inside SoT-owned tables are lost because the SoT table block is the
  ownership boundary.
