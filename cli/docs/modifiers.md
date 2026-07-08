# Deploy-time modifiers

Modifiers change the **deployed** config for a specific machine profile —
the SoT is never touched. They all share one contract:

> A later flag-less sync reverts the modifier: the settings merge (Claude)
> and the config.toml merge (Codex) re-assert SoT values for kit-owned keys.
> Re-pass the flag on machines that should keep the override, or make it
> persistent in `~/.claude/settings.local.json` (which sync never touches).

| Modifier | Deployed change | Typical use |
|----------|-----------------|-------------|
| `--claude-model=<m>` | `.model` in ~/.claude/settings.json (`default` deletes the key) | Drop one machine to opus while the SoT stays on `best` |
| `--claude-compact-window=<n>` | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Disposable containers running long autonomous work (e.g. `680k`) — not host machines |
| `--claude-permissive` | `permissions.ask = []`, `permissions.deny = []` | Sandboxes/containers where prompts stall unattended work. Never on a host — the deny list is the safety floor |
| `--codex-model=<m>` | top-level `model = "…"` in ~/.codex/config.toml | Same as claude-model, for Codex |

## Standalone get/set (no full sync)

```
docks-kit model claude            # show deployed + SoT + catalog (+ TTY picker)
docks-kit model claude opus       # set deployed model
docks-kit model claude default    # delete the key (account default applies)
docks-kit model codex gpt-5.5     # codex flavor
```

The set path calls the same engine functions as the sync flags —
one implementation, two entry points.

## Sticky opt-ins are NOT modifiers

`--claude-plugin=<name>` installs+enables an optional plugin and it STAYS
(the SoT has no key to revert against). Only `--prune` removes it.
