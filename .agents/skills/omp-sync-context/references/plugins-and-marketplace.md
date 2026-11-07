# omp Plugins And Marketplace

Part of `omp-sync-context`. Read the SKILL.md constraints first.

## Plugin And Marketplace Constraints

<constraint>
Read marketplace plugin identity from the composite `id` field, and count a row
as installed only when its `scope` is `user`.
omp emits one row per scope holding the plugin, so a project-only match leaves
the user scope empty and `upgrade --scope user` fails.
Read npm plugin identity from `name` plus `version`.
A wrong key makes every run attempt a failing reinstall.
</constraint>

<constraint>
Treat three marketplace states, because omp copies a legacy config-root
registry forward when it first resolves an XDG data root: the active registry
lists docks, only the legacy registry lists it, or neither does.
Register with `marketplace add` only in the third state.
In the second state let omp perform the copy: `marketplace update` normally,
and the read-only `marketplace list` under `--skip-plugin-refresh`, which never
fetches.
</constraint>

<constraint>
`ompMarketplace.ts syncMarketplace, probe guard` returns before any spawn when the omp
or git probe reports `missing`, because it runs before `syncPlugins` holds those
probes. Without the guard a host that lacks omp records a false marketplace
failure and the sync exits 1. Print no second skip line there: `syncPlugins`
already emits the single `warnMissing` message.
Report a real non-zero omp exit through `failures.ts recordFailure`, in
`syncMarketplace` and in `runPluginCommand`. Keep `warn` for the missing
toolchain pin and the unavailable-inventory fallback.
</constraint>

Verify the constraints:
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "installs a plugin whose only row is project-scoped"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "registers docks when neither XDG nor the legacy registry lists it"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "refreshes the marketplace when only the legacy registry lists docks"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "adopts the registry with a read-only list under --skip-plugin-refresh"`,
and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "deploys config without spawning omp plugins when git is unavailable"`.

## Plugin Inventory Contract

Call `omp plugin list --json` once for inventory before the plugin operations.
Expect top-level `marketplace` and `npm` arrays.
Return the fallback refresh path when the inventory shape is invalid.

Read each marketplace row from its composite `id` field.
The value already has the `<plugin>@<marketplace>` form.
Compare it with `docks@docks` and `plan-lifecycle@docks`.
Use the same value for install and upgrade commands.
A marketplace row has no top-level version. Read the version from the first
`entries[]` item that has a string `version`.
Accept the row only when its `scope` is `user`, because omp reports one row per
scope and `upgrade --scope user` fails while the user scope is empty.

Read each npm row from `name`, `version`, and `path`.
Use `name` to find `pi-intercom` and the kit plugin `docks-kit-omp`.
Compare the `pi-intercom` `version` with the verified toolchain pin.
Use the exact verified version for installation.
The pin is the `pi-intercom` `verified` field in `SoT/toolchain.json`
(verify: `grep -n '"pi-intercom"' SoT/toolchain.json`).

```ts
// BAD — marketplace rows do not use name as their installed identity.
const present = row.name === pluginId

// GOOD — id is the composite install and upgrade token, and scope says where
// the plugin is active.
const present = row.id === pluginId && row.scope === "user"
```

Install a missing marketplace plugin with user scope.
Upgrade a user-scope marketplace plugin unless refreshes are skipped.
Install a missing npm plugin even when refreshes are skipped.
Refresh a present npm plugin only when its version differs.
Pass `--force` only when replacing a present npm plugin version.
Link the kit plugin with `omp plugin link <kitPluginDir>` unless its npm row `path` resolves to the real kit plugin directory.
Run the link also under `--skip-plugin-refresh` and when the inventory is unavailable.

When at least one plugin operation succeeds, call `omp plugin list --json` one
more time and print one summary line that names each operation:
`omp plugins synced: docks@docks <old> -> <new>, plan-lifecycle@docks <version> (current), pi-intercom <version> (new), docks-kit-omp linked`.
An id without a version means the second inventory did not give one.
Do not read the inventory again when no operation ran, in a dry run, or when omp or git is missing.
`ompKitPlugin.ts syncKitPlugin` adds `(docks-kit-omp <old> -> <new>)` to its line
when the deployed `package.json` had a different version.

Verify the inventory rules:
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "falls back to the full refresh path when the inventory cannot be parsed"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "reinstalls pi-intercom with --force when the installed version misses the pin"`,
and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "links the kit plugin again when omp"`.

## Dry Run And Refresh Rules

Guard the marketplace command before every `spawnProcess("omp", ...)` call.
Guard plugin inventory before its omp subprocess.
Guard install and upgrade operations before their omp subprocesses.

A dry run prints the marketplace command only when the active registry lacks
docks: `add` when no registry lists it, `update` when only the legacy registry
does, and `list` in that same state under `--skip-plugin-refresh`.
A dry run prints all planned plugin installations.
A dry run does not probe plugin inventory through omp.
A dry run checks PATH for omp and git first. When either tool is missing, the
dry run prints the same single skip warning as a real run and previews no omp
command.
A dry run does not use omp's own `--dry-run` option.

`--skip-plugin-refresh` does not mean skip plugins.
Skip marketplace updates when the marketplace already exists.
Skip marketplace plugin upgrades when each plugin already exists.
Skip npm replacement when any `pi-intercom` version already exists.
Install every missing plugin regardless of this flag.

| State | Normal sync | With `--skip-plugin-refresh` |
|---|---|---|
| Marketplace absent from both registries | Register with `add` | Register with `add` |
| Marketplace only in the legacy registry | Adopt with `update` | Adopt with the non-fetching `list` |
| Marketplace in the active registry | Update | Skip update |
| Marketplace plugin missing from user scope | Install | Install |
| Marketplace plugin present in user scope | Upgrade | Skip upgrade |
| npm plugin missing | Install pinned version | Install pinned version |
| npm plugin at wrong version | Force pinned version | Skip replacement |
| Kit plugin not linked, or linked elsewhere | `omp plugin link` | `omp plugin link` |

Anchor this behavior at `ompMarketplace.ts syncMarketplace` and `ompPlugins.ts syncPlugins` — dry-run and refresh boundaries.


Verify the dry-run and refresh boundaries:
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "previews no omp command in a dry run when omp is unavailable"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "skips every refresh of present plugins under --skip-plugin-refresh"`,
and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "still installs a missing plugin under --skip-plugin-refresh"`.
