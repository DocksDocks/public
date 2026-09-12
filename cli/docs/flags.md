# Flag reference

Convention: global flags are unprefixed; anything touching one tool's
deployed config is `--<tool>-<setting>`.

## Targets (positional)

```
docks-kit sync                      # stored harness selection
docks-kit sync claude               # one
docks-kit sync claude agents        # two
docks-kit sync omp                  # opt-in harness
```

Positional targets are `claude`, `codex`, `agents`, and `omp`. A flag-less
`sync` deploys the per-machine harness selection stored in
`~/.docks-kit/state.json`. A missing or invalid state file selects `claude`,
`codex`, and `agents`, and never selects `omp`. Choose the stored selection
with `docks-kit harnesses`.

## Global flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview without applying |
| `--reconcile` | Settings layer reconciled toward SoT (SoT keys win; user-only keys preserved; permissions arrays replaced) |
| `--prune` | Uninstall kit-managed installs not in SoT: plugins, marketplaces, universal skills |
| `--skip-bubblewrap` | Skip optional bubblewrap bootstrap (Codex Linux sandbox) |
| `--skip-plugin-refresh` | Install missing Claude/Codex plugins but skip refresh-only updates |
| `--verbose` / `-v` | Also print no-op confirmations (already in sync, up to date, left as-is); accepted on `sync`, `model`, and `toolchain` |

## Environment overrides

| Variable | Effect |
|----------|--------|
| `DOCKS_KIT_SYNC_CONCURRENCY=1\|2\|3` | Maximum selected sync pipelines running at once. Default `3`; use `1` for serial golden/debug execution. Invalid values fail `sync` with exit 2 but do not affect `model` or `toolchain`. |

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

## `omp` session flags

| Flag | Effect |
|------|--------|
| `--model <selector>` | Session model for this run and later runs; rejected unless the live catalog reports zero input and output cost; recorded in `~/.docks-kit/state.json` under `ompSession` |
| `--pick` | Interactive picker over free catalog models; records the choice the same way |

Remaining arguments forward verbatim to omp after the launcher flags.
`docks-kit omp -p "..."` runs one prompt. `docks-kit omp --continue` resumes
the previous session. A bare `docks-kit omp` opens an interactive session.
The launcher changes no deployed file and never invokes `sync`.
The boundary opens at the first token that is neither a declared launcher
flag nor a declared global flag. Declared flags stay with docks-kit and
never reach omp:

- `--model`, `--pick`
- `--help`, `--version`, `--log-level`, `--wizard`, `--completions`

The same names on omp stay reachable behind an explicit delimiter. Use
`docks-kit omp -- --help` to ask omp for help.

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
