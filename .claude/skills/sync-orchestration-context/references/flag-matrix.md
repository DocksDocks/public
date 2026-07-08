# Flag Matrix — docks-kit sync / lib/engine.sh

## Critical Constraints

- `--reconcile` and `--prune` are ORTHOGONAL layers. Each operates independently. (common::parse_args)
- Targets are positional WORDS (`claude`, `codex`, `agents`), combinable. `common::select_target` sets `TARGET_FILTER_SET=1`, which suppresses the default-all-three path (common::parse_args, the default-all-three block).
- Unknown flags: `exit 2` immediately, no partial sync. (common::parse_args, the unknown-arg arm)
- Renamed legacy flags (`--force`, `--remove-plugins`, `--680k`, `--permissive`, `--supabase`, `--n8n`, `--no-rtk`, `--claude`/`--codex`/`--agents`) each print a rename hint and `exit 2` — clean break, no compat behavior. (common::parse_args, the "Renamed legacy flags" case arms)

## Full Truth Table

| --reconcile | --prune | --dry-run | `claude` word only | Effect |
|-------------|---------|-----------|--------------------|--------|
| 0 | 0 | 0 | 0 | Default additive sync all three tools |
| 0 | 0 | 1 | 0 | Preview all three tools; no writes |
| 1 | 0 | 0 | 0 | Reconcile settings layer; keep user-only keys; replace permissions arrays |
| 0 | 1 | 0 | 0 | Uninstall kit-managed plugins/marketplaces/skills not in SoT |
| 1 | 1 | 0 | 0 | Both: settings reconcile + plugin/skills uninstall |
| 0 | 0 | 0 | 1 | Sync Claude Code only; Codex + agents skipped |
| 1 | 0 | 0 | 1 | Reconcile Claude Code settings only |
| 0 | 1 | 0 | 1 | Uninstall kit-managed Claude plugins not in SoT |
| 1 | 0 | 1 | 0 | Preview what reconcile would do (no writes) |

## Variable Defaults (common.sh, the flag-var init block)

```bash
DRY_RUN=${DRY_RUN:-0}
SKIP_RTK=${SKIP_RTK:-0}
RECONCILE=${RECONCILE:-0}
PRUNE=${PRUNE:-0}
ASSUME_YES=${ASSUME_YES:-0}
CLAUDE_COMPACT_WINDOW=${CLAUDE_COMPACT_WINDOW:-}
CLAUDE_PERMISSIVE=${CLAUDE_PERMISSIVE:-0}
CLAUDE_PLUGINS=${CLAUDE_PLUGINS:-}
CLAUDE_MODEL=${CLAUDE_MODEL:-}
CODEX_MODEL=${CODEX_MODEL:-}
TARGET_FILTER_SET=${TARGET_FILTER_SET:-0}
SYNC_CLAUDE=${SYNC_CLAUDE:-0}
SYNC_CODEX=${SYNC_CODEX:-0}
SYNC_AGENTS=${SYNC_AGENTS:-0}
```

Pre-setting as env var: `RECONCILE=1 bash lib/engine.sh sync` is equivalent to `bash lib/engine.sh sync --reconcile`. `KNOWN_CLAUDE_OPTIN_PLUGINS="supabase n8n"` (common.sh, right after the init block) is the allow-list `common::add_claude_plugin` validates `--claude-plugin=` values against.

## Target Word Combination Examples

| Invocation (`docks-kit sync …` or `bash lib/engine.sh sync …`) | SYNC_CLAUDE | SYNC_CODEX | SYNC_AGENTS |
|-----------|-------------|------------|-------------|
| (no targets) | 1 | 1 | 1 |
| `claude` | 1 | 0 | 0 |
| `codex` | 0 | 1 | 0 |
| `claude codex` | 1 | 1 | 0 |
| `agents` | 0 | 0 | 1 |

## Layer Scope by Flag

| Layer | `--reconcile` | `--prune` | Default (no flags) |
|-------|---------------|-----------|--------------------|
| `~/.claude/settings.json` | SoT keys win; user-only preserved; permissions arrays replaced | No effect | Additive merge; permissions unioned |
| Plugin installs | No effect | Uninstall kit-managed not in SoT | Additive install only |
| `~/.agents/skills/` | No effect | Remove slugs in snapshot but not in skills.txt | Additive install only |

## Deploy-Time Modifiers

Run AFTER the settings merge and mutate only the DEPLOYED config — the opposite direction of `--reconcile` (away from SoT, not toward it). A later flag-less sync reverts all of them: the repo-wins merge restores the SoT compact window and model, the array union re-adds SoT ask/deny.

| Flag | Variable | Mutation | Consumer |
|------|----------|----------|----------|
| `--claude-compact-window=<n\|Nk>` | `CLAUDE_COMPACT_WINDOW=<tokens>` (normalized by `common::parse_compact_window`: `680k` → `680000`) | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "<tokens>"` | `claude::sync_compact_window` |
| `--claude-permissive` | `CLAUDE_PERMISSIVE=1` | `permissions.ask = []`, `permissions.deny = []` | `claude::sync_permissive` |
| `--claude-model=<m>` | `CLAUDE_MODEL=<m>` | `.model = "<m>"` (or `del(.model)` when `default`) in `~/.claude/settings.json` | `claude::sync_model` |
| `--codex-model=<m>` | `CODEX_MODEL=<m>` | `model = "<m>"` top-level line in `~/.codex/config.toml` | `codex::sync_model` |

The Claude modifiers are Claude-layer only (no-ops when the `claude` target is deselected — `common::validate_model_flags` even warns and clears a mismatched model flag), idempotent, and dry-run guarded; likewise `--codex-model` for the codex layer. `docks-kit model <tool> <value>` reaches the same two `sync_model` functions without a full sync (engine::model, the set path).

## Sticky Opt-Ins (`--claude-plugin=<name>`)

Unlike deploy-time modifiers, these are NOT reverted by a later flag-less sync — the plugin's key is absent from the SoT, so nothing re-asserts against it; only `--prune` uninstalls it.

| Value | Effect |
|-------|--------|
| `--claude-plugin=supabase` | `CLAUDE_PLUGINS+=" supabase"`; `claude::sync_optional_plugins` installs + enables `supabase@claude-plugins-official` |
| `--claude-plugin=n8n` | `CLAUDE_PLUGINS+=" n8n"`; adds the `czlonkowski/n8n-skills` marketplace, installs + enables `n8n-mcp-skills@n8n-mcp-skills` |
| `--claude-plugin=other` | `exit 2` — not in `KNOWN_CLAUDE_OPTIN_PLUGINS` (common::add_claude_plugin) |

Membership is tested with `common::claude_plugin_wanted <name>` (a space-delimited `case` match).

## Model Flags

- `--claude-model=<m>` / `--codex-model=<m>` are validated by `common::validate_model_flags` in `engine::sync` — after parse+preflight, BEFORE any mutation (fail-fast).
- Claude: catalog match against `SoT/models.json` (`common::_models_from_manifest claude`), else any `claude-*` ID applies with a warning, else exit 2 with the catalog printed (`common::print_models claude`).
- Codex: `^[A-Za-z0-9._-]+$` is the hard gate (blocks TOML-quote injection — the value lands inside a quoted config.toml string); a catalog miss only warns.
- Bare `--claude-model` / `--codex-model` (no `=`): prints the catalog, exits 2.

## Gotchas

- `--skip-rtk` sets `SKIP_RTK=1`, which skips BOTH the RTK bootstrap in `claude::sync_rtk` and the bubblewrap auto-install in `codex::ensure_bubblewrap`. Both optional bootstraps are gated on this one variable.
- Combining `--dry-run` with `--reconcile --prune`: all three flags are active simultaneously; dry-run preview shows what both destructive layers would do.
- `--claude-compact-window=abc` exits 2 (`common::parse_compact_window` returns 1 on junk); only digits or digits+`k`/`K` are accepted.
- A model flag with a deselected target does NOT exit — it warns and clears the variable (`common::validate_model_flags`, the deselected-target branch). Only an invalid VALUE for a selected target exits 2.
