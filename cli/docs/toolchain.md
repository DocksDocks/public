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

## Supply-chain stance

Every kit-driven install is pinned to a `verified` version — never floating
`@latest` (the npm-worm / Shai-Hulud attack surface). That includes the
`npx skills@<verified>` invocations on agents sync and the release workflow
(actions pinned to commit SHAs, exact bun/npm versions).

## Commands

```text
docks-kit toolchain check                    # doctor table (also inside docks-kit status)
docks-kit toolchain ensure bun               # ensure the only managed tool
```
