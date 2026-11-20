# omp Plugins And Marketplace

Part of `omp-sync-context`. Read the SKILL.md constraints first.

The kit plugin `docks-kit-omp` ships the docks and plan-lifecycle skills, the
`code-reviewer` and `plan-reviewer` agents, and the `verify-gate` and
`context-tree-nudge` extensions. So sync installs no marketplace plugin. The
plugin pass retires the former `docks@docks` and `plan-lifecycle@docks`
plugins and the `docks` marketplace, installs `pi-intercom`, and links the kit
plugin.

## Plugin And Marketplace Constraints

<constraint>
Read marketplace plugin identity from the composite `id` field, and read the
install scope from `scope`.
omp emits one row per scope that holds the plugin.
Uninstall only a `scope: "user"` row, with `--scope user`: omp needs the scope
when the plugin exists in both scopes.
For a `scope: "project"` row, warn with the manual command
`omp plugin uninstall --scope project <id>` and change nothing in that project.
Read npm plugin identity from `name` plus `version`.
A wrong key makes every run attempt a failing command.
</constraint>

<constraint>
Remove the `docks` marketplace only when no user uninstall failed, and only in
two registry states, because omp copies a legacy config-root registry forward
only when no active registry exists:
the active registry (`<data root>/marketplaces.json`) lists `docks`, or no
active registry exists and the legacy registry (`<config root>/marketplaces.json`)
lists it. A legacy entry beside an existing active registry is stale and starts
no command. `ompPlugins.ts docksRegistryState` reads both files. Only a missing
file counts as no registry: a registry that exists but cannot be read or parsed
gives a warning that names it, and no removal runs.
omp `marketplace.md` says that removing a marketplace "does not uninstall
plugins already cached and registered", so the uninstalls run first.
</constraint>

<constraint>
`ompPlugins.ts syncPlugins` probes omp and git before any spawn. When either
probe reports `missing`, it emits one `warnMissing` message and returns, so a
host that lacks omp records no false failure.
Report a real non-zero omp exit through `failures.ts recordFailure` in
`runPluginCommand`, with the manual command in the message.
Keep `warn` for the missing toolchain pin, the project-scope rows, and the
unavailable inventory.
</constraint>

Verify the constraints:
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "warns about a project-scope row and runs nothing for it"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "removes the marketplace when only the legacy registry lists docks and no active registry exists"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "removes no marketplace when the active registry exists without docks and the legacy registry lists it"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "removes no marketplace after a failed uninstall"`,
and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "deploys config without spawning omp plugins when git is unavailable"`.

## Plugin Inventory Contract

Call `omp plugin list --json` once for inventory before the plugin operations.
Expect top-level `marketplace` and `npm` arrays.
When the inventory shape is invalid or the read fails, warn, skip the
retirement, and give `pi-intercom` and the kit plugin the full refresh path.
The next sync tries the retirement again.

Read each marketplace row from its composite `id` field.
The value already has the `<plugin>@<marketplace>` form.
Compare it with `docks@docks` and `plan-lifecycle@docks`.
Use the same value in the uninstall command.

Read each npm row from `name`, `version`, and `path`.
Use `name` to find `pi-intercom` and the kit plugin `docks-kit-omp`.
Compare the `pi-intercom` `version` with the verified toolchain pin.
Use the exact verified version for installation.
The pin is the `pi-intercom` `verified` field in `SoT/toolchain.json`
(verify: `grep -n '"pi-intercom"' SoT/toolchain.json`).

```ts
// BAD — marketplace rows do not use name as their installed identity, and a
// project-scope row needs a manual uninstall in that project.
const retire = row.name === pluginId

// GOOD — id is the composite plugin token, and scope says where it is installed.
const retire = row.id === pluginId && row.scope === "user"
```

Uninstall each retired id that has a user-scope row.
Install a missing npm plugin even when refreshes are skipped.
Refresh a present npm plugin only when its version differs.
Pass `--force` only when replacing a present npm plugin version.
Link the kit plugin with `omp plugin link <kitPluginDir>` unless its npm row `path` resolves to the real kit plugin directory.
Run the link also under `--skip-plugin-refresh` and when the inventory is unavailable.
Remove the folder `<kit cache>/omp-plugin-upgrades` of the retired upgrade log
in each real sync when it exists.

When at least one plugin operation succeeds, print one summary line that names each operation:
`omp plugins synced: docks@docks uninstalled, plan-lifecycle@docks uninstalled, docks marketplace removed, pi-intercom <version> (new), docks-kit-omp linked`.
Call `omp plugin list --json` one more time only after a pi-intercom install, because only that item shows a version.
An id without a version means the second inventory did not give one.
Do not read the inventory again after only uninstalls, a marketplace removal, or a link, in a dry run, or when omp or git is missing.
Each uninstall sets `ompRestart`, because the retired plugins ship extensions.
`ompKitPlugin.ts syncKitPlugin` adds `(docks-kit-omp <old> -> <new>)` to its line
when the deployed `package.json` had a different version.

Verify the inventory rules:
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "warns and skips the retirement when the inventory cannot be read"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "runs no omp mutation on a second sync after a successful retirement"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "reinstalls pi-intercom with --force when the installed version misses the pin"`,
and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "links the kit plugin again when omp"`.

## Dry Run And Refresh Rules

Guard plugin inventory before its omp subprocess.
Guard every uninstall, marketplace removal, install, and link before its
`ompChild.ts spawnOmp` call.

A dry run prints `[dry-run] omp plugin uninstall --scope user <id>` for both
retired ids, because it reads no inventory.
It prints `[dry-run] omp plugin marketplace remove docks` only when a registry
lists `docks` in one of the two removal states above.
A dry run prints the planned `pi-intercom` install and the kit plugin link.
A dry run does not remove the upgrade-log folder.
A dry run checks PATH for omp and git first. When either tool is missing, the
dry run prints the same single skip warning as a real run and previews no omp
command.
A dry run does not use omp's own `--dry-run` option.

`--skip-plugin-refresh` affects only `pi-intercom`.
Skip npm replacement when any `pi-intercom` version already exists.
Install a missing `pi-intercom` regardless of this flag.
Run the retirement and the kit plugin link regardless of this flag.

| State | Normal sync | With `--skip-plugin-refresh` |
|---|---|---|
| Retired plugin in user scope | Uninstall with `--scope user` | Uninstall with `--scope user` |
| Retired plugin in project scope only | Warn with the manual command | Warn with the manual command |
| `docks` in a removal registry state, no failed uninstall | `marketplace remove docks` | `marketplace remove docks` |
| npm plugin missing | Install pinned version | Install pinned version |
| npm plugin at wrong version | Force pinned version | Skip replacement |
| Kit plugin not linked, or linked elsewhere | `omp plugin link` | `omp plugin link` |

Anchor this behavior at `ompPlugins.ts syncPlugins` and `ompPlugins.ts retireMarketplacePlugins` — dry-run and refresh boundaries.

Verify the dry-run and refresh boundaries:
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "previews no omp command in a dry run when omp is unavailable"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "previews the retirement in a dry run when the registry"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "uninstalls each user-scope retired plugin in"`,
`bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "skips the pi-intercom refresh under --skip-plugin-refresh"`,
and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "still installs a missing pi-intercom under --skip-plugin-refresh"`.
