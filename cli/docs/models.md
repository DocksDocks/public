# Models

`SoT/models.json` supplies aliases and notes for Claude and Codex. For each
enabled harness, `docks-kit models` and the picker list live model IDs when
available. Claude uses the Claude Code login to query the Anthropic models API
and caches the result for six hours in `~/.docks-kit/kit.db`; Codex reads
`~/.codex/models_cache.json`; omp runs `omp models --json`. The kit never needs
omp to list Claude models.

Live lists retain the curated aliases and notes, but omit curated IDs absent
from the live source. A disabled harness, missing login/cache, or unavailable
source falls back to the curated IDs. omp has no curated fallback models.
The `verified` field is the curated section date, not the live fetch date.
Bare model flags without a value print the curated list without a network call.

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
docks-kit models                  # enabled Claude, Codex, and omp catalogs
docks-kit models claude --json    # source, fetch date, and fallback reason
docks-kit models claude --refresh # bypass the six-hour Anthropic cache
docks-kit model claude            # current deployed + live list + picker (TTY)
docks-kit model claude opus       # per-machine override from the Opus SoT
docks-kit sync claude --claude-model=opus   # same, as part of a sync
```

## Advisor pairing note (Claude)

The SoT ships `model: opus` with advisor off (`advisorModel` unset).
Advisor is a per-machine opt-in: `docks-kit sync claude --claude-advisor=on`
writes `advisorModel: opus`; `off` and `default` delete the key. The advisor
then runs the same Opus 5.5 the main session uses.
