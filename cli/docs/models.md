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

- `best` resolves to Fable 5.1 where the org has access, latest Opus
  otherwise. It needs Claude Code >= 2.1.257. Claude apps gateway sessions
  still resolve `best` and `fable` to Fable 5. The kit SoT pins the `opus`
  alias directly rather than `best` or a full id, so the deployed model is
  unambiguous. Its `minimumVersion` of 2.1.280 ensures Claude Code can resolve
  that alias to Opus 5.5, the default Opus from that release. The former
  2.1.219 floor capped the alias at Opus 5. The kit keeps the alias because it
  tracks the next Opus release without a kit change and stays portable across
  every provider that carries a different newest Opus. The floor also subsumes
  the older `best`/Fable 5.1 requirement of 2.1.257.
- `default` is an engine pseudo-value: it DELETES the deployed `model` key so
  the account default applies. It never reaches the settings file as a value.

## Commands

```
docks-kit models                  # both catalogs
docks-kit models claude --json    # machine-readable
docks-kit model claude            # current deployed + SoT + picker (TTY)
docks-kit model claude opus       # per-machine override from the Opus SoT
docks-kit sync claude --claude-model=opus   # same, as part of a sync
```

## Advisor pairing note (Claude)

The SoT ships `model: opus` with advisor off (`advisorModel` unset).
Advisor is a per-machine opt-in: `docks-kit sync claude --claude-advisor=on`
writes `advisorModel: opus`; `off` and `default` delete the key. The advisor
then runs the same Opus 5.5 the main session uses.
