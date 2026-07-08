# Sync layers

`docks-kit sync [claude] [codex] [agents]` — targets are positional words;
no target means all three.

## claude (→ ~/.claude, ~/.claude.json, shell rc)

Order matters — toolchain first, config after:

1. **RTK** (toolchain-gated): install/upgrade, then `rtk init --global` on
   first install. Runs FIRST because rtk init rewrites settings.json — the
   later settings merge normalizes whatever it wrote.
2. Scripts (statusline, fetch-usage, notification.mp3), hooks, CLAUDE.md.
3. **settings.json merge** — additive: SoT keys win, permissions arrays are
   unioned, user-only keys survive. `--reconcile` replaces permissions arrays
   wholesale instead.
4. **Deploy-time modifiers** (`--claude-compact-window`, `--claude-permissive`,
   `--claude-model`) — deployed file only.
5. ~/.claude.json (showTurnDuration, user-scoped MCP servers), connector env
   export, removed-artifact pruning.
6. **Plugins** — seven idempotent passes via the `claude plugin` CLI
   (marketplaces → install → update → [--prune: uninstall/remove] → re-assert
   SoT enabled-state). Optional opt-ins via `--claude-plugin=<name>`.
7. LSP server binaries (npm globals).

## codex (→ ~/.codex, ~/.agents/plugins)

bubblewrap check (Linux), config.toml merge (top-level keys replaced
per-key, [table] blocks replaced wholesale, user-only keys/tables preserved),
`--codex-model` modifier, rules, AGENTS.md, personal marketplace file,
`codex plugin add` refresh.

## agents (→ ~/.agents/skills, ~/.claude/skills symlinks)

`npx skills add` per missing manifest slug, Claude symlink healing,
CLI binaries (agent-browser, effect-solutions — toolchain-gated), and the
kit-managed snapshot that `--prune` reconciles against.

## Reconcile flags

- `--reconcile` — settings layer: SoT-declared keys win; user-only preserved.
- `--prune` — plugins + marketplaces + kit-managed skills not in SoT are removed.
- Combine for a full reset to the SoT's kit-managed scope.
