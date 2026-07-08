# Flag reference

Convention: global flags are unprefixed; anything touching one tool's
deployed config is `--<tool>-<setting>`.

## Targets (positional)

```
docks-kit sync                      # all three
docks-kit sync claude               # one
docks-kit sync claude agents        # two
```

## Global flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview without applying |
| `--reconcile` | Settings layer reconciled toward SoT (SoT keys win; user-only keys preserved; permissions arrays replaced) |
| `--prune` | Uninstall kit-managed installs not in SoT: plugins, marketplaces, universal skills |
| `--skip-rtk` | Skip optional tool bootstrap (RTK, bubblewrap) |
| `--yes` | Auto-accept toolchain above-verified prompts (containers/CI) |

## Per-tool flags

| Flag | Effect |
|------|--------|
| `--claude-model=<m>` | Deploy-time modifier: deployed model (aliases or full claude-* IDs; `default` unsets) |
| `--claude-compact-window=<n>` | Deploy-time modifier: autocompact window in tokens (`680000` or `680k`) |
| `--claude-permissive` | Deploy-time modifier: empty permissions.ask/deny (sandboxes) |
| `--claude-plugin=<name>` | Sticky opt-in plugin (known: supabase, n8n); comma-separate for several |
| `--codex-model=<m>` | Deploy-time modifier: deployed Codex model |

Bare `--claude-model` / `--codex-model` (no value) prints the model catalog.

## Renamed legacy flags (pre-CLI sync.sh)

Old flags exit with a rename hint — there is no compat behavior.

| Old | New |
|-----|-----|
| `--claude` / `--codex` / `--agents` | positional `claude` / `codex` / `agents` |
| `--force` | `--reconcile` |
| `--remove-plugins` | `--prune` |
| `--680k` | `--claude-compact-window=680k` |
| `--permissive` | `--claude-permissive` |
| `--supabase` / `--n8n` | `--claude-plugin=supabase` / `--claude-plugin=n8n` |
| `--no-rtk` | `--skip-rtk` |
