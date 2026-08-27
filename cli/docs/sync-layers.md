# Sync layers

`docks-kit sync [claude] [codex] [agents] [omp]` — targets are positional
words; no target means this machine's harness selection in
`~/.docks-kit/state.json`. The default is `claude codex agents`, and
`docks-kit harnesses` changes it.

## claude (→ ~/.claude, ~/.claude.json, shell rc)

Order matters — runtime readiness and settings form one transaction:

1. Resolve/bootstrap pinned Bun, materialize the sentinel settings template,
   and prepare the merged settings bytes without mutation. If Bun remains
   unavailable, omit only the new runtime pointers and preserve legacy ones.
2. When ready, write `bin/statusline.mjs`, `bin/session-start.mjs`,
   `bin/notify.mjs`, and `notification.mp3`; deploy CLAUDE.md; atomically commit
   settings.
3. **settings.json merge semantics** — additive: SoT keys win, permissions arrays are
   unioned, user-only keys survive. `--reconcile` replaces permissions arrays
   wholesale instead.
4. **Removed-artifact pruning** — prune old shell assets, the Stop hook, stale
   kit-owned settings, retired kit-owned plugin enablement, and every
   manifest-listed kit-owned `~/.local/bin` command. A flag-less sync removes
   `advisorModel`; an explicit advisor state excludes only that key so the
   modifier owns it.
5. **Deploy-time modifiers** (`--claude-compact-window`, `--claude-permissive`,
   `--claude-model`, `--claude-effort`, `--claude-advisor`) — deployed file only.
6. ~/.claude.json (showTurnDuration, user-scoped MCP servers) and connector env
   export.
7. **Plugins** — seven idempotent passes via the `claude plugin` CLI
   (marketplaces → install → update → [--prune: uninstall/remove] → re-assert
   SoT enabled-state). Optional opt-ins via `--claude-plugin=<name>`.
8. LSP server binaries (npm globals).

The statusline reads Claude's native `rate_limits`. There is no OAuth request,
usage cache, jq/curl runtime dependency, or Stop fetch hook.

## codex (→ ~/.codex, ~/.agents/plugins)

bubblewrap check (Linux), config.toml merge (top-level keys replaced
per-key, [table] blocks replaced wholesale, user-only keys/tables preserved,
and retired kit-owned `[plugins."<id>"]` tables stripped), `--codex-model`
then `--codex-effort` modifiers, rules, AGENTS.md, personal marketplace file,
and `codex plugin add` refresh.

## agents (→ ~/.agents/skills, ~/.claude/skills symlinks)

`npx skills add` per missing manifest slug, Claude symlink healing, and the
kit-managed snapshot that `--prune` reconciles against.

## omp (→ ~/.omp/agent, $PI_CODING_AGENT_DIR/intercom)

AGENTS.md, mcp.json, and intercom config.json are whole-file deploys;
config.yml is deep-merged (SoT keys win, mapping nodes merge, deployed-only
keys survive, stale slash-bearing `retry.fallbackChains` wildcards pruned).
Directories are mode 0700 and files mode 0600. Then the `docks` marketplace is
registered, `docks@docks` and `plan-lifecycle@docks` are installed or upgraded
through `omp plugin`, and `pi-intercom` is installed at its
`SoT/toolchain.json` pin. Inventory comes from `omp plugin list --json`, so a
repeat run is a no-op; `--skip-plugin-refresh` keeps installs but skips
refreshes. A dry run invokes no omp subcommand.

## Reconcile flags

- `--reconcile` — settings layer: SoT-declared keys win; user-only preserved.
- `--prune` — plugins + marketplaces + kit-managed skills not in SoT are removed.
- Combine for a full reset to the SoT's kit-managed scope.
