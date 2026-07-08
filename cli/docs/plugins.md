# Plugins: the enabledPlugins tri-state

`SoT/.claude/settings.json` → `enabledPlugins` values carry three meanings:

| Value | Meaning | `--prune` |
|-------|---------|-----------|
| `true` | Installed + enabled in every project | keeps installed |
| `false` | Installed + globally disabled; a project's `.claude/settings.json` can flip it to `true` per-repo | keeps installed |
| key absent | Not installed | uninstalls if present |

The user-scope key MUST stay present (as `false`) for per-project
re-enablement to work — Claude Code ignores project-level entries whose key
is absent from user settings.

## Sync passes (idempotent, via the `claude plugin` CLI)

1. Add SoT marketplaces not yet known
2. Install SoT-declared plugins missing at user scope
3. Refresh marketplace manifests; update installed plugins
4. (`--prune` only) uninstall plugins / remove marketplaces not in SoT
5. Re-assert SoT enabled-state (undoes install's enable side effect on
   false-keyed plugins)

## Optional opt-ins

Situational plugins are kept OUT of the SoT and opted in per machine:

```
docks-kit sync claude --claude-plugin=supabase
docks-kit sync claude --claude-plugin=supabase,n8n
```

Opt-ins are STICKY: with no SoT key to revert against, a later flag-less
sync leaves them alone; only `--prune` uninstalls them.

Caveat (supabase): its bundled MCP server's OAuth is account-global — the
opt-in only fits while every repo on the machine shares one Supabase account;
otherwise pin a per-repo .mcp.json instead.

## Inspect

```
docks-kit plugins list [--json]
```
