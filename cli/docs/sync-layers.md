# Sync layers

`docks-kit sync [claude] [codex] [agents] [omp]` — targets are positional
words; no target means this machine's harness selection in
`~/.docks-kit/kit.db`. The default is `claude codex agents`, and
`docks-kit harnesses` changes it.

## claude (→ ~/.claude, ~/.claude.json, shell rc)

Order matters — runtime readiness and settings form one transaction:

1. Resolve/bootstrap pinned Bun, materialize the sentinel settings template,
   and prepare the merged settings bytes without mutation. If Bun remains
   unavailable, omit only the new runtime pointers and preserve legacy ones.
2. When ready, write `bin/statusline.mjs`, `bin/session-start.mjs`,
   `bin/notify.mjs`, and `notification.mp3`; deploy CLAUDE.md; atomically commit
   settings.
3. **settings.json merge semantics** — additive: SoT keys win, permissions arrays are
   unioned, user-only keys survive. `--reconcile` replaces permissions arrays
   wholesale instead.
4. **Removed-artifact pruning** — prune old shell assets, the Stop hook, stale
   kit-owned settings, retired kit-owned plugin enablement, and every
   manifest-listed kit-owned `~/.local/bin` command. A flag-less sync removes
   `advisorModel`; an explicit advisor state excludes only that key so the
   modifier owns it.
5. **Deploy-time modifiers** (`--claude-compact-window`, `--claude-permissive`,
   `--claude-model`, `--claude-effort`, `--claude-advisor`) — deployed file only.
6. ~/.claude.json (showTurnDuration, user-scoped MCP servers) and connector env
   export.
7. **Plugins** — seven idempotent passes via the `claude plugin` CLI
   (marketplaces → install → update → [--prune: uninstall/remove] → re-assert
   SoT enabled-state). Optional opt-ins via `--claude-plugin=<name>`.
8. LSP server binaries (npm globals plus the rust-analyzer rustup component).

The statusline reads Claude's native `rate_limits`. There is no OAuth request,
usage cache, jq/curl runtime dependency, or Stop fetch hook.

## codex (→ Codex home, ~/.agents/plugins)

bubblewrap bootstrap (Linux): when `bwrap` is missing, sync runs
`sudo apt-get|dnf|pacman|zypper install bubblewrap` (a sudo prompt may appear)
and then probes unprivileged user namespaces; `--skip-bubblewrap` only warns,
and `--dry-run` only prints the step. Then config.toml merge (top-level keys
replaced per-key, [table] blocks replaced wholesale, user-only keys/tables
preserved, and retired kit-owned `[plugins."<id>"]` tables stripped),
`--codex-model` then `--codex-effort` modifiers, rules, AGENTS.md, personal
marketplace file, and `codex plugin add` refresh.

The Codex home is `$CODEX_HOME` when that variable is set and not empty, else
`~/.codex`. Like Codex, the kit resolves a relative `CODEX_HOME` against the
current directory. Every kit read or write of Codex state uses this directory.

## agents (→ ~/.agents/skills, ~/.claude/skills symlinks)

`npx skills add` per missing manifest slug, Claude symlink healing, and the
kit-managed snapshot that `--prune` reconciles against.

## omp (→ resolved agent dir, intercom root)

AGENTS.md, mcp.json, and intercom config.json are whole-file deploys.
config.yml and models.yml are deep-merged (SoT keys win, mapping nodes merge,
deployed-only keys survive; config.yml also drops stale slash-bearing
`retry.fallbackChains` wildcards). A SoT list replaces the deployed list, except
config.yml `bash.patterns`: the merge keeps user rules and groups all rules as
kit deny, user deny, user prompt, kit prompt (the kit ships none since 0.22.8),
other user rules, and kit allow, so no allow loosens a deny or a prompt (see
`docks-kit docs command-guards`). After each merge, every sync (no
`--reconcile` needed) force-prunes the `ompRemovals.ts` retired-key inventory:
the retired kit `bash.patterns` rules in `OMP_RETIRED_BASH_RULES` (exact
`match` and `approval` pairs, including the 492 former kit prompt rules
retired in 0.22.8), config.yml keys whose deployed value still equals the value the kit used to
ship, `providers.webSearchOrder` at any value, and the retired
`anthropic.modelOverrides.claude-opus-5-5` block in models.yml while it still
matches the shipped block.
Directories are mode 0700 and files mode 0600. Then the `docks` marketplace is
registered, `docks@docks` and `plan-lifecycle@docks` are installed or upgraded
through `omp plugin`, and `pi-intercom` is installed at its
`SoT/toolchain.json` pin. Inventory comes from `omp plugin list --json`, where a
marketplace row counts as installed only when its `scope` is `user`, so a repeat
run is a no-op and a project-only row still installs. When just the legacy
config-root registry lists `docks`, omp copies it forward itself: the sync runs
`marketplace update`, or the read-only `marketplace list` under
`--skip-plugin-refresh`, which keeps installs but fetches nothing. After a
plugin operation, the sync reads the inventory again and prints one line that
names each plugin with its version change, for example
`omp plugins synced: docks@docks 0.21.1 -> 0.22.0, pi-intercom 0.14.0 (new), docks-kit-omp linked`.
omp deletes the previous plugin folder on `omp plugin upgrade`. A running omp
session then loses the plugin agents of that folder. A test on omp 18.16.0
showed that `/reload-plugins` brings the agents back, and that `skill://`
resolves to the new folder (#139). The omp marketplace docs still ask for a
restart for hooks, extension modules, and non-MCP tools. For each marketplace
upgrade that changed the version, the sync prints a warning, for example
`omp plugin docks@docks 0.21.1 -> 0.22.0: running omp sessions lose its plugin agents until they run /reload-plugins and read its skills again through skill:// (restart omp instead when the plugin ships hooks, extension modules, or non-MCP tools).`
The next step then says
`Run /reload-plugins in each running omp session, then read each plugin skill again through skill://. Restart omp instead when an upgraded plugin ships hooks, extension modules, or non-MCP tools.`
A version-changing upgrade does not set the restart trigger. Each other plugin
operation sets it: an install, a reinstall at the same version, an npm install,
or a link. A changed kit plugin file or omp config file also sets it. The
restart next step `Restart omp to load any refreshed plugins, skills, or tools.`
then prints next to the upgrade rule.
The sync also writes one event file for each such upgrade into the upgrade log
`~/.cache/docks-kit/omp-plugin-upgrades/` (folder 0700, files 0600). The file
name is `<finishedAt ms>-<random>.json`, and the file holds
`{"version":1,"id":"<id>","before":"<v>","after":"<v>","finishedAt":"<ISO time>"}`.
`finishedAt` is the time just after the upgrade command returned. Each sync
writes only new files, through a temporary name and a rename, so concurrent
syncs keep all events. Then it removes the oldest files beyond the newest 100.

If the inventory read after the operations fails, the sync cannot see the new
versions. It then warns
`omp plugin versions could not be read after the upgrade — each upgraded plugin counts as changed`.
Each upgrade of a present marketplace plugin then counts as a change. It gets
the warning and an event with the after version `unknown`, for example
`docks@docks 0.21.1 -> unknown`.

A failed write or prune of the upgrade log does not fail the sync, because it
is not a harness CLI operation. A failed write warns
`omp plugin upgrade log not written: <error> — running omp sessions get no reminder for these upgrades; give each of them the advice above`.
The summary line, the upgrade warnings, and the next steps stay. A failed prune
keeps the new events and warns
`omp plugin upgrade log not pruned: <error> — it can keep more than 100 event files`.

The kit plugin extension `pluginUpgrades.ts` reads the upgrade log. In each
tool result of a main omp session, it takes the events that finished after
its omp process started. It adds one reminder for the events that the session
did not get before. The reminder names each plugin with its version change. It
says that the plugin agents of the session may fail. It tells the agent to ask
the user to run `/reload-plugins`, then to read each plugin skill again through
`skill://` before it runs a skill script. It asks for a restart instead when an
upgraded plugin ships hooks, extension modules, or non-MCP tools. A folder or
file that the extension cannot read gives no reminder for that tool result.
The next tool result reads it again.
These limits apply:

- omp imports extension modules only at startup. An omp process that started
  before a sync deployed `pluginUpgrades.ts` did not load it. Its sessions get
  no reminder, also for the upgrades of that sync.
- An upgrade that `docks-kit sync` did not run gives no reminder, for example
  `omp plugin upgrade` by hand.
- The warning, the next step, and the reminder assume that the session loaded
  the user-scope install. omp keeps an old cache folder that a known project
  registry still uses. So a session on a project-scope install keeps its
  folder. For this reason, the reminder says "may".
- An omp process that started during the upgrade can get a reminder that it
  does not need. A reload or a restart is harmless.
- The log keeps the newest 100 events. A session that stays idle through more
  than 100 later upgrades loses the oldest ones.

A dry run invokes no omp subcommand and writes no upgrade event.

Paths mirror upstream `dirs.ts` `DirResolver`, resolved from the environment
plus directory probes, so a dry run still runs no omp subcommand. The agent
directory is `<config root>/agent`, where the config root is
`~/<PI_CONFIG_DIR or .omp>` plus `profiles/<name>` under an active profile
(`OMP_PROFILE`, else legacy `PI_PROFILE`). For the default profile only,
`PI_CODING_AGENT_DIR` replaces the agent directory outright. The agent
directory never moves under XDG. Only the data root that holds
`marketplaces.json` does: on Linux and macOS, with no agent-dir override
active, an existing `$XDG_DATA_HOME/omp` (or `$XDG_DATA_HOME/omp/profiles/<name>`
for a named profile) is adopted. The intercom file keeps pi-intercom's own
root: `$PI_CODING_AGENT_DIR/intercom`, else `~/.pi/agent/intercom`.

## Reconcile flags

- `--reconcile` — settings layer: SoT-declared keys win; user-only preserved.
- `--prune` — plugins + marketplaces + kit-managed skills not in SoT are removed.
- Combine for a full reset to the SoT's kit-managed scope.
