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

- `best` (the kit SoT default) resolves to Fable 5 where the org has access,
  latest Opus otherwise. Needs Claude Code >= 2.1.170.
- `default` is an engine pseudo-value: it DELETES the deployed `model` key so
  the account default applies. It never reaches the settings file as a value.

## Commands

```
docks-kit models                  # both catalogs
docks-kit models claude --json    # machine-readable
docks-kit model claude            # current deployed + SoT + picker (TTY)
docks-kit model claude fable      # set deployed model
docks-kit sync claude --claude-model=opus   # same, as part of a sync
```

## Advisor pairing note (Claude)

The advisor model must be at least as capable as the main model; Fable
outranks Opus, so an Opus main + Fable advisor works while Fable main +
Opus advisor is rejected. Advisor config (`advisorModel`) is intentionally
NOT in the SoT — set it per machine or per project in settings.local.json.
