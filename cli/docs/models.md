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
  Needs Claude Code >= 2.1.170. The kit SoT pins `fable` directly, so lack of
  Fable access is surfaced instead of silently changing the configured model.
- `default` is an engine pseudo-value: it DELETES the deployed `model` key so
  the account default applies. It never reaches the settings file as a value.

## Commands

```
docks-kit models                  # both catalogs
docks-kit models claude --json    # machine-readable
docks-kit model claude            # current deployed + SoT + picker (TTY)
docks-kit model claude opus       # per-machine override from the Fable SoT
docks-kit sync claude --claude-model=opus   # same, as part of a sync
docks-kit models workflow             # Docks workflow profiles and defaults
docks-kit models workflow --json      # closed machine-readable registry
```

## Docks workflow-role registry

The `workflow` section is strict even though ordinary tool-model modifiers are
forward-compatible. It accepts only known `profile:<name>` values or exact
`<tool>:<model>@<effort>[+fast]` targets whose model and effort both appear in
the catalog. `+fast` is accepted only for Codex exact targets. The defaults are:

- orchestrator: `profile:claude-best`, ordered as `claude:fable@high` then
  `claude:opus@xhigh`;
- reviewer and implementer: `codex:gpt-5.6-sol@high`;
- review minimum score 90 and maximum 3 rounds.

`claude:best@high` is Claude's native one-model alias. It is deliberately not
the same as the Docks-managed `profile:claude-best` candidate chain.
Availability is `checked_when_used`: Docks classifies each launch attempt;
docks-kit neither probes providers nor promises provider-wide fallback.

The default and every unsuffixed selector emit the backward-compatible schema-1
record with no service-tier field; absence means Standard. A `+fast` selector
promotes the complete record to schema 2 and adds `service_tier: "fast"` only to
the selected Codex candidate. Replacing the last Fast selector with an
unsuffixed selector demotes the record back to schema 1. Docks and Session Relay
must support schema 2 before `+fast` is deployed, and must explicitly select the
default tier for unsuffixed roles so global Codex configuration cannot leak in.

## Advisor pairing note (Claude)

The SoT ships `model: fable` with advisor off (`advisorModel` unset).
Advisor is a per-machine opt-in: `docks-kit sync claude --claude-advisor=on`
writes `advisorModel: fable`; `off` and `default` delete the key. Fable-main +
Fable-advisor is an accepted pairing. The advisor needs Fable org access and
Claude Code >= 2.1.170.
