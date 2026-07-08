---
name: sync-orchestration-context
description: Use when editing lib/engine.sh, lib/common.sh, docks-kit, cli/src/main.ts, or any flag in --reconcile / --prune / --claude-model= / --codex-model= / --claude-compact-window= / --claude-permissive / --claude-plugin= / --skip-rtk / --yes / --dry-run, or the positional targets claude/codex/agents; covers the docks-kit → cli/src/main.ts → engine.ts seam dispatch chain (EngineNative in-process by default; DOCKS_KIT_ENGINE=bash routes to lib/engine.sh; sync.sh no longer exists), engine::sync/engine::model/engine::toolchain direct modes, TARGET_FILTER_SET default-all-three logic, additive-vs-reconcile orthogonality of RECONCILE and PRUNE, the CLAUDE_COMPACT_WINDOW/CLAUDE_PERMISSIVE/CLAUDE_MODEL/CODEX_MODEL deploy-time modifiers, the CLAUDE_PLUGINS opt-in list consumed by claude::sync_optional_plugins, the renamed-legacy-flag exit-2 hint arms (--force/--remove-plugins/--680k/--permissive/--supabase/--n8n/--no-rtk), common::parse_args / common::preflight / common::validate_model_flags invariants (SoT/models.json catalog validation), and the requirement that every lib/<tool>.sh step remain idempotent across re-runs. Also covers why claude::sync_rtk now runs FIRST in claude::sync.
user-invocable: false
metadata:
  source_files:
    - path: lib/engine.sh
      lines: "1-153"
    - path: lib/common.sh
      lines: "1-229"
    - path: docks-kit
      lines: "1-53"
    - path: cli/src/main.ts
      lines: "1-51"
    - path: lib/claude.sh
      lines: "750-798"
  updated: "2026-07-08"
---

# Sync Engine Orchestration

> **Feature-frozen surface.** `lib/*.sh` accepts bug fixes only (AGENTS.md
> § Engineering rules); new capabilities land in EngineNative
> (`cli/src/engine-native/`), the default engine since the step-6 flip of
> the `windows-support` plan — see the `engine-native-context` skill. A bug
> fix that changes behavior here must be mirrored in the TS port and pass
> the parity suites (`cli/test/parity-dryrun.ts` / `parity-mutation.ts`).

`sync.sh` is GONE. The entry chain is now: `./docks-kit` (launcher) → `cli/src/main.ts` (Effect-TS CLI) → `cli/src/engine.ts` (the single seam) → EngineNative in-process by DEFAULT; `DOCKS_KIT_ENGINE=bash` opts out to spawning `lib/engine.sh` (the feature-frozen bash engine). The zero-dependency escape hatch is `bash lib/engine.sh <same subcommands/flags>` — no Bun required.

<constraint>
Every new sync step MUST include a `[[ "$DRY_RUN" -eq 1 ]]` guard that prints `[dry-run] <what would happen>` and returns — without it, `bash lib/engine.sh sync --dry-run` executes the step for real. (claude::sync_scripts dry-run pattern)
</constraint>

<constraint>
Never construct SoT paths from `pwd`. All SoT paths MUST be prefixed with `$REPO_DIR/SoT/…` where `REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"` (lib/engine.sh, the REPO_DIR assignment — one level up because engine.sh lives in lib/). The engine is safe to invoke from any working directory because of this.
</constraint>

<constraint>
Any command that can legitimately fail non-fatally under `set -euo pipefail` (lib/engine.sh, the set line) MUST append `|| true` or `|| warn "…"`. Unguarded failures terminate the entire sync run. (claude::_plugins_update example: `claude::_cli plugin marketplace update >/dev/null 2>&1 || true`)
</constraint>

<constraint>
Flag variables are initialized in common.sh (flag-var init block) via `${VAR:-0}` / `${VAR:-}`. Never re-initialize them in lib/*.sh. They can be pre-set as env vars before sourcing.
</constraint>

<constraint>
Both engines speak the SAME flag vocabulary through the `cli/src/engine.ts` seam (`engine`/`engineCapture`): EngineNative (`runEngineNative`, in-process, the default) and `bash lib/engine.sh` (`DOCKS_KIT_ENGINE=bash`). A new flag must be added in THREE places — `common::parse_args`, `cli/src/engine-native/parseArgs.ts`, and the matching `cli/src/commands/*.ts` option list — and pass the parity suites.
</constraint>

## When to Use

- Adding a new flag, positional target, or engine subcommand
- Adding a new per-tool sync function that should respect `--dry-run`
- Changing default-all-three behavior when no target word is given
- Debugging why a target is syncing when not expected
- Adding a new tool's SoT dispatch block to `engine::sync`
- Changing model validation (`common::validate_model_flags`, `SoT/models.json`)

For `lib/toolchain.sh` / `SoT/toolchain.json` (verified-version gates, `toolchain::ensure`, install callbacks), use the `toolchain-context` skill instead — this skill only covers how the engine dispatches into it.

## Entry Points

| Invocation | Path | Notes |
|-----------|------|-------|
| `./docks-kit <args>` | compiled binary in `cli/dist/docks-kit-<os>-<arch>` if present, else Bun-from-source (`cli/src/main.ts`); auto-installs Bun (download-then-run) + `bun install --frozen-lockfile` when missing | canonical UX (docks-kit, the KIT_BIN case + find_bun fallback) |
| `bash lib/engine.sh <args>` | bash engine directly | zero-dependency escape hatch; same subcommands/flags |
| `cli/src/engine.ts` | `runEngineNative(args)` in-process (default) or `Subprocess.make("bash", "lib/engine.sh", ...)` under `DOCKS_KIT_ENGINE=bash` | the single seam; CLI-side validation failures use `bail` |

`lib/engine.sh` direct modes (the trailing `case "${1:-}"` dispatcher; bare args default to `sync`):

| Subcommand | Function | What it does |
|------------|----------|--------------|
| `sync [claude] [codex] [agents] [flags]` | `engine::sync` | full sync: parse_args → preflight → validate_model_flags → per-tool `::sync` |
| `model <claude\|codex> [value] [--dry-run]` | `engine::model` | get (no value: deployed vs SoT + catalog) or set the DEPLOYED model — set path validates then calls `claude::sync_model` / `codex::sync_model`, sharing one implementation with the sync-time modifier flags |
| `toolchain check` | `engine::toolchain` → `toolchain::report` | doctor table |
| `toolchain ensure <tool> [--yes]` | `engine::toolchain` | single-tool install/upgrade; managed tools only (rtk, bun, effect-solutions, agent-browser), each wired to its owning lib's callback |

## Core Patterns

### Flag → Variable Mapping (common::parse_args)

Targets are POSITIONAL WORDS now, not flags: `claude`, `codex`, `agents` (common::select_target sets `SYNC_<TOOL>=1` + `TARGET_FILTER_SET=1`).

| Flag | Variable set | Notes |
|------|-------------|-------|
| `--dry-run` | `DRY_RUN=1` | |
| `--reconcile` | `RECONCILE=1` | settings layer only (was `--force`) |
| `--prune` | `PRUNE=1` | plugin+marketplace+skills layer only (was `--remove-plugins`) |
| `--skip-rtk` | `SKIP_RTK=1` | skips optional tool bootstrap: RTK AND bubblewrap (was `--no-rtk` / `SKIP_OPTIONAL_BOOTSTRAP`) |
| `--yes` | `ASSUME_YES=1` | auto-accept toolchain verified-pin prompts (containers/CI) |
| `--claude-model=<m>` | `CLAUDE_MODEL` | deploy-time modifier; validated by `common::validate_model_flags`; bare `--claude-model` prints the catalog and exits 2 |
| `--codex-model=<m>` | `CODEX_MODEL` | deploy-time modifier; charset-validated (TOML-injection gate) |
| `--claude-compact-window=<n>` | `CLAUDE_COMPACT_WINDOW` | accepts raw tokens or `Nk` via `common::parse_compact_window` (was `--680k` / `WINDOW_680K`); junk value exits 2 |
| `--claude-permissive` | `CLAUDE_PERMISSIVE=1` | was `--permissive` / `PERMISSIVE` |
| `--claude-plugin=<name>` | appends to `CLAUDE_PLUGINS` (space-separated) | repeatable; `common::add_claude_plugin` rejects names outside `KNOWN_CLAUDE_OPTIN_PLUGINS` ("supabase n8n") with exit 2; consumed via `common::claude_plugin_wanted` (was `--supabase` / `--n8n`) |
| (none) | `SYNC_CLAUDE=SYNC_CODEX=SYNC_AGENTS=1` | default-all-three — `TARGET_FILTER_SET` remains 0 |

Unknown flags: `err "Unknown arg: $arg"; exit 2` (common::parse_args, the unknown-arg arm).

### Renamed legacy flags — hint and refuse

Old flag names are a CLEAN BREAK: each gets a dedicated case arm that prints the rename and exits 2 — no compat behavior (common::parse_args, the "Renamed legacy flags" case arms):

| Old | Hint printed |
|-----|--------------|
| `--claude` / `--codex` / `--agents` | "renamed: pass the target as a word, e.g. 'sync claude'" |
| `--force` | renamed to `--reconcile` |
| `--remove-plugins` | renamed to `--prune` (also removes marketplaces + kit-managed skills) |
| `--680k` | renamed to `--claude-compact-window=680k` |
| `--permissive` | renamed to `--claude-permissive` |
| `--supabase` / `--n8n` | renamed to `--claude-plugin=supabase` / `--claude-plugin=n8n` |
| `--no-rtk` | renamed to `--skip-rtk` |

When editing these arms, keep the old names ONLY here — nowhere else in the kit should reference them except as rename documentation.

### Model validation (common::validate_model_flags)

Runs in `engine::sync` after `common::parse_args` + `common::preflight` and BEFORE any sync step mutates state — fail-fast, so a bad model value can never abort a half-finished sync (common::validate_model_flags, the fail-fast comment). When a model flag is set but its target is deselected, it warns and CLEARS the variable instead of erroring (`--claude-model ignored: claude target not selected`).

| Validator | Rule |
|-----------|------|
| `common::_validate_claude_model` | catalog match (from `SoT/models.json` via `common::_models_from_manifest`), else any `claude-*` ID accepted with a warning, else fail |
| `common::_validate_codex_model` | `^[A-Za-z0-9._-]+$` charset is the HARD gate — the value is interpolated into a quoted config.toml string, so this also blocks TOML-quote injection; catalog miss only warns |
| `common::print_models` | human-readable catalog to stderr — used by bare-flag help and validation failures |

`common::_models_from_manifest` is a silent no-op when `SoT/models.json` or jq is unavailable (validators then fall back to their pattern checks).

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
# engine::sync (Claude dispatch block) — library sourced INSIDE the conditional
if [[ "$SYNC_CLAUDE" -eq 1 && -d "$REPO_DIR/SoT/.claude" ]]; then
  source "$REPO_DIR/lib/claude.sh"
  claude::sync
fi
```

If `SoT/.claude/` is absent (partial clone), the entire Claude sync is silently skipped — no error. This is intentional for portability. `lib/common.sh` and `lib/toolchain.sh` are the only libs sourced unconditionally at the top of `lib/engine.sh`.

### Summary/Next-Steps Guard

```bash
# engine::sync (summary declare-F guard) — only runs if lib was actually sourced
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

### Orthogonality: --reconcile vs --prune

| Flag | Layer affected | What wins |
|------|---------------|-----------|
| `--reconcile` | `~/.claude/settings.json` keys | SoT-declared keys; user-only keys preserved; permissions arrays replaced |
| `--prune` | Plugin + marketplace + skills installs | SoT manifest; user-only installs preserved |
| Both | Both layers | Combined effect; user-only additions outside kit scope always preserved |

## Key Decisions

- `REPO_DIR` is set in `lib/engine.sh` from `$0`'s parent directory (`$(dirname "$0")/..`), not `$PWD` — safe to invoke from anywhere. The CLI side resolves the same root via `kitHome()` (`DOCKS_KIT_HOME` env → nearest ancestor with `SoT/` + `lib/engine.sh` → the package's own root).
- `lib/<tool>.sh` files are sourced inside SoT-presence conditionals (engine::sync, the dispatch blocks), not at the top of the script — partial checkouts silently skip missing tools. `engine::model` and `engine::toolchain` also source their lib lazily per subcommand.
- `declare -F` guards (engine::sync, the summary/next_steps blocks) make summary/next_steps no-ops when a tool's lib was never sourced.
- Flag variables use `${VAR:-0}` / `${VAR:-}` defaults (common.sh, the flag-var init block) so they can be pre-set as env vars (`DRY_RUN=1 bash lib/engine.sh sync`).
- `--reconcile` and `--prune` are orthogonal layers — combining them triggers both settings reconcile AND plugin/skills reconcile. Neither flag alone touches the other's layer.
- `engine::model`'s set path reuses the deploy-time modifier functions (`claude::sync_model` / `codex::sync_model`) so `docks-kit model claude opus` and `docks-kit sync claude --claude-model=opus` share ONE implementation (engine::model, the reuse comment). Both modifier functions carry a `${CLAUDE_DIR:-$HOME/.claude}` / `${CODEX_DIR:-$HOME/.codex}` fallback because `claude::sync` / `codex::sync` may not have run.

## Gotchas

- **`return` vs `exit` in dry-run blocks**: using `exit` instead of `return` terminates the entire script, not just the current function. Every dry-run block MUST use `return`. (claude::sync_scripts uses `return`.)
- **Forgetting `|| true` on legitimately-fallible commands**: `set -euo pipefail` in every bash file means any unguarded non-zero exit aborts the run. `claude::_cli plugin marketplace update` at claude::_plugins_update demonstrates the `|| true` guard.
- **Tool-scoped summary mismatch**: if `claude::summary` is added to a lib file that checks `CLAUDE_SYNCED` but the sync function never sets `CLAUDE_SYNCED=1`, summary is always silently skipped. Check claude::sync for the assignment location.
- **Unknown flags exit 2**: passing a mistyped flag (e.g. `--not-a-real-flag`) exits with code 2 immediately (common::parse_args, the unknown-arg arm). No partial sync occurs.
- **Bare value flags exit 2 with help**: `--claude-model` / `--codex-model` without `=<value>` print the model catalog (common::print_models) then exit 2; `--claude-compact-window` and `--claude-plugin` without a value print a usage hint and exit 2.
- **Model flags are cleared, not fatal, on target mismatch**: `sync codex --claude-model=opus` warns and clears `CLAUDE_MODEL` — it does not exit (common::validate_model_flags, the deselected-target warn+clear branch).

## RTK bootstrap

`claude::sync_rtk` is now the FIRST pass in `claude::sync` — on a first-ever install, `rtk init --global` rewrites `~/.claude/settings.json` (clears `hooks.PreToolUse`), so it must run BEFORE the settings merge; the merge then normalizes whatever rtk wrote, and the deploy-time modifiers land after the merge, unclobberable (claude::sync, the toolchain-before-config comment). This inverts the old sync.sh order and removes the old first-sync hook-wipe gotcha.

| Concern | Behavior | Anchor |
|---------|----------|--------|
| Skip gate | `SKIP_RTK=1` → warn + early return before any install | claude::sync_rtk (the SKIP_RTK early-return) |
| `@RTK.md` strip | On `--skip-rtk`, the `@RTK.md` import line is removed from `~/.claude/CLAUDE.md` — DRY_RUN-gated, so preview never strips | claude::sync_rtk (the grep -v '^@RTK.md$' branch) |
| Install/upgrade | Delegated to `toolchain::ensure rtk claude::_rtk_install` — the callback does a download-then-run install honoring an exact-version pin via the installer's `RTK_VERSION` env (`claude::_rtk_install`, the `RTK_VERSION="${version:+v$version}"` invocation); upgrades are gated by the `SoT/toolchain.json` verified pin (see the `toolchain-context` skill) | claude::sync_rtk (the toolchain::ensure call) |
| PATH export | Post-install `export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"` so the fresh `rtk` resolves in-process | claude::_rtk_install (the PATH export) |
| Init gate | `rtk init --global` runs ONLY when `~/.claude/RTK.md` is absent — the idempotency gate | claude::sync_rtk (the RTK.md absence check) |

DELETED (behavior superseded — do not cite): `claude::_rtk_reassert_hook` (the settings merge now runs after rtk init, so no re-assert is needed) and `claude::_warn_rtk_outdated` (version compare + upgrade advisories now live in `toolchain::ensure` / `toolchain::_is_newer`; the old shared numeric-sort anchor with `skills::_agent_browser_newer_npm` is gone too — that helper was also deleted).

## References

- `references/flag-matrix.md` — full flag/variable truth table across all combinations; read when debugging unexpected sync behavior
- `references/dispatch-flow.md` — annotated dispatch order from docks-kit down to per-tool sync functions; read when adding a new tool target or engine subcommand
