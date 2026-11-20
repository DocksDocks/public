# Flag Matrix - docks-kit sync

This file is the only flag table for this skill. `parseArgs.ts parseArgs` owns
the engine vocabulary and `cli/src/commands/sync.ts syncCommand` owns the public
options (verify: `grep -n 'case "--' cli/src/engine-native/parseArgs.ts`).

## Critical Constraints

- `sync` takes no positional word. On the public CLI, `effect/cli` refuses a
  word with `Unexpected positional argument: "<word>"` and exit 1. The engine
  parser refuses it with `Unknown arg: <word>` and exit 2.
- Unknown flags exit 2 before mutation. The removed `--prune`, `--agents`,
  `--omp`, and `--remove-plugins` get the plain unknown-flag refusal.
- Every sync flag is a boolean. A value such as `--dry-run 0` or
  `--dry-run=false` exits 2 on the public CLI; the engine parser has no
  `--flag=value` arm, so it exits 2 with `Unknown arg`.
  (verify: `bunx vitest run cli/test/unit/argv.test.ts -t "rejects a separate numeric literal after the dry-run boolean"` and `bunx vitest run cli/test/unit/removedNames.test.ts -t "refuses each sync target word as an unexpected positional argument"`)

## Flags

| Flag | `Ctx` field | Consumer | Notes |
|------|-------------|----------|-------|
| `--dry-run` | `ctx.dryRun` | every step | Preview only. Also skips the sync lock and the folder locks. |
| `--verbose` | `ctx.verbose` | `index.ts runEngineNative` logger | Also prints no-op confirmations. The public `sync` command also accepts `-v`. |
| `--skip-plugin-refresh` | `ctx.skipPluginRefresh` | `ompPlugins.ts syncPlugins` | Installs a missing `pi-intercom` but keeps a present one at its installed version. The retirement of the former `docks` marketplace plugins and the kit plugin link still run. No command passes it automatically: `commands/update.ts` (`updateCheckout`, `updatePackage`) chains a flag-less sync. |

(verify: `bunx vitest run cli/test/unit/engine-di.test.ts -t "lists the global flags in sync help and no sync target"` and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "skips the pi-intercom refresh under --skip-plugin-refresh"`)

Every sync runs the omp pipeline. `omp-sync-context` owns the merge, removal,
and plugin rules. Sync has no removal flag: the omp retired-key passes run on
every sync.
