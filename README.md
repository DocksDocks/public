# docks-kit

Portable configuration kit for AI coding agents. Per-tool **Single Source of
Truth (SoT)** directories are deployed to each tool's user-config location —
clone once and get a consistent AI-assisted dev environment across supported
Linux and macOS machines. Tuned for **token efficiency without sacrificing quality**.

Supported tools: **Claude Code**, **Codex**, and any agent consuming
[agentskills.io](https://agentskills.io) universal skills.

## Quick start

```bash
git clone https://github.com/DocksDocks/public.git ~/projects/public
cd ~/projects/public
./docks-kit sync            # deploy everything (Claude Code + Codex + skills)
./docks-kit status          # doctor view: drift, toolchain, plugins, skills
```

The `./docks-kit` launcher supports Linux x64/arm64 and macOS x64/arm64.
On those hosts it prefers a compiled binary (`cli/dist/`) only when its version
matches the checkout, then runs from source via Bun—auto-installing Bun and
dependencies when missing. Unsupported hosts fail immediately and never fall
back to Bun source. Stale ignored build artifacts cannot mask newer checkout
code.

Other install paths (global `bun add -g docks-kit`, curl installer) —
see `./docks-kit docs install`.

**No-Bun recovery path**:

Download the platform release binary from GitHub Releases and run it directly.
The executable carries the generated sync payload; no checkout or adjacent
`SoT/` directory is required.

Prerequisites for source/global installs: Bun; Node/npm for npm-global tools.
`jq` is optional doctor/test tooling. `curl` is used only when a requested
Linux/macOS Bun bootstrap must download an installer.

## CLI

```text
docks-kit sync [claude] [codex] [agents]   deploy the SoT (default: all three)
docks-kit update [--no-sync]               self-update the kit (autodetects checkout vs global install), then sync
docks-kit model <claude|codex> [value]     get/set the DEPLOYED model (TTY picker)
docks-kit models [claude|codex]            model catalogs (`--json`)
docks-kit toolchain [check|ensure <tool>]  verified-version floors for external tools
docks-kit status [--json]                  deployed-vs-SoT drift + toolchain + counts
docks-kit plugins list [--json]            enabledPlugins tri-state vs installed
docks-kit skills list [--json]             universal skills vs manifest
docks-kit docs [topic]                     self-documentation (9 topics)
--help --version --wizard --completions    built-in
```

The CLI is a typed Effect 4 beta front-end on Bun; all mutation runs through
EngineNative in `cli/src/engine-native/`, with golden-regression coverage for
dry-run output, mutation snapshots, and argv logs. Its dependency graph is
`effect@4.0.0-beta.107` (including `effect/unstable/cli`),
`@effect/platform-bun@4.0.0-beta.107` (`BunServices.layer` and
`BunRuntime.runMain`), `@effect/vitest@4.0.0-beta.107`, and `vitest@4.1.10`
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
| `--yes` | Auto-accept toolchain prompts (CI/containers) |

**Deploy-time modifiers** change deployed config only — the SoT is untouched
and a later flag-less sync reverts them. Full reference: `docks-kit docs flags`
(includes the old→new rename table for the pre-CLI `sync.sh` flags).

## How syncing works

- **Additive by default** — user-only settings keys, plugins, and skills
  survive a plain sync. Reconciliation toward the SoT is explicit
  (`--reconcile` / `--prune`).
- **Idempotent** — every step is safe to re-run; no-change syncs are no-ops.
- **Toolchain floors** — external tools (bun, bwrap,
  effect-solutions, …) install/upgrade against `SoT/toolchain.json`:
  versions above the kit-verified pin prompt before installing
  (`--yes` accepts; non-TTY falls back to the pinned verified version
  when possible). `docks-kit toolchain check` shows the full table.
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
| `SoT/.agents/` | Universal-skill manifest |
| `SoT/models.json` | Kit-verified Claude and Codex model catalog |
| `SoT/toolchain.json` | Verified-version floors |
| `cli/src/engine-native/` | EngineNative sync/model/toolchain implementation |
| `cli/src/generated/sotPayload.ts` | Generated in-memory payload used by standalone and npm installs |
| `cli/` | docks-kit CLI (Effect 4 beta on Bun) + bundled docs topics |
| `docks-kit` | Launcher (binary → bun-from-source) |
| `install.sh` | Global installer (Bun bootstrap + `bun add -g`) |
| `docs/plans/` | Multi-commit work-item plans |
| `AGENTS.md` / `CLAUDE.md` | Agent-facing engineering rules / Claude Code specifics |

## Platform support

| Platform | Architecture | docks-kit binary | Sync engine |
|----------|--------------|------------------|-------------|
| Linux | x64 | ✅ | ✅ native |
| Linux | arm64 | ✅ | ✅ native |
| macOS | x64 | ✅ | ✅ native |
| macOS | arm64 | ✅ | ✅ native |

Details: `docks-kit docs platforms`.

## Releases

Tagging `cli-v*` builds four standalone binaries (Linux x64/arm64 and macOS
x64/arm64) plus `SHA256SUMS` and attaches them to the GitHub release; npm
publishes the exact package tarball through trusted publishing with OIDC provenance.
Package `docks-kit` 0.15.1 bundles the CLI + generated payload, so npm releases
are versioned config snapshots without shipping the authoring `SoT/` tree.

## Deeper docs

- `docks-kit docs <topic>` — overview, sync-layers, flags, modifiers, models,
  toolchain, plugins, install, platforms (works offline, bundled with the CLI)
- [`AGENTS.md`](AGENTS.md) — engineering rules for agents working on the kit
- [`CLAUDE.md`](CLAUDE.md) — Claude Code specifics: env vars, session
  management, permission mode, open concerns
