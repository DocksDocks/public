# Sync layers

`docks-kit sync [claude] [codex] [agents]` — targets are positional words;
no target means all three.

## claude (→ ~/.claude, ~/.claude.json, shell rc)

Order matters — runtime readiness and settings form one transaction:

1. **RTK** (toolchain-gated): install/upgrade, then `rtk init --global` on
   first install. Runs FIRST because rtk init rewrites settings.json — the
   later settings merge normalizes whatever it wrote.
2. Resolve/bootstrap pinned Bun, materialize the sentinel settings template,
   and prepare the merged settings bytes without mutation. If Bun remains
   unavailable, omit only the new runtime pointers and preserve legacy ones.
3. When ready, write `bin/statusline.mjs`, `bin/session-start.mjs`,
   `bin/notify.mjs`, and `notification.mp3`; deploy CLAUDE.md; atomically commit
   settings.
4. **settings.json merge semantics** — additive: SoT keys win, permissions arrays are
   unioned, user-only keys survive. `--reconcile` replaces permissions arrays
   wholesale instead.
5. **Removed-artifact pruning** — prune old shell assets, the Stop hook, and
   stale kit-owned settings. A flag-less sync removes `advisorModel`; an
   explicit advisor state excludes only that key so the modifier owns it.
6. **Deploy-time modifiers** (`--claude-compact-window`, `--claude-permissive`,
   `--claude-model`, `--claude-effort`, `--claude-advisor`) — deployed file only.
7. ~/.claude.json (showTurnDuration, user-scoped MCP servers) and connector env
   export.
8. **Plugins** — seven idempotent passes via the `claude plugin` CLI
   (marketplaces → install → update → [--prune: uninstall/remove] → re-assert
   SoT enabled-state). Optional opt-ins via `--claude-plugin=<name>`.
9. LSP server binaries (npm globals).

The statusline reads Claude's native `rate_limits`. There is no OAuth request,
usage cache, jq/curl runtime dependency, or Stop fetch hook.

## codex (→ ~/.codex, ~/.agents/plugins)

bubblewrap check (Linux), config.toml merge (top-level keys replaced
per-key, [table] blocks replaced wholesale, user-only keys/tables preserved),
`--codex-model` then `--codex-effort` modifiers, rules, AGENTS.md, personal
marketplace file, `codex plugin add` refresh.

## agents (→ ~/.agents/skills, ~/.claude/skills symlinks)

`npx skills add` per missing manifest slug, Claude symlink healing,
CLI binaries (agent-browser, effect-solutions — toolchain-gated), and the
kit-managed snapshot that `--prune` reconciles against.

## Reconcile flags

- `--reconcile` — settings layer: SoT-declared keys win; user-only preserved.
- `--prune` — plugins + marketplaces + kit-managed skills not in SoT are removed.
- Combine for a full reset to the SoT's kit-managed scope.
