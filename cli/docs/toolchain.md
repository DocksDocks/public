# Toolchain: verified-version floors

`SoT/toolchain.json` declares every external tool the kit touches, with:

| Field | Meaning |
|-------|---------|
| `kind` | `required` (preflight hard dep) / `check` (doctor visibility) / `managed` (kit installs + upgrades) |
| `policy` | `track` (upgrade toward latest, gated by `verified`) / `present` (install when missing, never upgrade) |
| `floor` | Minimum acceptable version (below → upgrade automatically) |
| `verified` | Last kit-tested version — the gate line |
| `pinnable` | Whether an exact version can be installed (rtk: `RTK_VERSION=vX.Y.Z`) |

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

- **rtk** — PreToolUse hook (supply-chain sensitive: review releases before
  bumping `verified`). Runs FIRST in the claude sync so `rtk init`'s
  settings rewrite is normalized by the merge that follows.
- **bun** — policy `present`: bootstrap only, never auto-upgraded.
- **effect-solutions**, **agent-browser** — policy `track`: self-upgrade
  toward npm latest.

## Commands

```
docks-kit toolchain check            # doctor table (also inside docks-kit status)
docks-kit toolchain ensure rtk       # install/upgrade one tool per policy
docks-kit sync --yes                 # unattended: auto-accept gates
```
