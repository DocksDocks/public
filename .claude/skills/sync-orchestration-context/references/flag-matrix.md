# Flag Matrix — sync.sh

## Critical Constraints

- `--force` and `--remove-plugins` are ORTHOGONAL layers. Each operates independently. (common::parse_args)
- Target flags (`--claude`, `--codex`, `--agents`) can be combined. `common::select_target` sets `TARGET_FILTER_SET=1`, which suppresses the default-all-three path (common::parse_args (default-all-three)).
- Unknown flags: `exit 2` immediately, no partial sync. (common::parse_args (unknown-flag exit 2))

## Full Truth Table

| --force | --remove-plugins | --dry-run | --claude only | Effect |
|---------|-----------------|-----------|---------------|--------|
| 0 | 0 | 0 | 0 | Default additive sync all three tools |
| 0 | 0 | 1 | 0 | Preview all three tools; no writes |
| 1 | 0 | 0 | 0 | Reconcile settings layer; keep user-only keys; replace permissions arrays |
| 0 | 1 | 0 | 0 | Uninstall kit-managed plugins/skills not in SoT |
| 1 | 1 | 0 | 0 | Both: settings reconcile + plugin/skills uninstall |
| 0 | 0 | 0 | 1 | Sync Claude Code only; Codex + agents skipped |
| 1 | 0 | 0 | 1 | Reconcile Claude Code settings only |
| 0 | 1 | 0 | 1 | Uninstall kit-managed Claude plugins not in SoT |
| 1 | 0 | 1 | 0 | Preview what reconcile would do (no writes) |

## Variable Defaults (common.sh (flag-var init block))

```bash
DRY_RUN=${DRY_RUN:-0}
SKIP_OPTIONAL_BOOTSTRAP=${SKIP_OPTIONAL_BOOTSTRAP:-0}
FORCE=${FORCE:-0}
REMOVE_PLUGINS=${REMOVE_PLUGINS:-0}
WINDOW_680K=${WINDOW_680K:-0}
PERMISSIVE=${PERMISSIVE:-0}
TARGET_FILTER_SET=${TARGET_FILTER_SET:-0}
SYNC_CLAUDE=${SYNC_CLAUDE:-0}
SYNC_CODEX=${SYNC_CODEX:-0}
SYNC_AGENTS=${SYNC_AGENTS:-0}
```

Pre-setting as env var: `FORCE=1 ./sync.sh` is equivalent to `./sync.sh --force`.

## Target Flag Combination Examples

| Invocation | SYNC_CLAUDE | SYNC_CODEX | SYNC_AGENTS |
|-----------|-------------|------------|-------------|
| `./sync.sh` | 1 | 1 | 1 |
| `./sync.sh --claude` | 1 | 0 | 0 |
| `./sync.sh --codex` | 0 | 1 | 0 |
| `./sync.sh --claude --codex` | 1 | 1 | 0 |
| `./sync.sh --agents` | 0 | 0 | 1 |

## Layer Scope by Flag

| Layer | `--force` | `--remove-plugins` | Default (no flags) |
|-------|-----------|--------------------|-------------------|
| `~/.claude/settings.json` | SoT keys win; user-only preserved; permissions arrays replaced | No effect | Additive merge; permissions unioned |
| Plugin installs | No effect | Uninstall kit-managed not in SoT | Additive install only |
| `~/.agents/skills/` | No effect | Remove slugs in snapshot but not in skills.txt | Additive install only |

## Deploy-Time Modifiers (`--680k`, `--permissive`)

Run AFTER the settings merge and mutate only the DEPLOYED `~/.claude/settings.json` — the opposite direction of `--force` (away from SoT, not toward it). A later flag-less sync reverts both: the repo-wins merge restores the SoT compact window, the array union re-adds SoT ask/deny.

| Flag | Variable | Mutation | Consumer |
|------|----------|----------|----------|
| `--680k` | `WINDOW_680K=1` | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "680000"` | `claude::sync_680k` |
| `--permissive` | `PERMISSIVE=1` | `permissions.ask = []`, `permissions.deny = []` | `claude::sync_permissive` |

Both are Claude-layer only (no-ops under `--codex`/`--agents`-only runs since `claude::sync` never executes), idempotent, and dry-run guarded.

## Gotchas

- `--no-rtk` sets `SKIP_OPTIONAL_BOOTSTRAP=1` which also skips bubblewrap auto-install in `codex::ensure_bubblewrap` and the RTK bootstrap in `claude::sync_rtk`. Both RTK and bubblewrap are gated on this one variable.
- Combining `--dry-run` with `--force --remove-plugins`: all three flags are active simultaneously; dry-run preview shows what both destructive layers would do.
