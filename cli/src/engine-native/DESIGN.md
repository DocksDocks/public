# EngineNative — design note (windows-support plan, step 3)

The TypeScript port of the sync engine. Lives in `cli/src/engine-native/`,
selected through the existing seam in `cli/src/engine.ts:10-29` — the only
file the rest of the CLI knows about. Plan: `docs/plans/active/windows-support.md`.

## Engine selection

`DOCKS_KIT_ENGINE` env var: `bash` | `native`.

- **Pre-flip** (plan step 5): default `bash`; `native` is opt-in — this is
  what lets the PowerShell CI job (step 7) exercise EngineNative before the
  flip.
- **Post-flip** (step 6 — the current state): default `native` on every platform; `bash` is the
  one-line per-machine revert. The bash engine stays the no-Bun escape hatch
  (`bash lib/engine.sh …`, unchanged vocabulary).

`engine.ts` keeps its two entry points: `engine(args)` (inherit stdio, exit
code propagation) and `engineCapture(args)` (stdout capture — consumed by
`status`). EngineNative implements the same `args` vocabulary: `sync`,
`model`, `toolchain`, and every flag `lib/common.sh` parses. No CLI command
changes at the call sites.

## Ground rules

- **Dry-run output is a parity contract.** Every module must emit dry-run
  lines byte-identical to the bash engine (harness 4(a) diffs them). Dry-run
  is computed from the same inputs, never from "what we would probably do".
- **Mutation shape is a parity contract.** Harness 4(b) diffs resulting
  files, `.bak` backups, snapshots, and recorded child-process argv against
  the bash engine on disposable HOMEs with stub binaries. A module lands
  only when both harnesses are green.
- **Same step ordering as bash.** The claude pipeline order
  (`lib/claude.sh:9-35`) is an invariant — rtk BEFORE the settings merge
  (init's settings rewrite gets normalized), deploy-time modifiers AFTER the
  merge (unclobberable), removals after modifiers.
- **External CLIs stay external.** `claude`, `codex`, `npx`, `npm`, `rtk`
  are driven via `child_process` `execFile` (argv arrays, never a shell
  string — quoting bugs are the known risk; the 4(b) stubs record argv to
  catch drift). These CLIs are already cross-platform.
- **Backups before mutation**, matching bash: `settings.json.bak`,
  `config.toml.bak`, `AGENTS.md.bak` are written exactly where bash writes
  them.

## Module map

Each module names its bash source (the behavior oracle) and its parity
fixture. Port order = plan step 5 (a)–(e); one PR-sized commit each.

| Module (file) | Ports | Bash oracle | Notes |
|---|---|---|---|
| `context.ts` | flag parsing, target selection, `KNOWN_CLAUDE_OPTIN_PLUGINS`, preflight (jq no longer needed natively — but preflight parity output preserved), model validation vs `SoT/models.json` | `lib/common.sh` | Pure functions; validation messages byte-match `common::print_models` |
| `dryrun.ts` | the `[dry-run]` line emitter | every `[[ "$DRY_RUN" -eq 1 ]]` branch | Single formatting helper so parity fixes happen in one place |
| `settings.ts` | Claude settings merge: first-install copy, additive deep-merge with `permissions.{allow,deny,ask}` array concat+unique, `--reconcile` mode (SoT keys win, arrays replaced wholesale, user-only keys preserved), invalid-JSON guard | `claude::sync_settings` + `claude::_settings_*` in `lib/claude.sh` | Native JSON — no jq. The jq semantics (`*` deep-merge, `unique`) are re-implemented and fixture-tested |
| `claudeJson.ts` | `~/.claude.json`: `showTurnDuration`, additive `mcpServers` merge | `claude::sync_claude_json` | |
| `connectorEnv.ts` | `ENABLE_CLAUDEAI_MCP_SERVERS`: shell-rc append (Linux/macOS, idempotent, never clobbers) OR `setx` on win32 — the Windows path bash never had (audit A6) | `claude::sync_connector_env` | win32: `setx ENABLE_CLAUDEAI_MCP_SERVERS false` + same "restart to take effect" messaging |
| `codexToml.ts` | codex config merge: deprecated-key scrub, top-level key replace-before-first-table, table-block replace/append, user-table preservation; `--codex-model` modifier | `lib/codex.sh:183-221`, `:224-275`, `:298-325` | **Line-based port of the awk logic — no TOML library** (a lib reformats user configs and breaks parity). Fixture suite 4(c) is the gate |
| `plugins.ts` | marketplace add, install passes 1–6, optional `--claude-plugin` opt-ins, `--prune` uninstalls, enabled-state reassert, LSP binary bootstrap (pinned) | `claude::sync_plugins` + `claude::_plugins_*`, `claude::sync_optional_plugins`, `claude::sync_lsp_servers` | All via `execFile("claude", ["plugin", …])` / `execFile("npm", …)`. The reassert's jq rewrite becomes native JSON |
| `skills.ts` | universal skills add/remove (pinned `npx skills@<verified>`), symlink heal with link-or-copy (`fs.symlink` → copy fallback, mirroring `skills::_link_or_copy`), snapshot, agent-browser/effect-solutions/bun bootstraps | `lib/skills.sh` | win32 gets `fs.symlink` (junction fallback for dirs) before copy |
| `toolchain.ts` | manifest reads, presence/version probes, `_is_newer`, the gate (TTY prompt via `readline`, `--yes`, non-TTY pinned-verified fallback, empty-latest → pinned), ensure, report table | `lib/toolchain.sh` | Report formatting byte-matches (`printf '%-28s…'`) for `engineCapture` parity |
| `removals.ts` | removed-artifact manifest pruning (hooks, files, settings keys, claude.json keys) | `claude::_removed_manifest` + `claude::sync_removals` | Manifest stays inline data, ported verbatim |
| `modifiers.ts` | `--claude-compact-window`, `--claude-permissive`, `--claude-model` (incl. `default` → delete key) | `claude::sync_compact_window` / `sync_permissive` / `sync_model` | |
| `rtk.ts` | rtk ensure (Unix: download-then-run installer from version tag, `RTK_VERSION` pin; win32: present-or-warn, no auto-install), `rtk init --global` when RTK.md absent, `--skip-rtk` incl. the CLAUDE.md import strip | `claude::sync_rtk` + `claude::_rtk_install` (`lib/claude.sh:805+`) | |
| `assets.ts` | scripts/hooks/CLAUDE.md/AGENTS.md/rules copies | `claude::sync_scripts` / `sync_hooks` / `sync_claude_md`, `codex::sync_rules` / `sync_agents_md` / `sync_marketplace` | Plain `fs` copies; chmod is a no-op on win32 |
| `model.ts` / direct modes | `model <tool> [value]` get/set, `toolchain check/ensure` — the `lib/engine.sh` direct modes | `lib/engine.sh:65-111`, `:114-145` | `engineCapture(["toolchain","check"])` output must byte-match for `status` |
| `summary.ts` | end-of-run summary + next-steps blocks | `*::summary` / `*::next_steps` | |

## Windows specifics (win32 only)

- Home = `os.homedir()` (already the rule in `cli/src/manifests.ts`).
- Paths built with `node:path` (`join`), never string `/` concatenation.
- Connector env via `setx`; no shell-rc writes.
- Symlinks: try `fs.symlinkSync` (type `junction` for directories), fall
  back to copy with the same warning contract as `skills::_link_or_copy`.
- No bubblewrap, no shell-rc, no ffplay assumptions — mirror the bash
  Phase-1 gates.
- **Out of scope**: statusline/hook `.sh` assets — they execute on Claude
  Code's own Git Bash runtime (see plan Context).

## Testing / parity harnesses (plan step 4 — prerequisite)

- `cli/test/fixtures/home-*` — fresh machine, existing-user-drift,
  invalid-JSON HOMEs.
- `cli/test/parity-dryrun.ts` — runs both engines' `sync --dry-run` on each
  fixture, byte-diffs (path-separator normalization on win32 only).
- `cli/test/parity-mutation.ts` — stub bin dir first on PATH
  (`claude`, `codex`, `npx`, `npm`, `rtk`, `bun` stubs record argv to a log
  and emit canned outputs), real runs of both engines on disposable copies
  of each fixture, then diffs: resulting tree, `.bak` files, snapshots, and
  the argv logs. Command matrix: `sync claude|codex|agents`, `--reconcile`,
  `--prune`, `--claude-plugin=…`, `model <tool> <v>`, `toolchain ensure`
  (TTY-declined / non-TTY / `--yes`).
- Both harnesses must be demonstrated RED once (intentionally broken
  fixture) before any module port lands.

## Non-goals

- Porting `statusline.sh` / `fetch-usage.sh` / `hooks/*.sh` (Claude Code
  runtime assets, not engine).
- Deleting the bash engine — separate decision after step 7 (plan open
  question `engine-bash-deprecation`).
- New features during the port: scope is behavior-preserving translation;
  divergences are bugs by definition (the harnesses enforce this).
