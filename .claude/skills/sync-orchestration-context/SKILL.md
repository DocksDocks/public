---
name: sync-orchestration-context
description: Use when editing sync.sh, lib/common.sh, or any flag in --force / --remove-plugins / --no-rtk / --dry-run / --claude / --codex / --agents; covers TARGET_FILTER_SET default-all-three logic, additive-vs-reconcile orthogonality of FORCE and REMOVE_PLUGINS env vars, SKIP_OPTIONAL_BOOTSTRAP semantics, common::parse_args and common::preflight invariants, and the requirement that every lib/<tool>.sh step remain idempotent across re-runs.
user-invocable: false
metadata:
  source_files:
    - path: sync.sh
      lines: "1-55"
    - path: lib/common.sh
      lines: "1-71"
  updated: "2026-05-17"
---

# sync.sh Orchestration

<constraint>
Every new sync step MUST include a `[[ "$DRY_RUN" -eq 1 ]]` guard that prints `[dry-run] <what would happen>` and returns — without it, `./sync.sh --dry-run` executes the step for real. (lib/claude.sh:22-26 pattern)
</constraint>

<constraint>
Never construct SoT paths from `pwd`. All SoT paths MUST be prefixed with `$REPO_DIR/SoT/…` where `REPO_DIR="$(cd "$(dirname "$0")" && pwd)"` (sync.sh:6). `sync.sh` is safe to invoke from any working directory because of this.
</constraint>

<constraint>
Any command that can legitimately fail non-fatally under `set -euo pipefail` (sync.sh:4) MUST append `|| true` or `|| warn "…"`. Unguarded failures terminate the entire sync run. (lib/claude.sh:183 example: `claude plugin marketplace update >/dev/null 2>&1 || true`)
</constraint>

<constraint>
Flag variables are initialized in lib/common.sh:4-11 via `${VAR:-0}`. Never re-initialize them in lib/*.sh. They can be pre-set as env vars before sourcing.
</constraint>

## When to Use

- Adding a new target flag (e.g. `--cursor`)
- Adding a new per-tool sync function that should respect `--dry-run`
- Changing default-all-three behavior when no target flag is given
- Debugging why a target is syncing when not expected
- Adding a new tool's SoT dispatch block to sync.sh

## Core Patterns

### Flag → Variable Mapping

| Flag | Variable set | Notes |
|------|-------------|-------|
| `--dry-run` | `DRY_RUN=1` | lib/common.sh:42 |
| `--no-rtk` | `SKIP_OPTIONAL_BOOTSTRAP=1` | lib/common.sh:43 |
| `--force` | `FORCE=1` | lib/common.sh:44 — settings layer only |
| `--remove-plugins` | `REMOVE_PLUGINS=1` | lib/common.sh:45 — plugin+skills layer only |
| `--claude` | `SYNC_CLAUDE=1`, `TARGET_FILTER_SET=1` | lib/common.sh:46 |
| `--codex` | `SYNC_CODEX=1`, `TARGET_FILTER_SET=1` | lib/common.sh:47 |
| `--agents` | `SYNC_AGENTS=1`, `TARGET_FILTER_SET=1` | lib/common.sh:48 |
| (none) | `SYNC_CLAUDE=SYNC_CODEX=SYNC_AGENTS=1` | lib/common.sh:56-60 — TARGET_FILTER_SET remains 0 |

Unknown flags: `err "Unknown arg: $arg"; exit 2` (lib/common.sh:52-53).

### Default-All-Three Logic

```bash
# lib/common.sh:56-60
if [[ "$TARGET_FILTER_SET" -eq 0 ]]; then
  SYNC_CLAUDE=1
  SYNC_CODEX=1
  SYNC_AGENTS=1
fi
```

### Dispatch + SoT-Presence Guard

```bash
# sync.sh:14-18 — library sourced INSIDE the conditional
if [[ "$SYNC_CLAUDE" -eq 1 && -d "$REPO_DIR/SoT/.claude" ]]; then
  source "$REPO_DIR/lib/claude.sh"
  claude::sync
fi
```

If `SoT/.claude/` is absent (partial clone), the entire Claude sync is silently skipped — no error. This is intentional for portability.

### Summary/Next-Steps Guard

```bash
# sync.sh:35-37 — only runs if lib was actually sourced
if declare -F claude::summary >/dev/null 2>&1; then
  claude::summary
fi
```

Functions guarded with `[[ "${CLAUDE_SYNCED:-0}" -eq 1 ]] || return` (lib/claude.sh:293) also skip if the tool was not synced.

### Preflight Checks

| Condition | Checks | lib/common.sh line |
|-----------|--------|--------------------|
| `SYNC_CLAUDE=1` OR `SYNC_CODEX=1` | `jq` in PATH | 64-65 |
| `SYNC_CLAUDE=1` | `curl` in PATH | 67-68 |

### Dry-Run Template for New Functions

```bash
my_tool::sync_foo() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] <what would happen>"
    return          # use return, not exit — only short-circuits this function
  fi
  # actual work here
}
```

### Orthogonality: --force vs --remove-plugins

| Flag | Layer affected | What wins |
|------|---------------|-----------|
| `--force` | `~/.claude/settings.json` keys | SoT-declared keys; user-only keys preserved; permissions arrays replaced |
| `--remove-plugins` | Plugin + skills installs | SoT manifest; user-only installs preserved |
| Both | Both layers | Combined effect; user-only additions outside kit scope always preserved |

## Key Decisions

- `REPO_DIR` set at sync.sh:6 from `$0`'s directory, not `$PWD` — safe for `~/projects/public/sync.sh` invocations from anywhere.
- `lib/*.sh` files are sourced inside SoT-presence conditionals (sync.sh:14-30), not at the top of the script — partial checkouts silently skip missing tools.
- `declare -F` guard at sync.sh:35-43 means summary/next_steps are no-ops when the tool's lib was never sourced.
- Flag variables use `${VAR:-0}` defaults (lib/common.sh:4-11) so they can be pre-set as env vars (`DRY_RUN=1 ./sync.sh`).
- `--force` and `--remove-plugins` are orthogonal layers — combining them triggers both settings reconcile AND plugin/skills reconcile. Neither flag alone touches the other's layer.

## Gotchas

- **`return` vs `exit` in dry-run blocks**: using `exit` instead of `return` terminates the entire script, not just the current function. Every dry-run block MUST use `return`. (lib/claude.sh:26 uses `return`.)
- **Forgetting `|| true` on legitimately-fallible commands**: `set -euo pipefail` at sync.sh:4 means any unguarded non-zero exit aborts the run. `claude plugin marketplace update` at lib/claude.sh:183 demonstrates the `|| true` guard.
- **Tool-scoped summary mismatch**: if `claude::summary` is added to a lib file that checks `CLAUDE_SYNCED` but the sync function never sets `CLAUDE_SYNCED=1`, summary is always silently skipped. Check lib/claude.sh:6 for the assignment location.
- **Unknown flags exit 2**: passing a mistyped flag (e.g. `--not-a-real-flag`) exits with code 2 immediately (lib/common.sh:52-53). No partial sync occurs.

## References

- `references/flag-matrix.md` — full truth table across all flag combinations; read when debugging unexpected sync behavior
- `references/dispatch-flow.md` — annotated dispatch order and SoT-presence guard sequence; read when adding a new tool target
