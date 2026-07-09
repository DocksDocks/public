---
name: engine-native-context
description: "Use when modifying cli/src/engine-native, cli/src/engine.ts, cli/src/main.ts native-raw harness path, cli/test/golden-dryrun.ts, cli/test/golden-mutation.ts, cli/test/lib/harness.ts, or cli/test/goldens; covers the golden-regression contract, the removed-engine failure for DOCKS_KIT_ENGINE value bash, p() slash-join rule, ExitError aborts, jq/TOML compatibility helpers, prove-red, GOLDEN_FILTER, and Windows spawn/path specifics."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/index.ts
      lines: "1-140"
    - path: cli/src/engine.ts
      lines: "1-120"
    - path: cli/test/golden-dryrun.ts
      lines: "1-220"
    - path: cli/test/golden-mutation.ts
      lines: "1-360"
    - path: cli/test/lib/harness.ts
      lines: "1-320"
  updated: "2026-07-09"
---

# EngineNative Golden Contract

EngineNative is the only supported engine. The deleted shell engine is preserved
only at the `bash-engine-final` tag for archaeology; `DOCKS_KIT_ENGINE` value `bash`
must fail with the removed-engine message instead of selecting another runtime.

<constraint>
Golden tests are the regression contract. Any EngineNative behavior change must
either keep `bun run golden:dryrun` and `bun run golden:mutation` green or update
goldens deliberately with `--update-goldens` and a reviewed diff.
</constraint>

<constraint>
`--prove-red` must stay red. A harness that cannot detect planted mismatches is
not a regression test.
</constraint>

<constraint>
Build output-visible paths with `p()` from `exec.ts`, not `node:path.join`.
Engine output is snapshotted and must use forward slashes across platforms.
</constraint>

<constraint>
Use `ExitError` for intentional engine aborts and validation failures. Swallowing
a failed child process turns a real sync failure into a success log.
</constraint>

## Golden Suites

| Suite | Script | Records |
|-------|--------|---------|
| Dry-run | `bun run golden:dryrun` | Normalized output for fixture and command combinations. |
| Mutation | `bun run golden:mutation` | Resulting file trees, backups, argv logs, output, and TOML invariants. |

`--update-goldens` regenerates snapshots from the live native engine.
`GOLDEN_FILTER=<regex>` scopes a run. Golden files live in `cli/test/goldens/`.

## Harness Geometry

- Public CLI paths route through `cli/src/engine.ts`.
- `DOCKS_KIT_ENGINE=native-raw` is harness-private and bypasses Effect CLI
  parsing so tests can feed raw argv.
- In a compiled Bun binary, `engineCapture` re-spawns `process.execPath` with
  args only; do not pass the source entry path as an argument.
- Stubs record child-process argv so command shape is part of the contract.

## Compatibility Semantics

- `deepMerge` mirrors jq object `*`: recursive object merge, right operand wins,
  arrays replace.
- `uniqueStrings` mirrors jq `unique`: codepoint sort plus dedup.
- `jqStringify` is two-space JSON with a trailing newline.
- jq `//` treats `null` and `false` as fallback triggers; do not port it as only
  nullish behavior.
- TOML transforms stay line-based; using a TOML library would reformat user
  config and break snapshots.

## Windows Specifics

- `which()` is PATHEXT-aware.
- HOME falls back to `os.homedir()` when `HOME` is unset, which covers
  `%USERPROFILE%` on Windows.
- Golden normalization canonicalizes CRLF to LF and scrubs temp paths.
- POSIX shebang stubs stay POSIX-only; Windows coverage comes from native
  PowerShell CI and entrypoint smoke jobs.

## Gotchas

- A deliberate output text change can break many dry-run goldens at once. Use
  `GOLDEN_FILTER` to localize first, then update snapshots deliberately.
- Tests that mutate temp HOME are fine; do not run real syncs against the user's
  live home as part of golden maintenance.
- Keep the removed-engine failure covered. Silent native fallback when
  `DOCKS_KIT_ENGINE` is set to `bash` violates the removal contract.
