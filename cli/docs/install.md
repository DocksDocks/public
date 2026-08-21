# Installing docks-kit

Supported hosts are Linux x64/arm64, macOS x64/arm64, and Windows x64/arm64.
Hosts outside this matrix fail before a launcher can fall back to Bun source.

## 1. Repo checkout (development / current users)

```
git clone https://github.com/DocksDocks/public.git ~/projects/public
cd ~/projects/public
./docks-kit sync
```

POSIX hosts use `./docks-kit`. Windows uses `.\docks-kit.ps1`. Each
launcher prefers a compiled binary in `cli/dist/` only when its reported
version matches `package.json`. It then falls back to Bun-from-source and
auto-installs Bun plus `node_modules` when needed. Each launcher reports and
bypasses an ignored stale build.

## 2. Global via Bun

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

### Bun 1.4.0 install output

A supported global install completes with no blocked postinstall: `bun pm -g
untrusted` reports zero untrusted dependencies with scripts. Neither
`@parcel/watcher` nor `esbuild` is in the consumer graph. The graph does carry
one package with an `install` script, `msgpackr-extract` by way of
`effect > msgpackr`, and Bun raises no trust prompt for it.

The install does print one expected warning:

```
warn: incorrect peer dependency "effect@4.0.0-rc.109"
```

`@effect/platform-bun` resolves `@effect/platform-node-shared` through a caret
range, which installs rc.111, and that release declares a peer requirement of
`effect@^4.0.0-rc.111`. The kit pins `effect@4.0.0-rc.109` deliberately, so this
newer transitive peer range cannot be satisfied. `docks-kit --version`, model
catalogs, toolchain checks, and real sync are unaffected.

## 3. curl installer (POSIX)

```
curl -fsSL https://raw.githubusercontent.com/DocksDocks/public/main/install.sh -o /tmp/docks-kit-install.sh
bash /tmp/docks-kit-install.sh && rm /tmp/docks-kit-install.sh
```

Download-then-run, never `curl | bash` — stream truncation has bitten this
kit before. The installer bootstraps Bun when absent, runs
`bun add -g docks-kit@latest`, and links the binary into `~/.local/bin`.
This installer serves the two POSIX platforms. Windows uses the PowerShell
installer below.

## 4. PowerShell installer (Windows)

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/DocksDocks/public/main/install.ps1 -OutFile "$env:TEMP\docks-kit-install.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\docks-kit-install.ps1"
Remove-Item "$env:TEMP\docks-kit-install.ps1"
```

Download the script before execution. Never stream it into PowerShell. The
installer bootstraps Bun when absent. It then runs
`bun add -g docks-kit@latest` and copies the CLI plus Bun into
`%USERPROFILE%\.local\bin`.

## Keeping the kit up to date

```
docks-kit update            # autodetect + update + install-missing-only sync
docks-kit update --no-sync  # update only
```

`docks-kit update` resolves the kit home in this order:

1. The explicit `DOCKS_KIT_HOME` value comes first when set. It must name a
   directory whose `package.json` has the name `docks-kit`. An invalid value
   causes an error instead of a fallback.
2. The CLI uses the nearest kit root at or above its own module directory.
3. Next, the CLI uses the nearest kit root at or above the directory that holds
   the executable. A standalone binary inside `<checkout>/cli/dist` therefore
   resolves to the checkout.
4. Next, the CLI uses the nearest kit root at or above the current working
   directory, but only as a fallback.
5. Otherwise, the CLI uses the directory that holds the executable.

Sources 2 and 3 identify the installation that is running. A globally installed
`docks-kit` updates the global package even when you run it from inside a
docks-kit checkout. `DOCKS_KIT_HOME` lets you target a specific checkout on
purpose.

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
- Node/npm for npm-global LSP servers
- jq is optional doctor/test tooling; sync has no jq runtime dependency
- curl is required only when a source launcher must download Bun. The POSIX
  launchers run `install.sh`; Windows runs `install.ps1` through PowerShell.
  An already-present Bun does not require curl.
- See `docks-kit toolchain check` for the full picture on this machine
