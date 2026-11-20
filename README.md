# docks-kit

Portable configuration kit for AI coding agents. The **Single Source of
Truth (SoT)** directory `SoT/.omp/` deploys to the omp user-config location.
Clone once to get a consistent AI-assisted environment on supported Linux,
macOS, and Windows machines. Tuned for **token efficiency without sacrificing
quality**.

Supported harness: **Oh My Pi (`omp`)**.

## Quick start

```bash
git clone https://github.com/DocksDocks/docks-kit.git ~/projects/docks-kit
cd ~/projects/docks-kit
./docks-kit sync            # deploy the omp SoT
./docks-kit sync --dry-run  # preview the sync without a write
./docks-kit toolchain       # doctor view: verified-version floors for external tools
```

POSIX hosts use the `./docks-kit` launcher on Linux x64 and arm64 and on macOS
arm64. Windows uses `.\docks-kit.ps1` on x64. Each launcher prefers the matching compiled
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

Source and global installs require Bun. An npm-global install needs npm.
`jq` is optional doctor/test tooling. `curl` is needed only to download Bun's
upstream installer when Bun is absent: by the POSIX launcher and installer, and
by sync's Bun bootstrap, which a release binary can also run. The Windows
launcher and installer use Invoke-WebRequest.

### Move a checkout of DocksDocks/public

The kit moved from DocksDocks/public to DocksDocks/docks-kit. To move a
checkout of DocksDocks/public, run these commands from the checkout's root:

```
git remote set-url origin https://github.com/DocksDocks/docks-kit.git
./docks-kit update        # Linux and macOS
.\docks-kit.ps1 update    # Windows
```

The update pulls from DocksDocks/docks-kit and syncs. A global npm install
needs nothing.

## CLI

```text
docks-kit sync [--dry-run]                      deploy the omp SoT to this machine
docks-kit update [--no-sync]                    self-update the kit (autodetects checkout vs global install), then sync
docks-kit omp [--model <m>|--pick] [args...]    one omp session on a free model, nothing deployed changes
docks-kit omp --fast                            toggle omp fast mode for OpenAI/Codex models, then exit
docks-kit toolchain [check|ensure <tool>|outdated]  verified-version floors for external tools
docks-kit scratch new|remove                    agent temporary files and directories
docks-kit tidy [--apply] [--report]             remove safe agent leftovers
docks-kit docs [topic]                          self-documentation (9 topics)
--help --version --wizard --completions    built-in
```

The CLI is a typed Effect 4 front-end on Bun; all mutation runs through
EngineNative in `cli/src/engine-native/`, with golden-regression coverage for
dry-run output, mutation snapshots, and argv logs. Its dependency graph is
`effect@4.1.2` (including `effect/cli`), `@effect/platform-bun@4.1.2`
(`BunServices.layer` and `BunRuntime.runMain`), and
`@effect/platform-node-shared@4.1.2`. Tests run on `vitest@5.1.0`.
`bun run lint:effect` checks the Effect rules through `@effect/tsgo`. The
same package can run as the editor's TypeScript language server
(`node_modules/.bin/effect-tsgo tsc --lsp --stdio`).
`@effect/cli` and `@effect/platform` are removed: neither has a 4.x release,
the CLI API moved into core, and the standalone platform package was unused
here.

### Key flags (`docks-kit sync`)

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview without applying |
| `--skip-plugin-refresh` | Install missing omp plugins but skip refresh-only updates |
| `--verbose` | Also print no-op confirmations |

Full reference: `docks-kit docs flags`.

## How syncing works

- **Additive by default** — user-only settings keys and plugins survive a
  plain sync.
- **Idempotent** — every step is safe to re-run; no-change syncs are no-ops.
- **Toolchain floors** — `SoT/toolchain.json` records the kit-verified version
  floors for external tools (bun, omp, …). `docks-kit toolchain check` prints
  the full doctor table. Bun is the one managed install and is pinned to its
  verified version.
- **Command guards** — omp's policy for destructive shell commands: to
  remove, agents use the trash (`gio trash -- <path>`, or `trash <path>` on
  macOS) or remove a temporary file or directory with
  `docks-kit scratch remove`. omp denies `rm` of the home directory or `/`,
  `HOME` reassignment, every recursive `rm`, `find -delete`, `find -exec rm`,
  and `xargs rm`. The kit ships no omp prompt rule, so omp runs every command
  that no deny matches without a question, in subagents too. Details and
  gaps: `docks-kit docs command-guards`.
- **Agent cleanup (omp)** — `docks-kit scratch` creates agent temporary
  directories and removes agent temporary files and directories with checked
  paths. `docks-kit tidy` lists merged idle worktrees, their containers,
  orphaned processes, and idle scratch directories, and `docks-kit tidy
  --apply` removes them; `--report` lists other disk and memory use. The kit
  omp plugin `docks-kit-omp` exposes these as tools, reminds the agent of
  what it created, and runs the sweep at most once per 12 hours.

## Kit plugin

Sync writes the kit plugin `docks-kit-omp` to `~/.docks-kit/omp-plugin` and
links it into omp. The kit plugin content comes from `SoT/.omp/plugin/`:

- **Skills** — the 32 docks and plan-lifecycle skills, for example
  `plan-manager`, `plan-workspace`, `code-review`, `security`, and
  `refactor`, plus the `workspace-hygiene` skill.
- **Agents** — the `code-reviewer` and `plan-reviewer` task agents.
- **Extensions** — `verify-gate` checks that each `git commit` carries a
  `Verified:` trailer, `context-tree-nudge` names the context-tree node of
  each edited file, and `hygiene` gives the agent cleanup tools and
  reminders.
- **Rules and commands** — six trigger rules that teach the safe form of a
  risky command, and the `/cleanup` command.

The kit plugin replaces the former `docks` and `plan-lifecycle` plugins of
the `docks` marketplace. `docks-kit sync` uninstalls their user-scope installs
when it can read the omp plugin inventory, and then removes the `docks`
marketplace when no uninstall failed and it can read the marketplace registry.
It only warns about a project-scope install, with the manual command. When a
read fails, sync warns and skips that step, and a later sync tries again.
Report a problem with a skill, an agent, or the kit in
[DocksDocks/docks-kit](https://github.com/DocksDocks/docks-kit/issues).

## Repository map

| Path | Purpose |
|------|---------|
| `SoT/.omp/` | omp SoT (AGENTS.md, config.yml, models.yml, mcp.json, intercom.json, and the `plugin/` source of `docks-kit-omp`) |
| `SoT/toolchain.json` | Verified-version floors |
| `cli/src/engine-native/` | EngineNative sync/toolchain implementation |
| `cli/src/generated/sotPayload.ts` | Generated in-memory payload used by standalone and npm installs |
| `cli/` | docks-kit CLI (Effect 4 on Bun) + bundled docs topics |
| `docks-kit` / `docks-kit.ps1` | POSIX and Windows launchers (binary → Bun-from-source) |
| `install.sh` / `install.ps1` | POSIX and Windows global installers |
| `docs/PLAN.md` | Plan pointer and project plan rules; plans are GitHub issues |
| `AGENTS.md` | Agent-facing engineering rules |

## Platform support

| Platform | Architecture | docks-kit binary | Sync engine |
|----------|--------------|------------------|-------------|
| Linux | x64 | ✅ | ✅ native |
| Linux | arm64 | ✅ | ✅ native |
| macOS | arm64 | ✅ | ✅ native |
| Windows | x64 | ✅ | ✅ native |

Details: `docks-kit docs platforms`.

## Releases

Tagging `cli-v*` builds four standalone binaries: `docks-kit-linux-x64`,
`docks-kit-linux-arm64`, `docks-kit-darwin-arm64`, and
`docks-kit-windows-x64.exe`. The workflow attaches them plus `SHA256SUMS` and the
bundle's source map `docks-kit.js.map` to the GitHub release. npm publishes the
exact package tarball through trusted publishing with OIDC provenance.
Published binaries, checksums, and release notes are available on
[GitHub Releases](https://github.com/DocksDocks/docks-kit/releases).
Each `docks-kit` npm release runs one minified JavaScript bundle of the CLI and
its generated payload (`cli/dist/docks-kit.js`), so releases are versioned config
snapshots without shipping the authoring `SoT/` tree. The package does not ship
the source map; the bundle's last line `//# debugId=<hex>` matches the map of
the same release.

## Deeper docs

- `docks-kit docs <topic>` - overview, sync-layers, flags, toolchain, install,
  platforms, omp-models, omp-context, command-guards (works offline, bundled
  with the CLI)
- [`AGENTS.md`](AGENTS.md) — engineering rules for agents working on the kit
