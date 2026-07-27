# Models

`SoT/models.json` is the kit-verified model catalog — the single source for
the engine validators, `docks-kit models`, the interactive picker, and the
bare-flag helper output. Each tool section carries a `verified` date; update
the entry and date when a model ships or retires.

## Validation rules

- **Claude**: catalog aliases (`best`, `opus`, `fable`, `sonnet`, `haiku`,
  `default`) and full IDs validate silently; any other `claude-*` ID is
  accepted with a warning (new models outrun the catalog); everything else
  exits 2 with the catalog printed.
- **Codex**: hard charset gate `^[A-Za-z0-9._-]+$` (also blocks TOML-quote
  injection — the value lands inside a quoted config.toml string); catalog
  misses warn but apply.

## The `best` alias and `default` pseudo-value

- `best` resolves to Fable 5 where the org has access, latest Opus otherwise.
  It needs Claude Code >= 2.1.170. The kit SoT pins the `opus` alias directly
  rather than `best` or a full id, so the deployed model is unambiguous. Its
  `minimumVersion` of 2.1.219 ensures Claude Code can resolve that alias to the
  newest Opus its provider offers: Opus 5 on the Anthropic API or Opus 4.6 on
  Microsoft Foundry. The former 2.1.170 floor silently capped Anthropic API
  users at Opus 4.8. Keeping the alias provides provider portability and tracks
  future Opus releases; the literal `claude-opus-5` is unavailable on Foundry.
  The floor also subsumes `best`/Fable 5's older 2.1.170 requirement.
- `default` is an engine pseudo-value: it DELETES the deployed `model` key so
  the account default applies. It never reaches the settings file as a value.

## Commands

```
docks-kit models                  # both catalogs
docks-kit models claude --json    # machine-readable
docks-kit model claude            # current deployed + SoT + picker (TTY)
docks-kit model claude opus       # per-machine override from the Fable SoT
docks-kit sync claude --claude-model=opus   # same, as part of a sync
```

## Advisor pairing note (Claude)

The SoT ships `model: fable` with advisor off (`advisorModel` unset).
Advisor is a per-machine opt-in: `docks-kit sync claude --claude-advisor=on`
writes `advisorModel: fable`; `off` and `default` delete the key. Fable-main +
Fable-advisor is an accepted pairing. The advisor needs Fable org access and
Claude Code >= 2.1.170.
