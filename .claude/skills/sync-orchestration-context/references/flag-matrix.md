# Flag Matrix - docks-kit sync

## Critical Constraints

- `--reconcile` and `--prune` are orthogonal layers.
- Targets are positional words: `claude`, `codex`, `agents`.
- Unknown flags and renamed legacy flags exit 2 before mutation.
- Bare value flags such as `--claude-model` exit 2; use `--flag=value`.

## Full Truth Table

| `--reconcile` | `--prune` | `--dry-run` | `claude` only | Effect |
|---------------|-----------|-------------|---------------|--------|
| 0 | 0 | 0 | 0 | Additive sync for all three targets. |
| 0 | 0 | 1 | 0 | Preview all three targets. |
| 1 | 0 | 0 | 0 | Reconcile settings layer; keep user-only keys. |
| 0 | 1 | 0 | 0 | Remove kit-managed plugins, marketplaces, and skills not in SoT. |
| 1 | 1 | 0 | 0 | Reconcile settings and prune removable kit-managed installs. |
| 0 | 0 | 0 | 1 | Sync Claude only. |
| 1 | 0 | 0 | 1 | Reconcile Claude settings only. |
| 0 | 1 | 0 | 1 | Prune Claude plugin/marketplace layer only. |
| 1 | 0 | 1 | 0 | Preview reconcile without writes. |

## Context Fields

| Flag | Field |
|------|-------|
| `--dry-run` | `ctx.dryRun` |
| `--skip-rtk` | `ctx.skipRtk` |
| `--reconcile` | `ctx.reconcile` |
| `--prune` | `ctx.prune` |
| `--yes` | `ctx.assumeYes` |
| `--claude-compact-window=<n|Nk>` | `ctx.claudeCompactWindow` |
| `--claude-permissive` | `ctx.claudePermissive` |
| `--claude-plugin=<name>` | `ctx.claudePlugins` |
| `--claude-model=<m>` | `ctx.claudeModel` |
| `--codex-model=<m>` | `ctx.codexModel` |
| target word present | `ctx.targetFilterSet` |

Default target behavior: when no target word is present, Claude, Codex, and
agents are all selected. Once any target word appears, only named targets run.

## Layer Scope By Flag

| Layer | `--reconcile` | `--prune` | Default |
|-------|---------------|-----------|---------|
| `~/.claude/settings.json` | SoT keys win; permissions arrays replaced | No effect | Additive merge; permissions unioned |
| Claude plugins/marketplaces | No effect | Remove kit-managed records absent from SoT | Additive install/update |
| Codex personal marketplace/plugins | Additive merge still preserves user entries | Remove legacy configured Docks marketplace only | Deploy and refresh enabled plugins |
| `~/.agents/skills/` | No effect | Remove snapshot-managed slugs absent from manifest | Additive install and symlink heal |

## Deploy-Time Modifiers

These run after base deployment and mutate deployed config away from the SoT.
A later flag-less sync restores SoT values.

| Flag | Function | Mutation |
|------|----------|----------|
| `--claude-compact-window=<n|Nk>` | `syncCompactWindow` | Sets `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW`. |
| `--claude-permissive` | `syncPermissive` | Clears Claude ask/deny arrays. |
| `--claude-model=<m>` | `syncClaudeModel` | Sets or deletes deployed `.model`. |
| `--codex-model=<m>` | `syncCodexModel` | Replaces deployed top-level `model = "..."`

## Sticky Opt-Ins

Optional Claude plugins are absent from the SoT. Once installed by
`--claude-plugin=<name>`, they persist through flag-less syncs and are removed
only by `--prune`.

| Value | Effect |
|-------|--------|
| `supabase` | Install and enable `supabase@claude-plugins-official`. |
| `n8n` | Add `czlonkowski/n8n-skills`, then install and enable `n8n-mcp-skills@n8n-mcp-skills`. |
| anything else | Exit 2. |

## Model Flags

- `validateModelFlags(ctx)` runs after parsing and before mutation. Dependencies
  are checked by their consumers rather than a global preflight.
- Claude catalog misses are accepted only for `claude-*` IDs, with a warning.
- Codex values must match the safe quoted-TOML charset.
- A model flag for a deselected target warns and clears that field.

## Gotchas

- `--skip-rtk` also skips Codex bubblewrap auto-install.
- Combining `--dry-run --reconcile --prune` previews both destructive layers.
- `--claude-compact-window=abc` exits 2; only digits or digits plus `k`/`K`
  are accepted.
