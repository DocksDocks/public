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
it, upgrade Node to 22.22.2 or newer, then install the pinned version by hand:

```bash
npm install -g typescript-language-server@6.0.0
```

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
```
