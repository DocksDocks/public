# Deploy-time modifiers

Modifiers change the **deployed** config for a specific machine profile —
the SoT is never touched. They all share one contract:

> A later flag-less sync reverts the modifier: the settings merge (Claude)
> and the config.toml merge (Codex) re-assert SoT values for kit-owned keys.
> Re-pass the flag on machines that should keep the override. Claude-only
> profiles can instead use `~/.claude/settings.local.json`, which sync never
> touches.

Claude's embedded SoT is `model: fable`, `effortLevel: high`, with advisor
off (`advisorModel` unset). Codex's embedded normal and plan reasoning effort is
`high`.

| Modifier | Deployed change | Typical use |
|----------|-----------------|-------------|
| `--claude-model=<m>` | `.model` in ~/.claude/settings.json (`default` deletes the key) | Override one machine while the SoT retains `fable` |
| `--claude-effort=<level>` | `.effortLevel` in ~/.claude/settings.json (`default` writes `high`) | Tune persisted Claude effort per machine; valid `low`, `medium`, `high`, `xhigh` |
| `--claude-advisor=<state>` | `on` sets `.advisorModel = "fable"`; `off`/`default` remove it | Enable Claude advisor only on machines that need it |
| `--claude-compact-window=<n>` | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Disposable containers running long autonomous work (e.g. `680k`) — not host machines |
| `--claude-permissive` | `permissions.ask = []`, `permissions.deny = []` | Sandboxes/containers where prompts stall unattended work. Never on a host — the deny list is the safety floor |
| `--codex-model=<m>` | top-level `model = "…"` in ~/.codex/config.toml | Same as claude-model, for Codex |
| `--codex-effort=<level>` | top-level `model_reasoning_effort = "…"` (`default` writes `high`) | Tune Codex effort per machine; valid `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` (model-dependent) |

Bare effort/advisor flags print their verified catalog and exit 2. Invalid
values do the same with a clear error. Passing a tool-specific modifier without
selecting that positional target warns and ignores it.

A flag-less Claude sync also removes the formerly kit-owned `advisorModel`
from machines synced before advisor became opt-in. Any explicit advisor state
owns that key for the run: `on` writes `fable`; `off` and `default` delete it.
Codex has no advisor modifier because its documented config has no advisor
setting; `review_model` applies only to `/review`.

Codex Fast mode is intentionally not a global SoT default or per-machine
modifier. It is role-scoped through the root workflow flags: append `+fast` to a
Codex exact selector to emit `service_tier: "fast"` in record schema 2. Without
the suffix, the role means Standard and emits no tier field. Docks and Session
Relay consumers must map that absence to an explicit default-tier process
override rather than inherit a user's global Fast preference.

## Standalone get/set (no full sync)

```
docks-kit model claude            # show deployed + SoT + catalog (+ TTY picker)
docks-kit model claude opus       # set deployed model
docks-kit model claude default    # delete the key (account default applies)
docks-kit model codex gpt-5.5     # codex flavor
```

The set path calls the same engine functions as the sync flags —
one implementation, two entry points.

## Workflow-role overrides (root, no full sync)

The root workflow flags are deployed modifiers for Docks rather than one tool:

```text
docks-kit --model-orchestrator=profile:claude-best \
  --model-reviewer="codex:gpt-5.6-sol@high+fast" \
  --model-implementer=codex:gpt-5.6-sol@high \
  --review-min-score=80 --review-max-rounds=5
```

They atomically write one byte-identical complete record to
`~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`. Omitted fields retain the
current valid record; a missing side is repaired. Invalid or conflicting state
stops before mutation, a repeated request is a no-op, and failure on the second
atomic write restores both snapshots. A later flag-less sync restores the
embedded defaults. Start fresh sessions after changing the record.

Selectors are strict `profile:<name>` or `<tool>:<model>@<effort>[+fast]`
entries from `docks-kit models workflow`. `+fast` is Codex-only and quotes are
optional; its absence means Standard. `profile:claude-best` is the ordered Docks
Fable-high then Opus-xhigh chain; `claude:best@high` is instead Claude's native
single-model alias. Docks checks each candidate when used—there is no docks-kit
provider preflight. Install schema-2 support in Docks and Session Relay before
using a Fast selector.

## Sticky opt-ins are NOT modifiers

`--claude-plugin=<name>` installs+enables an optional plugin and it STAYS
(the SoT has no key to revert against). Only `--prune` removes it.
