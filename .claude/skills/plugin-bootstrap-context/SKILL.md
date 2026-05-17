---
name: plugin-bootstrap-context
description: Use when modifying claude::sync_plugins (six-pass reconciler), codex::sync_marketplace, codex::bootstrap_marketplace, or extraKnownMarketplaces / enabledPlugins entries in SoT/.claude/settings.json; covers the true/false/absent tri-state semantics, why false-keyed plugins are kept on --remove-plugins (via jq -e ... | has($n) not truthiness), the claude-plugins-official removal protection at lib/claude.sh:212, the Codex unique_by(.name) dedup with user-entry-wins ordering, and the already added from a different source idempotency path in codex::bootstrap_marketplace.
user-invocable: false
metadata:
  source_files:
    - path: lib/claude.sh
      lines: "132-232"
    - path: lib/codex.sh
      lines: "320-379"
    - path: SoT/.claude/settings.json
      lines: "245-257"
    - path: SoT/.codex/plugins/marketplace.json
      lines: "1-23"
  updated: "2026-05-17"
---

# Plugin Bootstrap

<constraint>
The `--remove-plugins` guard for `enabledPlugins` uses `has($n)` — not truthiness. A `false`-keyed plugin passes `has()` and is KEPT. Only plugins whose key is ABSENT from `enabledPlugins` are uninstalled. Changing this to a truthiness test would uninstall all globally-disabled plugins. (lib/claude.sh:198)
</constraint>

<constraint>
`claude-plugins-official` is NEVER removed, even on `--remove-plugins` runs. The guard at lib/claude.sh:212 (`[[ "$mp_name" == "claude-plugins-official" ]] && continue`) is mandatory and must not be removed.
</constraint>

<constraint>
Plugin IDs follow the `<name>@<marketplace>` format (e.g. `docks@docks`, `n8n-mcp-skills@n8n-mcp-skills`). The `enabledPlugins` key must use this exact format. The install loop reads keys via `jq -r '.enabledPlugins // {} | keys[]'` (lib/claude.sh:181).
</constraint>

## When to Use

- Adding a new plugin to `SoT/.claude/settings.json` `enabledPlugins`
- Understanding why a plugin survives `--remove-plugins`
- Changing a plugin from globally-enabled (`true`) to globally-disabled (`false`)
- Debugging a marketplace add failure
- Modifying `codex::sync_marketplace` or `codex::bootstrap_marketplace`

## Core Patterns

### `enabledPlugins` Tri-State Semantics

| Value | Installed by kit? | Globally enabled? | Per-project can enable? | Survives `--remove-plugins`? |
|-------|------------------|------------------|------------------------|------------------------------|
| `true` | Yes | Yes | N/A | Yes (`has()` passes) |
| `false` | Yes | No | Yes (project settings.json) | Yes (`has()` passes) |
| absent | No | — | No (nothing to flip) | No (uninstalled by `--remove-plugins`) |

Source: lib/claude.sh:198 (`has($n)` test), SoT/.claude/settings.json (examples: `docks@docks: true`, `n8n-mcp-skills@n8n-mcp-skills: false`).

### Six-Pass Reconcile (`claude::sync_plugins`, lib/claude.sh:132-232)

| Pass | Condition | Action | Line |
|------|-----------|--------|------|
| 1 | Always | `claude plugin marketplace add` for missing `extraKnownMarketplaces` entries | 157-168 |
| 2 | Always | `claude plugin install` for missing `enabledPlugins` key entries | 170-182 |
| 3 | Always | `claude plugin marketplace update` (refresh manifests) | 183 |
| 4 | Always | `claude plugin update <id>` for each installed plugin | 185-193 |
| 5 | `REMOVE_PLUGINS=1` | `claude plugin uninstall -y` for installed plugins not in `enabledPlugins` via `has()` | 195-207 |
| 6 | `REMOVE_PLUGINS=1` | `claude plugin marketplace remove` for extra marketplaces not in `extraKnownMarketplaces` | 209-222 |

Pass 3 uses `|| true` (lib/claude.sh:183) — marketplace update failures are non-fatal. Pass 4 uses `|| true` (lib/claude.sh:188) — individual plugin update failures are non-fatal.

### Pass 1 — Marketplace Pre-Check

```bash
# lib/claude.sh:159
if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
  continue
fi
```

Checks key presence in `known_marketplaces.json`, not URL validity. A broken marketplace URL already in the file is NOT re-added.

### Pass 5 — `has($n)` Removal Guard

```bash
# lib/claude.sh:198
if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then
  claude plugin uninstall -y "$plugin_id" …
fi
```

`has($n)` returns true for both `"key": true` AND `"key": false`. Only uninstalls when the key is completely absent.

### Pass 6 — `claude-plugins-official` Protection

```bash
# lib/claude.sh:211-212
[[ -z "$mp_name" ]] && continue
[[ "$mp_name" == "claude-plugins-official" ]] && continue
```

### Codex Marketplace Merge (`codex::sync_marketplace`, lib/codex.sh:335-344)

```bash
jq -s '
  .[0] as $repo | .[1] as $user |
  ($user * {name: ($user.name // $repo.name), interface: ($user.interface // $repo.interface)}) |
  .plugins = (
    (($user.plugins // []) + ($repo.plugins // []))
    | reverse
    | unique_by(.name)
    | reverse
  )
' "$codex_marketplace" "$user_codex_marketplace" > "$user_codex_marketplace.tmp"
```

`reverse + unique_by(.name) + reverse` — last entry for a given `.name` survives `unique_by`. Since user array is first, reversing puts user entries LAST, `unique_by` keeps last = user entry wins on name collision. Second `reverse` restores original order.

### Codex Bootstrap Idempotency (`codex::bootstrap_marketplace`, lib/codex.sh:358-379)

| `codex plugin marketplace add` output | Action |
|--------------------------------------|--------|
| Success (no special string) | `log "Codex Docks marketplace added"` |
| `"already added from a different source"` | Remove + re-add with correct source (lines 366-368) |
| `"could not find a Codex CLI binary"` | Warn; npm Codex not installed yet (line 364) |
| Other `error`/`failed` | Warn; manual fallback (line 372) |

## Key Decisions

- `|| true` on passes 3 and 4 (lib/claude.sh:183, 188) — marketplace update and plugin updates are best-effort; failures must not abort the sync run.
- `claude` CLI is checked with `command -v claude` (lib/claude.sh:152) before the entire six-pass block. If absent, the whole block is skipped with a warning.
- Per-project plugin enable lives in the project's `.claude/settings.json` `enabledPlugins` block. The user-scope key must remain present (as `false`) — Claude Code ignores project-level entries whose key is absent from user settings.

## Gotchas

- **Marketplace pre-check checks presence, not validity** (lib/claude.sh:159): a bad GitHub URL already in `known_marketplaces.json` will not be corrected by re-running sync. Recovery: `claude plugin marketplace remove <name>` then re-run sync.
- **`false`-keyed plugins ARE installed** (pass 2, lib/claude.sh:170-182): the install loop reads all keys from `enabledPlugins` regardless of value. This is intentional — `false` means "installed, globally disabled."
- **Codex `command -v codex` matches the kit's own launcher** (lib/codex.sh:361): if the kit launcher is present but the npm Codex binary is not, `codex plugin marketplace add` fails with "could not find a Codex CLI binary" — the bootstrap handles this at lib/codex.sh:363-364.
- **Per-project `enabledPlugins: true` is silently ignored** if the user-scope key is absent — Claude Code requires the key to exist in user settings (even as `false`) before a project-level override can activate it.

## References

- `references/six-pass-flow.md` — annotated pass-by-pass walkthrough with jq and CLI invocations; read when debugging a specific pass
- `references/tri-state-semantics.md` — table of value × scenario × outcome; read when deciding what value to assign a new plugin entry
