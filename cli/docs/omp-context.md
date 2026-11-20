# omp context and compaction

This topic records why `SoT/.omp/config.yml` ships no compaction threshold,
and what omp's reserve-based default computes on each model lane. It also
records the omp 19.0.0 tools that the kit turns on and the kit overrides that
0.24.0 returned to the omp defaults.

## How omp resolves the trigger

`resolveThresholdTokens` in omp source
`packages/agent/src/compaction/compaction.ts` selects the trigger from three
branches, in priority order.

1. A positive `compaction.thresholdTokens` wins. A value below the window is
   exact. For a value at or above the window, the behavior depends on the omp
   release. omp 18.4.4 through 18.8.7 clamps the value to `contextWindow - 1`.
   omp 18.8.8 and later fall back to the reserve-based budget of branch 3.
2. Otherwise a positive `compaction.thresholdPercent` applies. omp clamps the
   percent to the range 1 through 99 and computes
   `floor(contextWindow * percent / 100)`.
3. Otherwise, when both keys hold `-1`, reserve-based behavior applies.

The reserve-based branch computes the trigger from the window itself:

```text
threshold = contextWindow - max(floor(contextWindow * 0.15), 16384)
```

omp names the 16384 constant `DEFAULT_RESERVE_TOKENS`. The 15% proportional
reserve dominates on any window above roughly 109,227 tokens, so every lane
the kit uses resolves through the proportional term and never through the flat
constant.

## Per-lane result

| Lane | Window | Reserve | Threshold | Percent of window |
|---|---:|---:|---:|---:|
| `openai-codex/gpt-6.2-astra`, `openai-codex/gpt-6-luna` | 272,000 | 40,800 | 231,200 | 85.0% |
| `openai-codex/gpt-6.2-sol`, `openai-codex/gpt-6.1-terra` | 500,000 | 75,000 | 425,000 | 85.0% |
| `anthropic/*` | 1,000,000 | 150,000 | 850,000 | 85.0% |

Every lane compacts at the same fraction of its own window. The absolute
trigger differs only because the windows differ.

## Why the kit no longer pins 231200

The kit previously shipped `compaction.thresholdTokens: 231200`. That value is
exactly the reserve-based default for a 272,000-token window. It was therefore
identical to the default on the Codex lane and changed nothing there. Its only
real effect was forcing the Anthropic lane to compact at 23.1% of its window
instead of 85%.

The evidence below records 83 compactions measured between 2026-09-12 and
2026-09-21, after omp 18.1.18 introduced the Anthropic server-side compaction
lane.

| Lane | Compactions | Maximum tokens before | Over window | Warnings |
|---|---:|---:|---:|---:|
| `anthropic` | 75 | 248,583 (24.9% of window) | 0 | 0 |
| `openai-codex` | 8 | 263,591 (96.9% of window) | 0 | 0 |

The median context freed was 64.8%. The pin was safe rather than dangerous.
No session ran past its window, and omp raised no warning on either lane.
Under the reserve-based default none of the 75 Anthropic compactions would
have fired, because no session reached 850,000.

## How sync removes the deployed pin

The kit no longer ships `compaction.thresholdTokens`. omp's schema default
`-1` applies, and that sentinel selects the reserve-based branch.

`ompYaml.ts` `mergeOmpConfig` is additive. Its `mergeMappings, deployed-key
retention loop` returns every deployed key that the SoT omits to the merged
output, and the only drop predicate is `dropFallbackWildcard`, which is scoped
to `retry.fallbackChains`. A key deleted from the SoT therefore stays in every
already-deployed `~/.omp/agent/config.yml`.

`ompRemovals.ts OMP_RETIRED_VALUES` therefore records both values that the kit
shipped: the former `231200` pin and the later `-1`. Sync prunes the deployed
key only while it holds one of these values, so a user value survives.

Verify the deployed value after a sync:

```bash
omp config get compaction.thresholdTokens
```

The command must print `-1`, the omp default, unless the user set another
value.

## The clamp hazard a fixed pin carries

In omp 18.4.4 through 18.8.7, the fixed-token branch clamps the pinned value
to `contextWindow - 1`. On any model whose window is at or below the pinned
value, the reserve collapses to one token, so omp compacts only once the
context is already full. omp 18.8.8 and later fall back to the reserve-based
budget for such a pin, so this collapse does not occur there. The kit floor is
omp 18.22.2, later than 18.8.8, so a supported host no longer has the clamp.
The reserve-based default always leaves at least 15% of the window free.

No current role model has a window below 272,000, so the hazard was latent
rather than live. Not pinning removes it entirely, including for any future
model with a smaller window.

## Idle compaction is off

Up to 0.23.0, `SoT/.omp/config.yml` set `compaction.idleEnabled: true`. In
0.24.0 the owner returned the key to the omp default `false` (omp 18.4.4
through 19.0.0). Sync prunes a deployed `true` that the kit shipped, so idle
compaction is off. With the default threshold settings, only the
reserve-based trigger starts a compaction.

## Related settings left at their omp defaults

| Setting | Value | Reason |
|---|---|---|
| `extendedContext` | `false` | omp 17.4.0 added the setting with the default on, and a later release changed the default to off. The setting controls the window omp reports for a model with a long-context limit. On omp 18.10.4, `omp models openai-codex` listed `openai-codex/gpt-6.1-sol` at 500,000 tokens with the setting off and 922,000 tokens with it on. The fallback chains now use `openai-codex/gpt-6.2-sol` for the `default`, `task`, and `vision` fallbacks. omp 18.22.2 lists that model at 500,000 tokens with the setting off. The kit has not checked the window that omp 18.22.2 reports for it with the setting on. The `reviewer` role uses `openai-codex/gpt-6.1-terra`, which omp 18.16.0 also lists at 500,000 tokens with the setting off and which has the same 272,000-token long-prompt rule. OpenAI bills the whole request at the long-prompt rate when the input is above 272,000 tokens. For GPT-6.2 Sol, OpenAI applies 2x the input and cache rates and 1.5x the output rate to the full request. From the base prices, that gives input $4.00 instead of $2.00, cache read $0.20 instead of $0.10, cache write $5.00 instead of $2.50, and output $15.00 instead of $10.00. The cost is a cliff rather than a marginal rate. Keeping the setting off keeps the smaller window, so fewer requests cross that cliff. |
| `compaction.idleThresholdTokens` | `200000` | omp default. |
| `compaction.idleTimeoutSeconds` | `300` | omp default. |
| `compaction.methodOrder` | `["remote","snapcompact","handoff","shake","soft"]` | omp default, remote first. Since omp 18.1.18 the Anthropic server-side lane handles Anthropic models, so snapcompact is a fallback rather than the primary path. |

Every row records a decision to leave the omp default in place. None of these
keys carries a kit value that differs from the default omp already applies.

## omp 19.0.0 tools and returned overrides

The owner made these decisions on 2026-11-19 (DocksDocks/public#184). They apply from 0.24.0.

### Tools that the kit turns on

- `astGrep.enabled: true` gives the `ast_grep` tool. It searches code by its
  syntax tree (AST), on the local disk only.
- `checkpoint.enabled: true` gives the `checkpoint` and `rewind` tools.
  `checkpoint` marks the start of an investigation. `rewind` replaces the
  transcript after that mark with a short report. It restores no file, git
  state, artifact, or process, and a rule line in `SoT/.omp/AGENTS.md` says
  so. A subagent gets the two tools only when its tool list asks for one of
  them.

The memory backend (`memory.backend: off`), `autolearn.enabled`, and
`prewalk.enabled` stay off. All three are off by default, so the SoT has no
key for them. Every other omp 19.0.0 feature keeps its omp default, for
example context notes, `security_scan`, `task.crossInstance`,
`mcp.evalNamespaces`, and cache warming. The advisor stays removed (0.22.22).

### Overrides returned to the omp defaults

The SoT no longer ships these 18 keys. `ompRemovals.ts OMP_RETIRED_VALUES`
records each key with its old kit value. Sync prunes a deployed key only
while it holds that value, so a value that you changed stays.

| Key | Old kit value | omp 19.0.0 default |
|---|---|---|
| `task.maxConcurrency` | `16` | `32` |
| `task.maxEffort` | `xhigh` | `max` |
| `task.maxRuntimeMs` | `3600000` | `0` |
| `task.agentIdleTtlMs` | `120000` | `420000` |
| `task.enableLsp` | `true` | `false` |
| `task.eager` | `always` | `default` |
| `task.showResolvedModelBadge` | `true` | `false` |
| `find.enabled` | `true` | `auto` |
| `providers.webSearchTimeoutSeconds` | `30` | `60` |
| `browser.idleCloseSec` | `600` | `1800` |
| `steeringMode` | `all` | `one-at-a-time` |
| `doubleEscapeAction` | `tree` | `rewind` |
| `features.unexpectedStopDetection` | `smart` | `mechanical` |
| `compaction.idleEnabled` | `true` | `false` |
| `compaction.handoffSaveToDisk` | `true` | `false` |
| `commands.enableOpencodeProject` | `false` | `true` |
| `statusLine.compactThinkingLevel` | `false` | `true` |
| `github.enabled` | `true` | `false` |

Sync cannot tell the old kit value from the same value that you set again.
It prunes both on every sync. To keep an old kit value, set it in a project
configuration or in a `PI_CONFIG_FILES` file, which sync does not write.

The `github` tool is off by default. Its `pr_push` operation runs git
directly, so the `bash.patterns` guards do not see it. The `issue://` and
`pr://` read schemes do not need the tool. omp reads them through its GitHub
cache and `gh` (`omp://tools/read.md`, `omp://tools/github.md`), so they still
work with `github.enabled: false`. The plan-lifecycle work reads issues with
`gh` in bash, so the change does not affect it.

### Overrides that stay

- `branchSummary.enabled: true`.
- `dev.autoqa: false` with `dev.autoqaConsent: denied`.
- `codexResets.autoRedeem5h: "no"` and `codexResets.autoRedeemWeekly: "no"`.
- `startup.quiet: true`.
- `display.showTokenUsage: true`.
- The model roles, `cycleOrder`, `retry.fallbackChains`, `modelTags`, the
  reviewer overrides in `task.agentModelOverrides` and
  `task.agentServiceTierOverrides`, and the `bash.patterns` guards.
