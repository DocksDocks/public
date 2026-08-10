# Toolchain: verified-version floors

`SoT/toolchain.json` declares every external tool the kit touches, with:

| Field | Meaning |
|-------|---------|
| `kind` | `check` (doctor visibility) / `managed` (kit installs + upgrades) / `pin` (no binary — a version pin for npx-invoked tools, e.g. `skills-cli`) |
| `policy` | `track` (upgrade toward latest, gated by `verified`) / `present` (install when missing, never upgrade) |
| `floor` | Minimum acceptable version (below → upgrade automatically) |
| `verified` | Last kit-tested version — the gate line |
| `pinnable` | Whether an exact version can be installed |

## The gate

When an install/upgrade candidate is **above `verified`**:

- **TTY**: prompt — "X <latest> is not kit-verified (verified: <v>). Install anyway? [y/N]"
- **`--yes`**: proceed with a warning (containers/CI)
- **non-TTY, declined**:
  - install mode (tool missing) + pinnable → install the pinned `verified` version
  - upgrade mode → stay on the installed version, warn

At or below `verified`, installs/upgrades run silently. After testing a new
release, bump `verified` in SoT/toolchain.json — that is the "this version is
now kit-approved" act.

## Managed tools

- **bun** — policy `present`: bootstrap only (pinned to `verified` via the
  installer's version argument), never auto-upgraded. `bun.ts` owns one
  per-engine-run memo shared by Claude runtime, effect-solutions, and direct
  toolchain ensure on supported Linux/macOS hosts.
- **effect-solutions** — policy `track`: self-upgrades toward npm latest,
  gated by its `verified` pin.

jq and curl are `check` rows, not global prerequisites. jq is not consumed by
normal sync. curl is checked only when a requested Linux/macOS Bun bootstrap
must download an installer.

## Supply-chain stance

Every kit-driven install is pinned to a `verified` version or gated by one —
never floating `@latest` (the npm-worm / Shai-Hulud attack surface). That
includes the `npx skills@<verified>` invocations on agents sync and the release
workflow (actions pinned to commit SHAs, exact bun/npm versions).
Callbacks receive the exact gate-approved version; an offline "latest unknown"
probe falls back to the pinned `verified`, never to an ungated latest.

## Commands

```text
docks-kit toolchain check                    # doctor table (also inside docks-kit status)
docks-kit toolchain ensure bun               # ensure one supported managed tool
docks-kit toolchain ensure effect-solutions  # ensure the other supported managed tool
docks-kit sync --yes                         # unattended: auto-accept gates
```
