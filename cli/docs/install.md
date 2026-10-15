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

The install prints no peer dependency warning. The root pins
`@effect/platform-node-shared` at `4.0.0-rc.115`, the same release as the
pinned `effect`, so a fresh registry resolution installs exactly one copy of
each and the transitive peer range `effect@^4.0.0-rc.115` is satisfied. Without
that root pin, `@effect/platform-bun` requests the shared package through a
caret range over a prerelease and a fresh install can pair a newer shared
package with the pinned `effect`.

## 3. curl installer (POSIX)

```
tmp="$(mktemp)" && curl -fsSL https://raw.githubusercontent.com/DocksDocks/public/main/install.sh -o "$tmp" && bash "$tmp"; rm -f "$tmp"
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
`bun add -g docks-kit@latest` and runs `docks-kit --version` from Bun's global
bin directory (`%USERPROFILE%\.bun\bin` by default). The CLI stays in that
directory, because Bun's `docks-kit.exe` shim cannot run without the
`docks-kit.bunx` file next to it. When the directory is not on `PATH`, the
installer prints the command that adds it. A copy of `docks-kit.exe` that an
earlier installer left in `%USERPROFILE%\.local\bin` is removed.

## Keeping the kit up to date

```
docks-kit update            # autodetect + update + full sync (refreshes plugins)
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
worktree and an upstream; `git pull --ff-only`, then re-runs
`bun install --frozen-lockfile` when the pull changed `bun.lock` or
`package.json`); a kit home under `node_modules` is a global package
(`bun add -g` / `npm install -g docks-kit@latest`). The chained sync is a
plain flag-less `docks-kit sync`. It refreshes plugin marketplaces and
installed plugins even when the kit is already current. Pass `--no-sync`, then
run `docks-kit sync --skip-plugin-refresh` to skip the refresh-only work.
A compiled binary inside a checkout updates the checkout; on the next invocation
the launcher bypasses that now-stale binary and uses updated source until rebuilt.
Every `docks-kit sync` also does a best-effort behind-upstream check and
nudges when the checkout is stale (silent offline / detached / no git).

## Recovering a broken global install

A global install made before the `@effect/platform-node-shared` pin can fail at
startup with `Cannot find module 'effect/ByteSize'` or another missing
`effect/...` module. Repair it with a remove followed by a fresh add:

```
bun rm -g docks-kit && bun add -g docks-kit@latest
```

A plain reinstall over the broken tree is not enough. Bun keeps the previously
resolved copy nested under
`node_modules/@effect/platform-bun/node_modules/@effect/platform-node-shared`,
and that stale copy still loads.

If a plain reinstall was already attempted, the remove-then-add above no longer
clears that nested copy either. Force a full re-resolve of the global tree:

```
bun rm -g docks-kit && bun add -g docks-kit@latest --force
```

`--force` without the remove does not repair it. Other global packages survive
both sequences.

An npm global install repairs itself with a plain upgrade, because npm rebuilds
the tree it owns:

```
npm install -g docks-kit@latest
```

Verified on Bun 1.4.2 and npm 11, each in a clean HOME.

## No-Bun recovery

No Bun or constrained sandbox: download the platform release binary from GitHub
Releases and run it directly. No checkout or `DOCKS_KIT_HOME` is required for
sync/config reads.

## Prerequisites

- Bun for source/global installs; release binaries embed the runtime
- Node/npm for npm-global LSP servers
- rustup is optional and needed only for the Rust language server
- jq is optional doctor/test tooling; sync has no jq runtime dependency
- curl is needed only to download Bun's upstream installer when Bun is absent:
  by the POSIX `docks-kit` launcher, by the POSIX `install.sh`, and by sync's
  Bun bootstrap on every host, release binaries included
  (`docks-kit toolchain ensure bun` too). `docks-kit.ps1` and `install.ps1`
  download Bun's installer with Invoke-WebRequest. An already-present Bun needs
  no curl.
- See `docks-kit toolchain check` for the full picture on this machine
