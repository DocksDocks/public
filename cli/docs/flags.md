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
| `--skip-plugin-refresh` | Install missing Claude/Codex plugins but skip refresh-only updates; `docks-kit update` uses this automatically |
| `--yes` | Auto-accept toolchain above-verified prompts (containers/CI) |
| `--verbose` / `-v` | Also print no-op confirmations (already in sync, up to date, left as-is); accepted on `sync`, `model`, and `toolchain` |

## Per-tool flags

| Flag | Effect |
|------|--------|
| `--claude-model=<m>` | Deploy-time modifier: deployed model (aliases or full claude-* IDs; `default` unsets) |
| `--claude-effort=<level>` | Deploy-time modifier: `effortLevel`; valid `low`, `medium`, `high`, `xhigh`, or `default` (Claude SoT: `high`) |
| `--claude-advisor=<state>` | Deploy-time modifier: advisor `on`, `off`, or `default` (SoT off/unset) |
| `--claude-compact-window=<n>` | Deploy-time modifier: autocompact window in tokens (`680000` or `680k`) |
| `--claude-permissive` | Deploy-time modifier: empty permissions.ask/deny (sandboxes) |
| `--claude-plugin=<name>` | Sticky opt-in plugin (known: supabase, n8n); comma-separate for several |
| `--codex-model=<m>` | Deploy-time modifier: deployed Codex model |
| `--codex-effort=<level>` | Deploy-time modifier: `model_reasoning_effort`; valid `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, or `default` (Codex SoT: `high`; model-dependent) |

Bare model, effort, or advisor modifiers print the relevant valid-value catalog
and exit 2. A modifier for a target not selected by the positional arguments is
ignored with a warning; Claude modifiers never touch Codex config and vice versa.

## Docks workflow root flags

These flags belong at the root (`docks-kit --model-reviewer=...`), not after
`sync`. They update only the shared deployed workflow record.

| Flag | Accepted value |
|------|----------------|
| `--model-orchestrator=<selector>` | `profile:<name>` or `<tool>:<model>@<effort>[+fast]` |
| `--model-reviewer=<selector>` | same strict selector grammar |
| `--model-implementer=<selector>` | same strict selector grammar |
| `--review-min-score=<n>` | base-10 integer `0..100` |
| `--review-max-rounds=<n>` | base-10 integer `1..10` |

Use `docks-kit models workflow [--json]` for the closed registry. Bare, empty,
unknown, or malformed values print that helper and exit 2 before either prompt
file changes. `+fast` is accepted only on Codex exact targets and writes
`service_tier: "fast"` in workflow record schema 2. Without `+fast`, the role is
Standard and the record remains schema 1 unless another role is Fast. Shell
quotes are optional but recommended around selectors containing `+fast`.

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
