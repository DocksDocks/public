---
name: sync-orchestration-context
description: Use when editing sync.sh, lib/common.sh, or any flag in --force / --remove-plugins / --fable / --permissive / --no-rtk / --dry-run / --claude / --codex / --agents; covers TARGET_FILTER_SET default-all-three logic, additive-vs-reconcile orthogonality of FORCE and REMOVE_PLUGINS env vars, the FABLE/PERMISSIVE deploy-time modifiers, SKIP_OPTIONAL_BOOTSTRAP semantics, common::parse_args and common::preflight invariants, and the requirement that every lib/<tool>.sh step remain idempotent across re-runs.
user-invocable: false
metadata:
  source_files:
    - path: sync.sh
      lines: "1-55"
    - path: lib/common.sh
      lines: "1-77"
  updated: "2026-06-12"
---

# sync.sh Orchestration

<constraint>
Every new sync step MUST include a `[[ "$DRY_RUN" -eq 1 ]]` guard that prints `[dry-run] <what would happen>` and returns — without it, `./sync.sh --dry-run` executes the step for real. (claude::sync_scripts dry-run pattern)
</constraint>

<constraint>
Never construct SoT paths from `pwd`. All SoT paths MUST be prefixed with `$REPO_DIR/SoT/…` where `REPO_DIR="$(cd "$(dirname "$0")" && pwd)"` (sync.sh (REPO_DIR assignment)). `sync.sh` is safe to invoke from any working directory because of this.
</constraint>

<constraint>
Any command that can legitimately fail non-fatally under `set -euo pipefail` (sync.sh (set -euo pipefail)) MUST append `|| true` or `|| warn "…"`. Unguarded failures terminate the entire sync run. (claude::_plugins_update example: `claude::_cli plugin marketplace update >/dev/null 2>&1 || true`)
</constraint>

<constraint>
Flag variables are initialized in common.sh (flag-var init block) via `${VAR:-0}`. Never re-initialize them in lib/*.sh. They can be pre-set as env vars before sourcing.
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
| `--dry-run` | `DRY_RUN=1` | common::parse_args |
| `--no-rtk` | `SKIP_OPTIONAL_BOOTSTRAP=1` | common::parse_args |
| `--force` | `FORCE=1` | common::parse_args — settings layer only |
| `--remove-plugins` | `REMOVE_PLUGINS=1` | common::parse_args — plugin+skills layer only |
| `--fable` | `FABLE=1` | common::parse_args — deploy-time modifier, consumed by claude::sync_fable |
| `--permissive` | `PERMISSIVE=1` | common::parse_args — deploy-time modifier, consumed by claude::sync_permissive |
| `--claude` | `SYNC_CLAUDE=1`, `TARGET_FILTER_SET=1` | common::parse_args |
| `--codex` | `SYNC_CODEX=1`, `TARGET_FILTER_SET=1` | common::parse_args |
| `--agents` | `SYNC_AGENTS=1`, `TARGET_FILTER_SET=1` | common::parse_args |
| (none) | `SYNC_CLAUDE=SYNC_CODEX=SYNC_AGENTS=1` | common::parse_args (default-all-three) — TARGET_FILTER_SET remains 0 |

Unknown flags: `err "Unknown arg: $arg"; exit 2` (common::parse_args (unknown-flag exit 2)).

### Default-All-Three Logic

```bash
# common::parse_args (default-all-three)
if [[ "$TARGET_FILTER_SET" -eq 0 ]]; then
  SYNC_CLAUDE=1
  SYNC_CODEX=1
  SYNC_AGENTS=1
fi
```

### Dispatch + SoT-Presence Guard

```bash
# sync.sh (Claude dispatch block) — library sourced INSIDE the conditional
if [[ "$SYNC_CLAUDE" -eq 1 && -d "$REPO_DIR/SoT/.claude" ]]; then
  source "$REPO_DIR/lib/claude.sh"
  claude::sync
fi
```

If `SoT/.claude/` is absent (partial clone), the entire Claude sync is silently skipped — no error. This is intentional for portability.

### Summary/Next-Steps Guard

```bash
# sync.sh (summary declare-F guard) — only runs if lib was actually sourced
if declare -F claude::summary >/dev/null 2>&1; then
  claude::summary
fi
```

Functions guarded with `[[ "${CLAUDE_SYNCED:-0}" -eq 1 ]] || return` (claude::summary) also skip if the tool was not synced.

### Preflight Checks

| Condition | Checks | anchor |
|-----------|--------|--------|
| `SYNC_CLAUDE=1` OR `SYNC_CODEX=1` | `jq` in PATH | common::preflight |
| `SYNC_CLAUDE=1` | `curl` in PATH | common::preflight |

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

- `REPO_DIR` set at sync.sh (REPO_DIR assignment) from `$0`'s directory, not `$PWD` — safe for `~/projects/public/sync.sh` invocations from anywhere.
- `lib/*.sh` files are sourced inside SoT-presence conditionals (sync.sh (SoT-presence dispatch blocks)), not at the top of the script — partial checkouts silently skip missing tools.
- `declare -F` guard at sync.sh (summary declare-F guards) means summary/next_steps are no-ops when the tool's lib was never sourced.
- Flag variables use `${VAR:-0}` defaults (common.sh (flag-var init block)) so they can be pre-set as env vars (`DRY_RUN=1 ./sync.sh`).
- `--force` and `--remove-plugins` are orthogonal layers — combining them triggers both settings reconcile AND plugin/skills reconcile. Neither flag alone touches the other's layer.

## Gotchas

- **`return` vs `exit` in dry-run blocks**: using `exit` instead of `return` terminates the entire script, not just the current function. Every dry-run block MUST use `return`. (claude::sync_scripts uses `return`.)
- **Forgetting `|| true` on legitimately-fallible commands**: `set -euo pipefail` at sync.sh (set -euo pipefail) means any unguarded non-zero exit aborts the run. `claude::_cli plugin marketplace update` at claude::_plugins_update demonstrates the `|| true` guard.
- **Tool-scoped summary mismatch**: if `claude::summary` is added to a lib file that checks `CLAUDE_SYNCED` but the sync function never sets `CLAUDE_SYNCED=1`, summary is always silently skipped. Check claude::sync for the assignment location.
- **Unknown flags exit 2**: passing a mistyped flag (e.g. `--not-a-real-flag`) exits with code 2 immediately (common::parse_args (unknown-flag exit 2)). No partial sync occurs.

## References

- `references/flag-matrix.md` — full truth table across all flag combinations; read when debugging unexpected sync behavior
- `references/dispatch-flow.md` — annotated dispatch order and SoT-presence guard sequence; read when adding a new tool target
