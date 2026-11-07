# omp YAML Merge

Part of `omp-sync-context`. Read the SKILL.md constraints first.

## YAML Merge Contract

Build the result on the Source of Truth document: Source of Truth keys win
every conflict and keep their order, and each deployed-only key is appended
after the Source of Truth keys of its mapping.
Merge mapping nodes recursively when both sides contain mappings.
Replace every other Source of Truth node, including scalars and sequences.
The one exception is the `bash.patterns` sequence in `config.yml`:
`ompYaml.ts mergeBashPatterns` keeps the user's command rules and groups all
rules by approval.
Preserve deployed-only keys by default.
`ompFileDeploy.ts syncMergedYaml`, shared YAML deployment, receives the file-specific
merge as an argument: `mergeOmpConfig` for `config.yml` and `mergeOmpModels`
for `models.yml`. Both wrap `ompYaml.ts mergeYamlDocuments`, the generic
mapping merge, and name their file in every diagnostic.

`mergeOmpModels` drops nothing. A user `models.yml` may carry provider
credentials and custom models the kit never declares.

`mergeOmpConfig` prunes one deployed-only key class.
Inspect keys directly under `retry.fallbackChains`.
Drop each key containing a slash character.
Preserve unknown role keys without a slash.

A slash-bearing key names a model or provider wildcard.
omp resolves that wildcard before role chains.
A stale wildcard can shadow every kit-managed role chain.

Keep the exception at the direct `retry.fallbackChains` level.
Do not prune slash-bearing keys from unrelated mappings.
Validate both YAML roots as mappings when the deployed document is non-empty.
Return Source of Truth text when the deployed document is empty.
Reject invalid deployed YAML without writing the target.

| Node relationship | Result |
|---|---|
| Both nodes are mappings | Merge recursively. |
| Source of Truth node is scalar or sequence | Replace the deployed node. |
| `config.yml` `bash.patterns` sequence | Keep user rules; order kit deny, user deny, user prompt, kit prompt, other user rules, kit allow. |
| Key exists only in deployed content | Preserve it. |
| Direct fallback-chain key contains `/` | Prune it. |
| Unknown fallback role has no `/` | Preserve it. |

Anchor this behavior at `ompYaml.ts` — `mergeOmpConfig` — fallback wildcard predicate over the shared merge.
Do not replace this parser with a line-based YAML merge.

Verify the merge:
`bunx vitest run cli/test/unit/ompYamlMerge.test.ts -t "drops deployed-only slash keys under retry.fallbackChains while keeping role siblings"`,
`bunx vitest run cli/test/unit/ompYamlMerge.test.ts -t "keeps a deployed-only slash key outside retry.fallbackChains"`,
`bunx vitest run cli/test/unit/ompYamlMerge.test.ts -t "throws for invalid deployed YAML"`,
and `bunx vitest run cli/test/unit/ompBashPatterns.test.ts -t "puts user denies and prompts ahead of every kit allow"`.

## Retired-Entry Prune

The merges are additive, so a key or rule removed from `SoT/.omp/config.yml`
or `SoT/.omp/models.yml` stays in the deployed file.
`ompSync.ts ompSync` runs `ompRemovals.ts syncOmpRemovals` after the
`config.yml` merge and `syncOmpModelRemovals` after the `models.yml` merge,
on every sync, without `--reconcile`.
Each pass deletes only entries from the inventories in `ompRemovals.ts`:
`OMP_RETIRED_VALUES` (only while the deployed value still equals the value
the kit shipped), `OMP_RETIRED_KEYS`, the retired `bash.patterns` rules in
`OMP_RETIRED_BASH_RULES` and `RETIRED_PROMPT_MATCHES`, and
`OMP_RETIRED_MODEL_BLOCKS` (only while the deployed block is unchanged).
Add a retired rule to `OMP_RETIRED_BASH_RULES` or `RETIRED_PROMPT_MATCHES`.
Do not edit `OMP_RETIRED_BASH_KEYS`, because it is a lookup map that
`ompRemovals.ts` derives from `OMP_RETIRED_BASH_RULES`.
`ompRemovals.ts deletePath` also removes each ancestor mapping that a deletion
leaves empty.
It keeps a section-header comment above the deleted key. The header moves onto
the next key, or becomes the mapping's trailing comment when no key follows.
A dry run prints `[dry-run] prune` with the entry names and writes nothing.
An unparseable file gets a warning and stays untouched.

`ompRemovals.ts pruneRetired` follows the deployment rules in SKILL.md. It
writes through `atomicWrite.ts replaceFile` with mode `0600`, so a symlinked
target stays a link. It makes a backup with `ompFileDeploy.ts backupPrivateFile`
only when the merge of the same sync did not write `<file>.bak`:
`ompFileDeploy.ts syncMergedYaml` returns `true` when it wrote the backup, and
`ompSync` passes that value to the prune. Thus `<file>.bak` keeps the pre-sync
bytes, not the merged bytes.

Verify the prune:
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "runs as part of ompSync, after the additive config merge"`,
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "keeps a retired key the user changed away from the shipped value"`,
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "removes a mapping emptied by pruning and keeps one that still holds a key"`,
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "keeps a carried header when the pruned key was last in its mapping"`,
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "keeps a carried header inside the mapping it came from"`,
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "reports the count under dry run and leaves the file byte-identical"`,
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "backs up a pruned config.yml and keeps mode 0600"`,
and `bunx vitest run cli/test/unit/ompRemovals.test.ts -t "keeps the pre-sync backup when the merge and the prune both change config.yml"`.
