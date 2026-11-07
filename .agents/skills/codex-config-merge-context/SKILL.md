---
name: codex-config-merge-context
description: "Use when modifying cli/src/engine-native/codexConfig.ts syncConfig, scrubDeprecatedFeatures, removeRetiredPluginTables, removeRetiredTopLevelSettings; codexToml.ts mergeTopLevelSettings, mergeTableSettings, replaceTopLevelSetting, syncCodexModel, syncCodexEffort; tomlLines.ts isTomlHeaderLine, tomlContinuationLines; codexSync.ts ensureBubblewrap, syncRules; codexHooks.ts removeRetiredImportedHooks; codexPaths.ts codexHome; SoT/.codex/config.toml or SoT/.codex/rules/docks.rules. Covers line-based TOML merge, retired-entry cleanup, --codex-model and --codex-effort deployment, rules deployment and dropped-rules removal, and bubblewrap checks. Not for Claude settings merge (use settings-merge-context), Codex marketplace or plugin install (use plugin-bootstrap-context), or sync flag parsing (use sync-orchestration-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/engine-native/codexConfig.ts
      lines: "1-214"
    - path: cli/src/engine-native/codexToml.ts
      lines: "1-303"
    - path: cli/src/engine-native/tomlLines.ts
      lines: "1-92"
    - path: cli/src/engine-native/codexSync.ts
      lines: "1-269"
    - path: cli/src/engine-native/codexPlugins.ts
      lines: "1-315"
    - path: cli/src/engine-native/codexHooks.ts
      lines: "1-91"
    - path: cli/src/engine-native/codexPaths.ts
      lines: "1-14"
    - path: cli/src/manifests.ts
      lines: "1-145"
    - path: cli/src/engine-native/services.ts
      lines: "1-89"
    - path: cli/src/engine-native/atomicWrite.ts
      lines: "1-64"
    - path: cli/src/efforts.ts
      lines: "1-89"
    - path: SoT/.codex/config.toml
      lines: "1-44"
    - path: SoT/.codex/rules/docks.rules
      lines: "1-157"
  updated: "2026-11-07"
---

# Codex Config Merge

Codex config sync is a line-based TOML transform, not a TOML parse/reformat.
That preserves user formatting and the established merge contract.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

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
install (`bwrapDetectPmInstallCmd`). Dependency warnings
(`services.ts makeDependencyManager, warnMissing`) may print platform
package-manager hints, including sudo on Linux, but never execute them
(verify: `grep -rnE 'spawnProcess\("bash"' cli/src/engine-native` must list
only `codexSync.ts`). ensureBubblewrap is Linux-only. `--skip-bubblewrap` skips
only the auto-install: the `bwrap` probe still runs and a missing `bwrap` still
warns. ensureBubblewrap must continue to warn rather than fail when system
bubblewrap cannot be installed or user namespaces are blocked.
</constraint>

## When To Use

- Adding a top-level key or table to `SoT/.codex/config.toml`.
- Changing the deprecated `[features].use_legacy_landlock` scrubber.
- Changing the retired kit-owned plugin-table or top-level-setting cleanup.
- Changing `--codex-model` or `--codex-effort` deployment behavior.
- Adding or changing `SoT/.codex/rules/*.rules`.
- Changing bubblewrap detection or install guidance.
- Changing retired imported Codex hook cleanup or Codex home resolution.
- Changing the shared TOML line grammar in `tomlLines.ts`.

## Sync Sequence

`codexConfig.ts syncConfig, config staging pipeline`:

1. First install copies SoT config when no deployed file exists.
2. Existing deployed config is copied to a staging file with a leading BOM
   removed and CRLF line ends converted to LF; no backup is written yet.
3. `codexConfig.ts scrubDeprecatedFeatures, staging scrub pass` removes
   `use_legacy_landlock` and an empty `[features]` table. While the SoT
   declares `[features]`, the table merge also drops the key. A broken pass
   then shows only as a missing log line
   (verify: `bun run golden:mutation` fails on a missing
   "Codex: scrubbed deprecated [features].use_legacy_landlock" output line
   when the pass breaks).
4. `codexConfig.ts removeRetiredPluginTables, staging retirement pass` strips
   retired kit-owned plugin tables.
5. `codexConfig.ts removeRetiredTopLevelSettings, staging retired-setting pass`
   drops a top-level line that holds exactly a value listed in
   `codexConfig.ts RETIRED_TOP_LEVEL_SETTINGS`. A different user value stays
   (verify: `bunx vitest run cli/test/unit/codexTomlMerge.test.ts -t "handles a deployed top-level personality"`).
6. `codexToml.ts mergeTopLevelSettings, staging top-level merge` replaces or
   inserts SoT top-level `key = value` lines before the first table
   (verify: `bunx vitest run cli/test/unit/contract-codex-toml.test.ts -t "inserts before the first table when the key is absent"`).
7. `codexToml.ts mergeTableSettings, staging table merge` deletes each
   SoT-declared table from the staging file and appends the SoT block
   (verify: `bunx vitest run cli/test/unit/contract-codex-toml.test.ts -t "replaces the managed table once and keeps user tables"`).
8. A changed staging file backs up and replaces the deployed config; a byte-identical
   staging file is discarded without writing `config.toml.bak`.

`codexConfig.ts removeRetiredPluginTablesText, retired-plugin line transform`
shares `codexConfig.ts PLUGIN_TABLE_HEADER, plugin-table grammar` with
`codexPlugins.ts enabledPluginIdsFromText, enabled-table scan` and checks ids
against `codexConfig.ts RETIRED_PLUGIN_IDS, curated retirement record`. A retired
plugin header starts skipping and is dropped. Skipping ends at the next line
whose first non-blank character is `[` (`tomlLines.ts isTomlHeaderLine`). The
pass does not track continuation lines, so a `[` line inside a multi-line value
also ends skipping. A surviving plugin header both matches the regex and clears
skipping.

`codexConfig.ts removeRetiredPluginTables, staging presence guard` returns before
writing when no retired table is present. The line transform alone returns a
config without a retired table unchanged when the config ends in a newline
(verify: `bunx vitest run cli/test/unit/codexRetiredPlugins.test.ts -t "leaves a config without retired plugin tables byte-identical"`).
Unprobed: no unit test proves the guard itself. Without the guard, the
transform adds a final newline to a file that has none. Read the guard (verify:
`grep -n "present.length === 0" cli/src/engine-native/codexConfig.ts`).
`codexConfig.ts syncConfig, dry-run branch` returns before the staging
pipeline, so this cleanup prints nothing under `--dry-run`.

## Model And Effort Modifiers

`codexSync.ts codexSync, modifier pre-merge` writes the `--codex-model` and
`--codex-effort` values into an in-memory copy of the SoT text with
`replaceTopLevelSetting` before `syncConfig` runs, and reads `deployedBefore`
from the deployed config before the merge. `syncPlugins` receives the
unmodified SoT text. The SoT file never changes (verify:
`grep -n "deployedSotConfig\|deployedBefore\|syncPlugins(ctx, sotConfig" cli/src/engine-native/codexSync.ts`).

`codexToml.ts syncCodexModel, model modifier` and
`codexToml.ts syncCodexEffort, effort modifier` then update only the deployed
top-level `model` or `model_reasoning_effort` line through
`replaceTopLevelSetting`. Their `deployedBefore` argument is the config text
read before the merge: the merge already wrote the modifier value, so only that
earlier text shows whether the modifier changed the setting.
`syncCodexEffort` resolves its value with `efforts.ts resolveEffort`; `default`
resolves to the SoT `model_reasoning_effort`
(verify: `bunx vitest run cli/test/unit/engine-di.test.ts -t "Codex effort modifier"`).
Both modifiers are deploy-only; a later flag-less sync restores the SoT value.

## Rules Deployment

`codexSync.ts syncRules, kit rules manifest` copies kit-managed `*.rules` files
from `SoT/.codex/rules/` and backs up a deployed file that it changes. It
records each deployed file and the sha256 of its kit bytes in
`~/.codex/.kit-managed-rules`. When the SoT drops a recorded file, each sync
removes the deployed copy while it still holds the recorded kit bytes. A
dropped file that the user edited stays, keeps its record, and gets a warning
(verify: `bunx vitest run cli/test/unit/codexRulesDeploy.test.ts -t "Codex rules deploy"`).
`~/.codex/rules/default.rules` is user-learned state. No sync records it, so
sync never reads or removes it (verify:
`bunx vitest run cli/test/unit/codexRulesDeploy.test.ts -t "never removes a rules file the kit did not write"`).
Root `AGENTS.md` (Codex SoT notes) owns the manifest line format and the
`--dry-run` output.

`docks.rules` uses:

```text
prefix_rule(pattern=["cmd", "subcmd"], decision="<allow|prompt|forbidden>")
prefix_rule(pattern=["cmd", ["-a", "-b"]], decision="forbidden", justification="<reason>")
```

A nested list in `pattern` lists alternative tokens for one argv position.
`justification` is optional and states the reason for the decision. When more
than one rule matches, Codex applies the strictest
decision (`forbidden` > `prompt` > `allow`), so an allow rule cannot loosen a
prompt or a forbidden rule.

Prefix rules match argv prefixes, not shell strings. Include enough tokens that
an allowed prefix cannot be turned into a write or exec by a later flag. An
`allow` rule runs the command outside the sandbox without a prompt, so a read
command with a reachable write or exec flag gets no allow rule.
`.agents/skills/codex-config-merge-context/references/rules-format.md` owns the
details and the pointer to the excluded-command list.

## Retired Imported Hooks

`codexHooks.ts removeRetiredImportedHooks, legacy SessionStart cleanup` runs
after `syncConfig`. It removes only `SessionStart` command handlers in
`hooks.json` whose command string exactly equals a retired docks-kit hook
(`RETIRED_CONTEXT_HOOK`, `RETIRED_SKILLS_HOOK`, `RETIRED_CONFIG_HOOKS`, and the
connector hook built from the Codex home). It writes `hooks.json.bak`, then
writes through `atomicWrite.ts replaceFile`. Invalid JSON warns and skips.
Unlike `syncConfig`, it reads the file under `--dry-run` and echoes the count
it would remove. `cli/AGENTS.md` (the Codex `/import` hook note) owns why these
hooks exist.

## Codex Home

`codexPaths.ts codexHome` returns a non-empty `CODEX_HOME` (resolved when
relative), else `<home>/.codex`. Every kit read or write of Codex state goes
through it, with one exception. `tidyReport.ts HISTORIES` measures
`<home>/.codex/sessions` and ignores `CODEX_HOME` (verify:
`git grep -nE "['\"]\.codex(/|['\"])" cli/src` lists only `codexPaths.ts`
and `tidyReport.ts`).

## Bubblewrap

`codexSync.ts ensureBubblewrap` returns early when `codexSync.ts bwrapSupportedOs`
reports no bubblewrap support (macOS, Windows, unknown hosts) and when `bwrap`
is already present. When `bwrap` is missing, it detects a package-manager
install command, runs it, probes `bwrap` again, and then validates unprivileged
user namespaces with `unshare -Ur true`. An existing `bwrap` gets no namespace
probe. Ubuntu AppArmor restrictions can block that probe after install; the
sync warns and continues (verify: `grep -n 'probe("bwrap")\|skipBubblewrap\|unshare' cli/src/engine-native/codexSync.ts`
prints five lines in order: the presence return, the skip branch, the
post-install `bwrap` re-probe, the `unshare` call, and its error warning).

## Key Decisions

- The merge is additive for user-only top-level keys and tables.
- SoT-declared table headers are ownership boundaries; the SoT block wins
  wholesale.
- The top-level line replacer is shared by the SoT merge, the modifier
  pre-merge, `--codex-model`, and `--codex-effort`, so placement fixes cover
  every path.
- Codex config reconcile is not a wholesale reset.

## Gotchas

- SoT ownership is matched by decoded TOML key path, so padded, commented, or
  re-quoted user headers are replaced rather than duplicated.
- Blank-line separators are cosmetic but visible in golden snapshots.
- A user-added table survives only while its key path is absent from the SoT.
- `manifests.ts topLevelTomlString, read-only top-level reader` (callers:
  `modes.ts` model display, `efforts.ts sotEffort`,
  `manifests.ts sotCodexModel`/`deployedCodexModel` for `status`) uses the
  `tomlLines.ts` line grammar (`isTomlHeaderLine`, `keyValueSeparator`,
  `tomlContinuationLines`) that the merge passes use. A change to that grammar
  changes the merge and this reader together. The reader finds a key after a
  multi-line array (verify:
  `bunx vitest run cli/test/unit/manifests.test.ts -t "reads a top-level key after a multi-line array"`).
  It finds a quoted key (verify:
  `bunx vitest run cli/test/unit/manifests.test.ts -t "reads a quoted top-level key"`).
  Unprobed: no unit test covers the undefined result for a dotted or escaped
  key or for a value that is not a string. `manifests.ts tomlKeyName` decodes
  the key (verify: `grep -n -A3 "function tomlKeyName" cli/src/manifests.ts`).
  `topLevelTomlString` accepts only a quoted string value (verify:
  `grep -n "const value = line.slice" cli/src/manifests.ts`).

## References

- `.agents/skills/codex-config-merge-context/references/toml-line-merge.md` - line-transform spec and edge cases.
- `.agents/skills/codex-config-merge-context/references/rules-format.md` - Codex command-policy rule syntax.
