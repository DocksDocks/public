# Installing docks-kit

## 1. Repo checkout (development / current users)

```
git clone https://github.com/DocksDocks/public.git ~/projects/public
cd ~/projects/public
./docks-kit sync
```

The `./docks-kit` launcher prefers a compiled binary in `cli/dist/`, then
falls back to Bun-from-source (auto-installing Bun via download-then-run and
`bun install --frozen-lockfile` when needed).

## 2. Global via Bun (effect-solutions-style)

```
bun add -g docks-kit@latest
docks-kit sync
# or one-shot, no install:
bunx docks-kit status
```

The npm package bundles the CLI and the SoT — releases are versioned config
snapshots. Kit-home resolution: `DOCKS_KIT_HOME` env → nearest ancestor
directory containing `SoT/` + `package.json` (a checkout wins over the bundled
copy) → the package's own bundled SoT.

## 3. curl installer (Unix-only)

```
curl -fsSL https://raw.githubusercontent.com/DocksDocks/public/main/install.sh -o /tmp/docks-kit-install.sh
bash /tmp/docks-kit-install.sh && rm /tmp/docks-kit-install.sh
```

Download-then-run, never `curl | bash` — stream truncation has bitten this
kit before. The installer bootstraps Bun when absent, runs
`bun add -g docks-kit`, and links the binary into `~/.local/bin`.
**Linux/macOS only** — on Windows use the compiled `.exe` or `bun add -g`
(both CI-verified; see below).

## Windows entrypoints

Two supported paths (CI-verified on windows-2025, native PowerShell):

- **Compiled binary** — `docks-kit-windows-x64.exe` release asset. No Bun,
  no Git Bash: the exe embeds the runtime and EngineNative runs in-process.
  It still needs the SoT it deploys — run it from inside a kit checkout, or
  point `DOCKS_KIT_HOME` at one.
- **`bun add -g docks-kit`** — bun creates a working shim for the
  `#!/usr/bin/env bun` bin; outside a checkout the package's own bundled
  SoT is used.

`install.sh` is not a Windows path.

## Keeping the kit up to date

```
docks-kit update            # autodetect + update + chained flag-less sync
docks-kit update --no-sync  # update only
```

Autodetection: a kit home with `.git` is a checkout (requires a clean
worktree and an upstream; `git pull --ff-only`, re-runs
`bun install --frozen-lockfile` when the lockfile changed); a kit home
under `node_modules` is a global package (`bun add -g` /
`npm install -g docks-kit@latest`). A compiled binary inside a checkout
updates the checkout and tells you to rebuild/download the binary.
Every `docks-kit sync` also does a best-effort behind-upstream check and
nudges when the checkout is stale (silent offline / detached / no git).

## No-Bun recovery

No Bun or constrained sandbox: download the platform release binary from GitHub
Releases and run it from inside a kit checkout, or set `DOCKS_KIT_HOME` to the
checkout containing `SoT/`.

## Prerequisites

- jq and curl (sync preflight checks them for the deployed assets and installers)
- Bun for source/global installs; release binaries embed the runtime
- Node/npm for npm-global tools (agent-browser, LSP servers)
- See `docks-kit toolchain check` for the full picture on this machine
