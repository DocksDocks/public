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
`~/.docks-kit/kit.db`. A missing selection or an unreadable store selects `claude`,
`codex`, and `agents`, and never selects `omp`. Choose the stored selection
with `docks-kit harnesses`. With no stored selection, its picker pre-ticks all
four harnesses, `omp` included; a flag-less `sync` does not change until the
picker saves a selection. In the picker, Enter or Space ticks or unticks the
harness under the cursor, Enter on the Save row stores the selection, and
Escape leaves it unchanged.

## Global flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview without applying; takes no sync lock |
| `--reconcile` | Settings layer reconciled toward SoT (SoT keys win; user-only keys preserved; permissions arrays replaced) |
| `--prune` | Uninstall kit-managed installs not in SoT: plugins, marketplaces, and the universal skills that `~/.agents/.kit-owned-skills` names |
| `--skip-bubblewrap` | Skip optional bubblewrap bootstrap (Codex Linux sandbox) |
| `--skip-plugin-refresh` | Install missing Claude, Codex, and omp plugins but skip refresh-only updates |
| `--verbose` / `-v` | Also print no-op confirmations (already in sync, up to date, left as-is); accepted on `sync`, `model`, and `toolchain` |

## Environment overrides

| Variable | Effect |
|----------|--------|
| `DOCKS_KIT_SYNC_CONCURRENCY=1\|2\|3` | Maximum selected sync pipelines running at once. Default `3`; use `1` for serial golden/debug execution. Invalid values fail `sync` with exit 2 but do not affect `model` or `toolchain`. |
| `DOCKS_KIT_SYNC_LOCK_WAIT_MS=<ms>` | Time that `sync` and a `model` write wait for another sync to release the sync lock. A non-negative safe integer in milliseconds (at most `9007199254740991`); unset or empty means `120000` (120 s). Any other value prints `DOCKS_KIT_SYNC_LOCK_WAIT_MS must be a non-negative safe integer` and exits 2. |

## Sync lock

`sync` and `model <tool> <value>` hold the lock
`~/.cache/docks-kit/sync-lock.db` while they run, so two runs never write the
same files at once.

- A run waits up to 120 s for another run to release the lock
  (`DOCKS_KIT_SYNC_LOCK_WAIT_MS` changes the wait). It then prints
  `another docks-kit sync holds <path>; run sync again after it ends` and
  exits 1 with no change.
- Two homes can share a Codex folder (`CODEX_HOME`) or an agents folder
  (`AGENTS_DIR`). So a writing sync also holds `.docks-kit-sync-lock.db`
  inside the Codex folder when it syncs `codex`, and inside the agents folder
  when it syncs `agents`. A `model codex <value>` write holds the Codex folder
  lock too. The held line then names that lock file.
- A run with `--dry-run`, `-h`, or `--help` takes no lock. `model <tool>`
  without a value only reads, so it takes no lock.
- The lock goes when the run ends, also when the process is killed.
- A held lock also delays the error of an invalid argument until the wait
  ends.

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
| `--model <selector>` | Session model for this run and later runs; rejected unless the live catalog reports zero input and output cost with `pricingStatus` `free` or `unknown`; recorded in `~/.docks-kit/kit.db` (table `omp_session`) |
| `--pick` | Interactive picker over free catalog models; records the choice the same way |
| `--fast` | Toggle `tier.openai` between `priority` and `none` in the deployed `~/.omp/agent/config.yml`, print the change, and exit; the same tier omp's `/fast on` selects for OpenAI and Codex models |

The launcher starts omp as
`omp launch --config <overlay> --model <selector>[:<level>]`, followed by the
remaining arguments in the same order. `docks-kit omp -p "..."` runs one
prompt. `docks-kit omp --continue` resumes the previous session on the free
model. A bare `docks-kit omp` opens an interactive session. `launch` makes omp
read every forwarded word as message text, so no omp subcommand runs through
the launcher; run `omp` directly for a subcommand.

The launcher rejects a forwarded `--config`, `--model`, `--smol`, `--slow`,
`--plan`, `--models`, `--provider`, `--prewalk-into`, or `--plan-yolo-into`,
in the `--flag value` and the `--flag=value` form and also after a `--`. It
exits with code 2 before omp starts. The error names the flag and the
recoveries: `--model <selector>` before the other arguments or `--pick` for a
free model, and `omp` directly for a paid model. For a forwarded `--config`, it
also names `PI_CONFIG_FILES` for another config file. The launcher sets
`PI_SMOL_MODEL`, `PI_SLOW_MODEL`, and `PI_PLAN_MODEL` to the free role values,
warns once for each exported value that it replaces, and appends the overlay
to `PI_CONFIG_FILES`. See
[omp-models.md](omp-models.md#free-session-launcher-docks-kit-omp) for the
full policy and the paths that stay outside the launcher.

The launcher changes no deployed file and never invokes `sync`, except for
`--fast`, which changes only `tier.openai` and launches nothing. `--fast` over
`ultrafast` selects `priority`.
The boundary opens at the first token that is neither a declared launcher
flag nor a declared global flag. Declared flags stay with docks-kit and
never reach omp:

- `--model`, `--pick`, `--fast`
- `--help`, `--version`, `--log-level`, `--wizard`, `--completions`

The same names, except `--model`, stay reachable on omp behind an explicit
delimiter. `docks-kit omp -- --help` prints the help of `omp launch`. A
forwarded `--model` stops the launcher with exit 2, also behind `--`.

## `scratch` and `tidy`

| Command | Effect |
|------|--------|
| `scratch new <label>` | Create a private directory (mode 0700) `~/.cache/docks-kit/scratch/<label>-XXXXXX` and print its path; the label matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` |
| `scratch remove <path>...` | Remove each path whose real path is strictly inside the scratch root, the system temporary directory, or `/var/tmp`; print `removed <path>` or `refused <path>: <reason>`; exit 1 when any path is refused |
| `tidy` | List the safe leftover actions (`remove`, `stop`) and the kept candidates (`keep`) with reasons; change nothing |
| `tidy --apply` | Take the lock `~/.cache/docks-kit/tidy-lock.db`, then plan, perform those actions, and append the outcomes to `~/.cache/docks-kit/tidy.log`; exit 1 when an action fails. When another run holds the lock, print only `another docks-kit tidy run holds <path>`, with no plan and no report, and exit 0. A dry run (`tidy` without `--apply`) and the `--report` sections take no lock |
| `tidy --repo <path>` | Take the worktree candidates only from that repository, at any location |
| `tidy --report` | After the plan, print read-only sections on memory, temporary directories, processes, Docker, caches, Trash, git, agent histories, scheduled jobs, and global installs |

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
| `--skip-rtk` | `--skip-bubblewrap` |
