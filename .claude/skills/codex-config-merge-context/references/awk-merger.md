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
deletes an exact-header matching block from the deployed config, then appends the
SoT block with a blank-line separator.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User top-level key absent from SoT | Preserved. |
| SoT table absent from user config | Appended at EOF. |
| User table absent from SoT | Preserved. |
| User table header differs by trailing spaces | Not deleted; can duplicate logical table. |
| `[features]` only contains `use_legacy_landlock` | Scrubber removes the whole table. |

## Deprecated Feature Scrub

`codexSync.ts scrubDeprecatedFeatures, pre-merge staging scrub` removes a
top-level `use_legacy_landlock` entry and removes an empty `[features]` table
left behind. It runs before merge passes so the deprecated key cannot survive
through table replacement.

## Retired Plugin Table Removal

`codexSync.ts removeRetiredPluginTablesText, retired-plugin line transform`
shares `codexSync.ts PLUGIN_TABLE_HEADER, plugin-table grammar` with
`codexSync.ts enabledPluginIdsFromText, enabled-table scan` and tests ids
against `codexSync.ts RETIRED_PLUGIN_IDS, curated retirement record`. A matching
retired header starts skipping and is dropped. Skipping ends at the next line
starting with `[`. A surviving plugin header matches the same regex, clears
skipping, and is emitted.

`codexSync.ts removeRetiredPluginTables, staging presence guard` returns without
writing when no retired table is present, so a clean config stays byte-identical
and `codexSync.ts syncConfig, change-sensitive backup` does not create a
spurious `config.toml.bak`. The pass runs on the staging copy after
`codexSync.ts scrubDeprecatedFeatures, staging scrub pass` and before
`codexSync.ts mergeTopLevelSettings, staging top-level merge`; `codexSync.ts
syncConfig, dry-run branch` returns before staging, so the pass prints nothing
under `--dry-run`.

## Gotchas

- Blank-line separators are visible in snapshots.
- Exact table-header matching is intentional but fragile around whitespace.
- User fields inside SoT-owned tables are lost because the SoT table block is the
  ownership boundary.
