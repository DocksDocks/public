# Sync layers

`docks-kit sync` deploys the omp SoT. It takes no positional target. Sync
writes no `.agents` or `.claude` folder of its own; omp's folders follow
`PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `XDG_DATA_HOME`, so an override
that points into one of those folders makes omp's files go there. omp uses
`XDG_DATA_HOME` only on Linux and macOS, only while `PI_CODING_AGENT_DIR`
does not move the agent folder, and only after the omp folder under it
exists. Sync also writes the kit plugin to `~/.docks-kit/omp-plugin`.

## omp (→ resolved agent dir, intercom root)

AGENTS.md, mcp.json, and intercom config.json are whole-file deploys.
config.yml and models.yml are deep-merged (SoT keys win, mapping nodes merge,
deployed-only keys survive; config.yml also drops stale slash-bearing
`retry.fallbackChains` wildcards). A SoT list replaces the deployed list, except
config.yml `bash.patterns`: the merge keeps user rules and groups all rules as
kit deny, user deny, user prompt, kit prompt (the kit ships none since 0.22.8),
other user rules, and kit allow, so no allow loosens a deny or a prompt (see
`docks-kit docs command-guards`). After each merge, every sync (no flag
needed) force-prunes the `ompRemovals.ts` retired-key inventory:
the retired kit `bash.patterns` rules in `OMP_RETIRED_BASH_RULES` (exact
`match` and `approval` pairs, including the 492 former kit prompt rules
retired in 0.22.8), config.yml keys whose deployed value still equals the value the kit used to
ship, `providers.webSearchOrder` at any value, and the retired
`providers.anthropic.modelOverrides.claude-opus-5-5` block in models.yml while
it still matches the shipped block.
Directories are mode 0700 and files mode 0600. Then the plugin pass reads the
inventory from `omp plugin list --json`, tries to retire the former marketplace
plugins (user-scope installs only; see below), installs `pi-intercom` at its
`SoT/toolchain.json` pin, and links the kit plugin `docks-kit-omp`.

The kit plugin now ships the docks and plan-lifecycle skills, the
`code-reviewer` and `plan-reviewer` agents, and the `verify-gate` and
`context-tree-nudge` extensions. So sync installs no plugin from the `docks`
marketplace. Each real sync tries to retire the former marketplace plugins.
When the inventory cannot be read, it warns and skips this step; a later sync
tries again. Otherwise:

- For each of `docks@docks` and `plan-lifecycle@docks` with a `scope: "user"`
  inventory row, it runs `omp plugin uninstall --scope user <id>`.
- For each `scope: "project"` row of these ids, it changes nothing in that
  project and warns
  `omp plugin <id> is installed at project scope and docks-kit no longer ships it; run from that project: omp plugin uninstall --scope project <id>`.
- When no user uninstall failed, it runs `omp plugin marketplace remove docks`
  if the active registry (`<data root>/marketplaces.json`) lists `docks`, or
  if no active registry exists and the legacy config-root registry lists it.
  omp copies the legacy registry forward only when no active registry exists,
  so a legacy entry beside an active registry is stale and starts no command.
- A failed uninstall or removal goes to the failure ledger with the manual
  command, for example
  `omp plugin operation failed for docks@docks: <detail>; run manually: omp plugin uninstall --scope user docks@docks`.
- When the inventory cannot be read, the sync warns
  `omp plugin inventory unavailable — retirement of the docks marketplace plugins skipped until the next sync; pi-intercom and the kit plugin take the full refresh path`.
- The sync removes the folder `~/.cache/docks-kit/omp-plugin-upgrades/` of the
  retired plugin upgrade log when it exists.

`--skip-plugin-refresh` does not skip the retirement or the kit plugin link. It
only keeps a present `pi-intercom` at its installed version. A repeat run after
a successful retirement runs no uninstall and no removal.

After a plugin operation, the sync prints one line that names each operation,
for example
`omp plugins synced: docks@docks uninstalled, plan-lifecycle@docks uninstalled, docks marketplace removed, pi-intercom 0.14.0 (new), docks-kit-omp linked`.
Each uninstall sets the restart next step
`Restart omp to load any refreshed plugins, skills, or tools.`, because the
retired plugins ship extensions, and omp loads extensions only at startup. An
npm install, a link, and a changed kit plugin file or omp config file also set
it.

A dry run invokes no omp subcommand. It prints
`[dry-run] omp plugin uninstall --scope user docks@docks` and the same line
for `plan-lifecycle@docks`, and
`[dry-run] omp plugin marketplace remove docks` when a registry lists `docks`.

Paths mirror upstream `dirs.ts` `DirResolver`, resolved from the environment
plus directory probes, so a dry run still runs no omp subcommand. The agent
directory is `<config root>/agent`, where the config root is
`~/<PI_CONFIG_DIR or .omp>` plus `profiles/<name>` under an active profile
(`OMP_PROFILE`, else legacy `PI_PROFILE`). For the default profile only,
`PI_CODING_AGENT_DIR` replaces the agent directory outright. The agent
directory never moves under XDG. Only the data root that holds
`marketplaces.json` does: on Linux and macOS, with no agent-dir override
active, an existing `$XDG_DATA_HOME/omp` (or `$XDG_DATA_HOME/omp/profiles/<name>`
for a named profile) is adopted. Under a named profile, the intercom file goes
into `<agent directory>/intercom`. Otherwise it goes into
`$PI_CODING_AGENT_DIR/intercom` when that variable is set, else
`~/.pi/agent/intercom`.

## Additive by default

Sync has no removal flag. A key, plugin, or file that only the user added
stays. Three passes remove kit content on every sync: the `ompRemovals.ts`
retired-key inventory above, the kit plugin pass, which removes stale files
from the kit-owned `~/.docks-kit/omp-plugin`, and the retirement of the former
marketplace plugins above, which earlier kit versions installed.
