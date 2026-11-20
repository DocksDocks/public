# Toolchain: verified-version floors

`SoT/toolchain.json` declares every external tool the kit touches, with:

| Field | Meaning |
|-------|---------|
| `kind` | `check` (doctor visibility) / `managed` (kit-managed install) / `pin` (no binary — a version pin for a package that the kit installs through another tool, such as `omp install` for `pi-intercom`; the required `via` field names that tool in the doctor table) |
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
  shared by the omp pipeline and direct `toolchain ensure bun` on every
  supported host. The POSIX modules download `install.sh` with curl and run it
  with Bash. The Windows module downloads `install.ps1` with curl and runs it
  through `powershell.exe`. When Bun is already present, `toolchain ensure bun`
  installs nothing and warns if that Bun is below the `floor`.

jq and curl are `check` rows, not global prerequisites. jq is not consumed by
normal sync. curl is checked only when a requested Bun bootstrap must download
an installer. An already-present Bun skips that download on every host.

## Supply-chain stance

Every kit-driven package install from npm, GitHub releases, or
`omp install` is pinned to a `SoT/toolchain.json` `verified` version — never
floating `@latest` (the npm-worm / Shai-Hulud attack surface). That includes
the release workflow (actions pinned to commit SHAs, exact bun/npm versions).
The kit installs no omp marketplace plugin: the kit plugin ships from this
repository, and sync retires the former `docks` marketplace plugins (see
`sync-layers`). Any new install surface, a new marketplace or plugin source
included, needs a manifest pin first.

The kit's own package is the single exemption from the `@latest` ban. `install.sh` and `install.ps1`
end with `bun add -g docks-kit@latest` because a global installer that pinned
itself would install a fixed old kit forever. The exemption covers `docks-kit`
alone; both installers still pin the Bun installer they download to the
manifest's `verified` version.

## Commands

```text
docks-kit toolchain check                    # doctor table
docks-kit toolchain ensure bun               # ensure the only managed tool
docks-kit toolchain ensure bun --dry-run     # preview the Bun install
docks-kit toolchain outdated [--refresh]     # verified pins vs newest upstream release
```

`docks-kit toolchain outdated` reads each tool's optional `upstream` entry in
`SoT/toolchain.json`. An `npm` entry reads the registry `latest` tag. A
`github` entry reads the latest release tag and strips `tagPrefix`.
Set `GITHUB_TOKEN` or `GH_TOKEN` to raise the GitHub rate limit. Successful
lookups cache for 24 hours in `~/.docks-kit/kit.db`; `--refresh` bypasses the
cache. The report never installs anything and never edits a pin. A failed
lookup prints `lookup failed: <reason>` and the command still exits 0.
