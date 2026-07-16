# Installing docks-kit

## 1. Repo checkout (development / current users)

```
git clone https://github.com/DocksDocks/public.git ~/projects/public
cd ~/projects/public
./docks-kit sync
```

The `./docks-kit` launcher prefers a compiled binary in `cli/dist/` only when
its reported version matches `package.json`, then falls back to Bun-from-source
(auto-installing Bun via download-then-run and `bun install --frozen-lockfile`
when needed). An ignored stale build is reported and bypassed.

## 2. Global via Bun (effect-solutions-style)

```
bun add -g docks-kit@latest
docks-kit sync
# or one-shot, no install:
bunx docks-kit status
```

The npm package bundles the CLI and its generated in-memory payload — releases
are versioned config snapshots without publishing the authoring `SoT/` tree.
Kit-home resolution remains available for checkout/package update behavior and
display paths, but sync reads do not depend on it.

### Bun 1.3.14 blocked-postinstall notice

A supported global install may finish successfully with this exact notice:

```
Blocked 1 postinstall. Run `bun pm -g untrusted` for details.
```

For the pinned production dependency graph, the diagnostic names only:

```
./node_modules/@parcel/watcher @2.5.6
 » [install]: node scripts/build-from-source.js
```

`@parcel/watcher` is a transitive of the Effect Bun runtime. Supported default
installs already carry its platform prebuilt package, and that install script
only attempts a source build when `npm_config_build_from_source=true` was
explicitly requested. `esbuild` is not in the consumer production graph. The
blocked notice therefore needs no trust action for the supported default
install; `docks-kit --version`, model catalogs, toolchain checks, and real sync
remain functional with the script blocked. CI pins the one-package/one-command
identity above and will fail if the script-bearing set changes.

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
  no Git Bash: the exe embeds the runtime and generated payload, and
  EngineNative runs in-process from any working directory.
- **`bun add -g docks-kit`** — bun creates a working shim for the
  `#!/usr/bin/env bun` bin; the package carries the same generated payload.

`install.sh` is not a Windows path.

## Keeping the kit up to date

```
docks-kit update            # autodetect + update + install-missing-only sync
docks-kit update --no-sync  # update only
```

Autodetection: a kit home with `.git` is a checkout (requires a clean
worktree and an upstream; `git pull --ff-only`, re-runs
`bun install --frozen-lockfile` when the lockfile changed); a kit home
under `node_modules` is a global package (`bun add -g` /
`npm install -g docks-kit@latest`). The chained sync skips refresh-only work
for already-installed Claude/Codex plugins but still installs missing ones.
A compiled binary inside a checkout updates the checkout; on the next invocation
the launcher bypasses that now-stale binary and uses updated source until rebuilt.
Every `docks-kit sync` also does a best-effort behind-upstream check and
nudges when the checkout is stale (silent offline / detached / no git).

## No-Bun recovery

No Bun or constrained sandbox: download the platform release binary from GitHub
Releases and run it directly. No checkout or `DOCKS_KIT_HOME` is required for
sync/config reads.

## Prerequisites

- Bun for source/global installs; release binaries embed the runtime
- Node/npm for npm-global tools (agent-browser, LSP servers)
- jq is optional doctor/test tooling; sync has no jq runtime dependency
- curl is required only when a requested POSIX RTK/Bun bootstrap must download
  an installer; an already-present Bun does not require it
- See `docks-kit toolchain check` for the full picture on this machine
