# Toolchain: verified-version floors

`SoT/toolchain.json` declares every external tool the kit touches, with:

| Field | Meaning |
|-------|---------|
| `kind` | `check` (doctor visibility) / `managed` (kit-managed install) / `pin` (no binary — a version pin for npx-invoked tools, e.g. `skills-cli`) |
| `policy` | Installation policy; `present` installs when missing and never upgrades |
| `floor` | Minimum acceptable version shown in the doctor table |
| `verified` | Last kit-tested version and the exact pin for kit-driven installs |
| `pinnable` | Whether an exact version can be installed |

`docks-kit toolchain check` reports each installed version against the
manifest's `floor` and `verified` columns.
Before running `bun install --frozen-lockfile`, the checkout launchers reject Bun versions below the manifest's `floor` and direct the user to `bun upgrade`.
Their generated Bun floor is intentionally separate from the generated `verified` pin: the floor gates lockfile compatibility, while the verified pin selects the exact release for kit-driven installs.

## Managed tools

- **bun** — policy `present`: installed from the pinned `verified` release and
  never auto-upgraded. `bun.ts` `bunBootstrap` owns one per-engine-run memo
  shared by the Claude runtime and direct `toolchain ensure bun` on every
  supported host. The POSIX modules download `install.sh` with curl and run it
  with Bash. The Windows module downloads `install.ps1` with curl and runs it
  through `powershell.exe`.

jq and curl are `check` rows, not global prerequisites. jq is not consumed by
normal sync. curl is checked only when a requested Bun bootstrap must download
an installer. An already-present Bun skips that download on every host.

## Node floor

`node` stays a `check` row and now carries a floor of 22.22.2. The floor comes
from `typescript-language-server` 6's `engines` field. The kit installs that
server as an npm global for the `typescript-lsp` plugin, so an older Node runs
a server its own manifest rejects. `docks-kit toolchain check` prints
`below-floor` for a Node older than 22.22.2. The sync pass reads the same
floor: it skips the `typescript-language-server` install on such a host, warns
with the host Node version, and installs the other language servers. Nothing
else consults the floor, so a host below it still runs every kit operation.

## rust-analyzer: no floor, no pin

`rust-analyzer` is a `check` row with no floor and no `verified` pin. The kit
installs the component with `rustup component add rust-analyzer` for the
`rust-analyzer-lsp` plugin, so the version follows the host Rust toolchain. A
pin would claim control the kit does not have, the stance `bubblewrap` already
takes for a tool the kit does not publish. `docks-kit toolchain check` reports
the installed version and judges nothing.

## Language-server upgrades

`claudeSync syncLspServers` installs `intelephense`, `typescript-language-server`,
`typescript`, and `rust-analyzer` only when the binary is missing. It never
upgrades a server that is already present. A `verified` bump therefore reaches
a fresh host immediately and leaves an existing install alone.

The rustup channel follows the same rule. Sync adds the component only when the
`rust-analyzer` binary is missing, and `rustup update` is the user's remedy for
an old component.

A lagging server shows as `below-floor` in `docks-kit toolchain check`. To move
the npm servers to their `verified` pins, run:

```bash
docks-kit toolchain upgrade --dry-run   # print the npm command
docks-kit toolchain upgrade             # run it
```

`toolchain upgrade` (`claudeLsp.ts upgradeLspServers`) reads `npm ls -g` to see
which of `intelephense`, `typescript-language-server`, and `typescript` npm
owns. It runs one `npm install -g <pkg>@<verified>` for each npm-owned package
below its pin. A package already at or above its pin stays as it is. It leaves
these alone and warns:

- A binary on PATH that npm does not own. It came from another installer, so
  upgrade it with that installer.
- `typescript-language-server` when Node is older than the `node` floor.

When the PATH copy of an npm-owned server is outside `npm prefix -g`, it warns
that the upgrade changes only the npm copy. The check follows links and
accepts only a file inside the package directory
(`<prefix>/lib/node_modules/<pkg>` on POSIX), so a link from another PATH
directory into it counts as the npm copy, while a distro binary under a
`/usr` prefix does not. On Windows, a shim in `<prefix>` counts. A package that is not installed
stays missing, because `sync claude` owns first installs. A failed npm call
exits 1. After the install, it reads `npm ls -g` again and exits 1 when a
package is not at its pin.

## Supply-chain stance

Every kit-driven install of third-party software is pinned to a
`SoT/toolchain.json` `verified` version — never floating `@latest` (the
npm-worm / Shai-Hulud attack surface). That includes the
`npx skills@<verified>` invocations on agents sync and the release workflow
(actions pinned to commit SHAs, exact bun/npm versions).

The kit's own package is the single exemption. `install.sh` and `install.ps1`
end with `bun add -g docks-kit@latest` because a global installer that pinned
itself would install a fixed old kit forever. The exemption covers `docks-kit`
alone; both installers still pin the Bun installer they download to the
manifest's `verified` version.

## Commands

```text
docks-kit toolchain check                    # doctor table (also inside docks-kit status)
docks-kit toolchain ensure bun               # ensure the only managed tool
docks-kit toolchain outdated [--refresh]     # verified pins vs newest upstream release
docks-kit toolchain upgrade [--dry-run]      # npm LSP servers below verified -> verified
```

`docks-kit toolchain outdated` reads each tool's optional `upstream` entry in
`SoT/toolchain.json`. An `npm` entry reads the registry `latest` tag. With a
`line`, it reads the newest release on that major line instead, so `tsc` stays
on 6.x. A `github` entry reads the latest release tag and strips `tagPrefix`.
Set `GITHUB_TOKEN` or `GH_TOKEN` to raise the GitHub rate limit. Successful
lookups cache for 24 hours in `~/.docks-kit/kit.db`; `--refresh` bypasses the
cache. The report never installs anything and never edits a pin. A failed
lookup prints `lookup failed: <reason>` and the command still exits 0.
