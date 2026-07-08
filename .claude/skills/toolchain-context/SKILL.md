---
name: toolchain-context
description: Use when modifying lib/toolchain.sh (toolchain::ensure / toolchain::_gate / toolchain::installed_version / toolchain::latest_version / toolchain::report), SoT/toolchain.json entries (kind/policy/floor/verified/pinnable), the verified-version gate semantics (--yes, TTY prompt, non-TTY pinned-verified fallback), or the per-tool install callbacks it drives (claude::_rtk_install, skills::_agent_browser_install, skills::_effect_solutions_install, skills::_bun_bootstrap); covers why claude::sync_rtk runs first in claude::sync (rtk init settings-rewrite ordering), the strictly-newer numeric compare that replaced sort -V, and the ||-true hardening every version probe needs under set -e/pipefail. Not for the settings merge (use settings-merge-context) or plugin passes (use plugin-bootstrap-context).
user-invocable: false
metadata:
  source_files:
    - path: lib/toolchain.sh
      lines: "1-215"
    - path: SoT/toolchain.json
      lines: "1-25"
    - path: lib/claude.sh
      lines: "760-830"
    - path: lib/skills.sh
      lines: "150-300"
  updated: "2026-07-08"
---

# Toolchain: verified-version floors

<constraint>
Every arm of `toolchain::installed_version` and `toolchain::latest_version` must end `|| true`, and both functions must `return 0`. Callers assign via `$(...)` under `set -euo pipefail` — a no-match `grep` or failing `--version` in a pipeline would otherwise abort the whole sync (this bit the first implementation: the report died at the effect-solutions probe). (`toolchain::installed_version`, the per-arm `|| true` guards)
</constraint>

<constraint>
`claude::sync_rtk` must stay the FIRST step in `claude::sync`. On a first-ever install `rtk init --global` rewrites `~/.claude/settings.json` (clears hooks.PreToolUse); running it before the settings merge lets the merge normalize whatever rtk wrote, so deploy-time modifiers land last and can never be clobbered. Moving it later resurrects the bug that `claude::_rtk_reassert_hook` (now deleted) only half-fixed. (`claude::sync`, the toolchain-before-config dispatch comment)
</constraint>

<constraint>
Version comparison is `toolchain::_is_newer` — numeric per-dotted-field sort (`sort -t. -k1,1n -k2,2n -k3,3n`), NOT `sort -V`, which is absent on older BSD/macOS sort. A locally-newer pre-release must never trigger a downgrade (strictly-newer semantics: equal versions return 1).
</constraint>

## Design split

- **`SoT/toolchain.json` holds DATA only** — kind (`required`/`check`/`managed`),
  policy (`track`/`present`), `floor`, `verified`, `pinnable`, notes. Consumed by
  bash (jq) and the TS CLI alike. No shell commands in the manifest (no eval).
- **`lib/toolchain.sh` owns the generic machinery** — presence probe, version
  probes, compare, gate, ensure, report.
- **Tool-specific install commands stay in the owning lib** and are passed to
  `toolchain::ensure <tool> <install_fn>` as callbacks invoked as
  `<install_fn> <install|upgrade> <version>` (empty version = latest):
  `claude::_rtk_install` (RTK_VERSION=vX.Y.Z pin support),
  `skills::_agent_browser_install` (install mode also pulls Chrome for Testing),
  `skills::_effect_solutions_install` (idempotent `bun add -g @latest` — this is
  what finally gave effect-solutions the self-upgrade agent-browser had),
  `skills::_bun_bootstrap` (download-then-run Bun).

## The gate (`toolchain::_gate`, the verified-pin policy)

Candidate above `verified`:

| Context | Outcome |
|---------|---------|
| TTY | prompt "Install <tool> <latest> anyway? [y/N]" |
| `--yes` (`ASSUME_YES=1`) | proceed with a warning |
| non-TTY declined, mode=install, `pinnable: true` | install the pinned `verified` version (the machine still needs the tool) |
| non-TTY declined, mode=upgrade | stay on installed, warn |

At or below `verified` (or no `verified` field): silent proceed. Bumping
`verified` in SoT/toolchain.json after testing a release is the
"kit-approved" act — RTK is supply-chain sensitive (PreToolUse hook), so
review releases before bumping its pin.

## ensure flow (`toolchain::ensure`)

missing → gate(install) → callback; present + policy `present` → log only;
present + policy `track` → latest probe (empty = offline, no action) →
unparseable installed version is treated as stale and refreshed (self-heal)
→ strictly-newer → gate(upgrade) → callback. Every branch has a `[dry-run]`
echo + early return.

## Adding a managed tool

1. Manifest entry in `SoT/toolchain.json` (kind `managed`, policy, optional
   floor/verified/pinnable).
2. Version-probe arms in `toolchain::installed_version` / `latest_version`
   (with `|| true`).
3. Install callback in the owning lib, wired via `toolchain::ensure` from
   that lib's sync step.
4. If it should be ensurable standalone: add it to the managed-tool case in
   `engine::toolchain` (`lib/engine.sh`) and the MANAGED list in
   `cli/src/commands/toolchain.ts`.
