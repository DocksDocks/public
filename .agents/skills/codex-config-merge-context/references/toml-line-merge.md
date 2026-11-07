# Line-Based TOML Merger

The merger is line-based on purpose. Do not replace it with a TOML parser that
rewrites formatting.

## Constraints

- Pass order is fixed: scrub deprecated features, remove retired plugin tables,
  remove retired top-level settings, merge top-level keys, then replace table
  blocks.
- Table blocks are replaced wholesale.
- Writes go through a temporary file/replacement path
  (`atomicWrite.ts replaceFile`, plus the `syncConfig` staging copy).
- `replaceTopLevelSetting` is shared by the SoT top-level merge, the
  `codexSync.ts codexSync` modifier pre-merge, `syncCodexModel`, and
  `syncCodexEffort`.
- `tomlLines.ts` owns the line grammar: `isTomlHeaderLine`,
  `keyValueSeparator`, and `tomlContinuationLines`, which marks the lines that
  continue a multi-line string, array, or inline table. `codexToml.ts`,
  `codexConfig.ts`, `codexPlugins.ts`, and `manifests.ts topLevelTomlString`
  import it. The module imports nothing, so `manifests.ts` reads a Codex config
  without a runtime import cycle.

## Pass 1: Top-Level Key Replacement

`mergeTopLevelSettings` extracts SoT `key = value` lines before the first table
header and calls `replaceTopLevelSetting` for each line.

`replaceTopLevelSetting(content, key, replacement)`:

- Replaces an existing matching pre-table key line.
- Inserts the replacement immediately before the first table when the key is
  absent.
- Appends at EOF when the file has no table.
- Leaves matching text inside tables untouched.

Verify: `bunx vitest run cli/test/unit/contract-codex-toml.test.ts -t "keeps a table-scoped key while replacing the top-level key"`.

## Pass 2: Wholesale Table Replacement

`mergeTableSettings` finds each SoT table header, extracts the whole SoT block,
deletes every deployed block whose header decodes to the same TOML key path
(`codexToml.ts tomlTableHeader`: whitespace inside the brackets, a trailing
`# comment`, and quoted/escaped keys are normalized, so `[ tui ] # note` and
`[plugins.'docks@docks']` match), then appends the SoT block with a blank-line
separator. Blank lines at the end of the kept text are dropped first, so a
repeated sync adds no blank line before the table (verify:
`bunx vitest run cli/test/unit/codexTomlMerge.test.ts -t "keeps a one-table merge stable across repeated syncs"`).

A run of blank and `#` comment lines directly after the last key line of a
deleted block is kept, without its leading blank lines. Such a run usually
belongs to the next table or is commented-out config. Comment lines before a
later key line of the same block are interior to the block and are deleted
(verify: `bunx vitest run cli/test/unit/codexTomlMerge.test.ts -t "keeps comment lines that follow a replaced managed table"`).

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
through table replacement. Verify: `bun run golden:mutation` fails with
"deprecated use_legacy_landlock survived the scrub" when the pass breaks.

## Retired Plugin Table Removal

`codexConfig.ts removeRetiredPluginTablesText, retired-plugin line transform`
shares `codexConfig.ts PLUGIN_TABLE_HEADER, plugin-table grammar` with
`codexPlugins.ts enabledPluginIdsFromText, enabled-table scan` and tests ids
against `codexConfig.ts RETIRED_PLUGIN_IDS, curated retirement record`. A matching
retired header starts skipping and is dropped. Skipping ends at the next table
header line. A surviving plugin header matches the same regex, clears
skipping, and is emitted.

`codexConfig.ts removeRetiredPluginTables, staging presence guard` returns without
writing when no retired table is present, so a clean config stays byte-identical
and `codexConfig.ts syncConfig, change-sensitive backup` does not create a
spurious `config.toml.bak`. The pass runs on the staging copy after
`codexConfig.ts scrubDeprecatedFeatures, staging scrub pass` and before
`codexToml.ts mergeTopLevelSettings, staging top-level merge`; `codexConfig.ts
syncConfig, dry-run branch` returns before staging, so the pass prints nothing
under `--dry-run`. Verify:
`bunx vitest run cli/test/unit/codexRetiredPlugins.test.ts -t "removeRetiredPluginTablesText"`.

## Retired Top-Level Setting Removal

`codexConfig.ts removeRetiredTopLevelSettings, staging retired-setting pass`
runs after the retired plugin table pass and before `codexToml.ts
mergeTopLevelSettings, staging top-level merge`. It drops a top-level line
(before the first table header) that holds exactly a retired kit value listed
in `codexConfig.ts RETIRED_TOP_LEVEL_SETTINGS`
(verify: `grep -n -A10 'RETIRED_TOP_LEVEL_SETTINGS:' cli/src/engine-native/codexConfig.ts`).
A different user value stays. The pass writes nothing when no retired line is
present. Verify:
`bunx vitest run cli/test/unit/codexTomlMerge.test.ts -t "handles a deployed top-level personality"`.

## Gotchas

- Blank-line separators are visible in snapshots.
- Header identity is the decoded TOML key path, not the raw header text.
- User fields inside SoT-owned tables are lost because the SoT table block is the
  ownership boundary.
