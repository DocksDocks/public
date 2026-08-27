# docks-kit

Portable configuration kit for AI coding agents. Per-tool **Single Source of
Truth (SoT)** directories deploy to each tool's user-config location. Clone
once to get a consistent AI-assisted environment on supported Linux, macOS,
and Windows machines. Tuned for **token efficiency without sacrificing quality**.

Supported harnesses: **Claude Code**, **Codex**, and **Oh My Pi (`omp`)**.
The kit also deploys [agentskills.io](https://agentskills.io) universal skills.

## Quick start

```bash
git clone https://github.com/DocksDocks/public.git ~/projects/public
cd ~/projects/public
./docks-kit harnesses       # choose this machine's flag-less sync harnesses
./docks-kit sync            # deploy this machine's harness selection
./docks-kit sync omp        # deploy omp explicitly
./docks-kit status          # doctor view: drift, toolchain, plugins, skills
```

POSIX hosts use the `./docks-kit` launcher on x64 and arm64. Windows uses
`.\docks-kit.ps1` on x64 and arm64. Each launcher prefers the matching compiled
binary in `cli/dist/` only when its version matches the checkout. Otherwise it
runs from source via Bun and auto-installs Bun plus dependencies when needed.
Hosts outside this matrix fail immediately and never fall back to Bun source.
Stale ignored build artifacts cannot mask newer checkout code.

Other install paths include global `bun add -g docks-kit`, the POSIX curl
installer, and the Windows PowerShell installer. See `./docks-kit docs install`.

**No-Bun recovery path**:

Download the platform release binary from GitHub Releases and run it directly.
The executable carries the generated sync payload; no checkout or adjacent
`SoT/` directory is required.

Source and global installs require Bun. npm-global tools require Node/npm.
`jq` is optional doctor/test tooling. `curl` downloads Bun only when a source
launcher needs it. POSIX runs `install.sh`; Windows runs `install.ps1` through
PowerShell.

## CLI

```text
docks-kit sync [claude] [codex] [agents] [omp]  deploy explicit targets or the machine selection
docks-kit harnesses                             view or change this machine's selection
docks-kit update [--no-sync]                    self-update the kit (autodetects checkout vs global install), then sync
docks-kit model <claude|codex> [value]          get/set the DEPLOYED model (TTY picker)
docks-kit models [claude|codex]                 model catalogs (`--json`)
docks-kit toolchain [check|ensure <tool>]       verified-version floors for external tools
docks-kit status [--json]                       deployed-vs-SoT drift + toolchain + counts
docks-kit plugins list [--json]                 enabledPlugins tri-state vs installed
docks-kit skills list [--json]                  universal skills vs manifest
docks-kit docs [topic]                          self-documentation (9 topics)
--help --version --wizard --completions    built-in
```

The CLI is a typed Effect 4 RC front-end on Bun; all mutation runs through
EngineNative in `cli/src/engine-native/`, with golden-regression coverage for
dry-run output, mutation snapshots, and argv logs. Its dependency graph is
`effect@4.0.0-rc.109` (including `effect/unstable/cli`),
`@effect/platform-bun@4.0.0-rc.109` (`BunServices.layer` and
`BunRuntime.runMain`), `@effect/vitest@4.0.0-rc.109`, and `vitest@4.1.10`
(required by the `@effect/vitest` peer range). `@effect/cli` and
`@effect/platform` are removed: neither has a 4.x release, the CLI API moved
into core, and the standalone platform package was unused here.

### Key flags (`docks-kit sync`)

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview without applying |
| `--reconcile` | Reconcile kit-owned settings toward SoT (user-only keys preserved) |
| `--prune` | Uninstall kit-managed plugins/marketplaces/skills not in SoT |
| `--claude-model=<m>` | Deploy-time modifier: deployed Claude model |
| `--claude-compact-window=<n>` | Deploy-time modifier: autocompact window (`680k`) |
| `--claude-permissive` | Deploy-time modifier: empty ask/deny (sandboxes only) |
| `--claude-plugin=<name>` | Sticky opt-in plugin (supabase, n8n) |
| `--codex-model=<m>` | Deploy-time modifier: deployed Codex model |
| `--skip-bubblewrap` | Skip optional bubblewrap bootstrap (Codex Linux sandbox) |
| `--skip-plugin-refresh` | Install missing plugins but skip refresh-only updates (used automatically by `docks-kit update`) |

**Deploy-time modifiers** change deployed config only — the SoT is untouched
and a later flag-less sync reverts them. Full reference: `docks-kit docs flags`
(includes the old→new rename table for the pre-CLI `sync.sh` flags).

## How syncing works

- **Additive by default** — user-only settings keys, plugins, and skills
  survive a plain sync. Reconciliation toward the SoT is explicit
  (`--reconcile` / `--prune`).
- **Per-machine selection** — `~/.docks-kit/state.json` drives a flag-less sync.
  A missing file selects Claude Code, Codex, and universal skills. It does not
  select omp. Use `docks-kit harnesses` to view or change the selection.
- **Idempotent** — every step is safe to re-run; no-change syncs are no-ops.
- **Toolchain floors** — `SoT/toolchain.json` records the kit-verified version
  floors for external tools (bun, bwrap, …). `docks-kit toolchain check` prints
  the full doctor table. Bun is the one managed install and is pinned to its
  verified version.
- **Model catalog** — `SoT/models.json` is the research-verified source for
  model validation, listings, and pickers.
- **Claude runtime** — sync materializes three dependency-free Bun `.mjs`
  programs for statusline, SessionStart, and Notification. Quota display uses
  Claude's native `rate_limits`; there is no OAuth fetch, shared usage cache,
  or Stop hook. If Bun cannot be resolved or bootstrapped, sync preserves a
  working legacy hook/statusline setup and reports that migration is deferred.

## Repository map

| Path | Purpose |
|------|---------|
| `SoT/.claude/` | Claude Code SoT (settings template, Bun runtime programs, CLAUDE.md) |
| `SoT/.codex/` | Codex SoT (config.toml, rules, AGENTS.md, marketplace) |
| `SoT/.omp/` | omp SoT (AGENTS.md, config.yml, mcp.json, intercom.json) |
| `SoT/.agents/` | Universal-skill manifest |
| `SoT/models.json` | Kit-verified Claude and Codex model catalog |
| `SoT/toolchain.json` | Verified-version floors |
| `cli/src/engine-native/` | EngineNative sync/model/toolchain implementation |
| `cli/src/generated/sotPayload.ts` | Generated in-memory payload used by standalone and npm installs |
| `cli/` | docks-kit CLI (Effect 4 RC on Bun) + bundled docs topics |
| `docks-kit` / `docks-kit.ps1` | POSIX and Windows launchers (binary → Bun-from-source) |
| `install.sh` / `install.ps1` | POSIX and Windows global installers |
| `docs/PLAN.md` | Plan record standard; plans are GitHub issues |
| `AGENTS.md` / `CLAUDE.md` | Agent-facing engineering rules / Claude Code specifics |

## Platform support

| Platform | Architecture | docks-kit binary | Sync engine |
|----------|--------------|------------------|-------------|
| Linux | x64 | ✅ | ✅ native |
| Linux | arm64 | ✅ | ✅ native |
| macOS | x64 | ✅ | ✅ native |
| macOS | arm64 | ✅ | ✅ native |
| Windows | x64 | ✅ | ✅ native |
| Windows | arm64 | ✅ | ✅ native |

Details: `docks-kit docs platforms`.

## Releases

Tagging `cli-v*` builds six standalone binaries for Linux, macOS, and Windows
on x64 and arm64. The workflow attaches them plus `SHA256SUMS` to the GitHub
release. npm publishes the exact package tarball through trusted publishing
with OIDC provenance.
Package `docks-kit` 0.15.5 bundles the CLI + generated payload, so npm releases
are versioned config snapshots without shipping the authoring `SoT/` tree.

## Deeper docs

- `docks-kit docs <topic>` — overview, sync-layers, flags, modifiers, models,
  toolchain, plugins, install, platforms (works offline, bundled with the CLI)
- [`AGENTS.md`](AGENTS.md) — engineering rules for agents working on the kit
- [`CLAUDE.md`](CLAUDE.md) — Claude Code specifics: env vars, session
  management, permission mode, open concerns
