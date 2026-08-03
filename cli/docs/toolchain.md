# Toolchain: verified-version floors

`SoT/toolchain.json` declares every external tool the kit touches, with:

| Field | Meaning |
|-------|---------|
| `kind` | `check` (doctor visibility) / `managed` (kit installs + upgrades) / `managed-release` (dedicated source-pinned release transaction) / `pin` (no binary — a version pin for npx-invoked tools, e.g. `skills-cli`) |
| `policy` | `track` (upgrade toward latest, gated by `verified`) / `present` (install when missing, never upgrade) / `exact` (install the declared release only) |
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
  settings rewrite is normalized by the merge that follows. Pinned installs
  fetch the installer script from the version tag, not mutable master.
- **bun** — policy `present`: bootstrap only (pinned to `verified` via the
  installer's version argument), never auto-upgraded. `bun.ts` owns one
  per-engine-run memo shared by Claude runtime, effect-solutions, and direct
  toolchain ensure on supported Linux/macOS hosts.
- **effect-solutions**, **agent-browser** — policy `track`: self-upgrade
  toward npm latest, gated by their `verified` pins.
- **session-relay** — policy `exact`: Claude/Codex sync and
  `docks-kit toolchain ensure session-relay` select exactly one of three targets
  (`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`,
  `aarch64-apple-darwin`). `x86_64-apple-darwin` is no longer published as of
  Session Relay 0.16.0; macOS support is `aarch64-apple-darwin`, and Intel
  macOS hosts fail closed before any download. The installer downloads the
  pinned `session-relay--v0.16.0` asset and same-release `SHA256SUMS`, requires
  source pin = selected row = downloaded bytes, chmods/smoke-tests only the
  sibling stage, then renames it over `~/.local/bin/session-relay`. Offline,
  unsupported-host, checksum, chmod, version, download, or rename failures
  preserve an existing command byte-for-byte. The three pinned production
  digests correspond to the tagged `session-relay--v0.16.0` assets and match
  its `SHA256SUMS`:
  `x86_64-unknown-linux-musl` — `b3ca082dc5ea51e8322be407cdb4bbcaaa05d80bd62c3553f82ab98c1a95498a`
  `aarch64-unknown-linux-musl` — `816b6b8bd2d2c2518ea359a5a21502213347b387a1cc576a0fb9cf541e5646ed`
  `aarch64-apple-darwin` — `da8b114216c3f2301ad582df8e59b49e91953abcc1112b510466b31637fda825`

jq and curl are `check` rows, not global prerequisites. jq is not consumed by
normal sync. curl is checked only at a requested Linux/macOS RTK/Bun installer
download boundary.

## Supply-chain stance

Every kit-driven install is pinned to a `verified` version or gated by one —
never floating `@latest` (the npm-worm / Shai-Hulud attack surface). That
includes the `npx skills@<verified>` invocations on agents sync and the release
workflow (actions pinned to commit SHAs, exact bun/npm versions).
Callbacks receive the exact gate-approved version; an offline "latest unknown"
probe falls back to the pinned `verified`, never to an ungated latest.

## Commands

```
docks-kit toolchain check            # doctor table (also inside docks-kit status)
docks-kit toolchain ensure rtk       # install/upgrade one tool per policy
docks-kit toolchain ensure session-relay # install exact verified release
docks-kit sync --yes                 # unattended: auto-accept gates
```
