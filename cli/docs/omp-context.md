# omp context and compaction

This topic records why `SoT/.omp/config.yml` does not pin a compaction
threshold, and what omp's reserve-based default computes on each model lane.

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
| `openai-codex/gpt-6-astra`, `openai-codex/gpt-6-luna` | 272,000 | 40,800 | 231,200 | 85.0% |
| `openai-codex/gpt-6.1-sol`, `openai-codex/gpt-6.1-terra` | 500,000 | 75,000 | 425,000 | 85.0% |
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

## Why the key ships as -1 rather than being deleted

`ompYaml.ts` `mergeOmpConfig` is additive. Its `mergeMappings, deployed-key
retention loop` returns every deployed key that the SoT omits to the merged
output, and the only drop predicate is `dropFallbackWildcard`, which is scoped
to `retry.fallbackChains`.

Deleting the key from the SoT would therefore leave the stale `231200` in
every already-deployed `~/.omp/agent/config.yml` permanently. A present key
holding the schema default sentinel `-1` overwrites that stale value on the
next sync.

Verify the deployed value after a sync:

```bash
omp config get compaction.thresholdTokens
```

The command must print `-1`.

## The clamp hazard a fixed pin carries

In omp 18.4.4 through 18.8.7, the fixed-token branch clamps the pinned value
to `contextWindow - 1`. On any model whose window is at or below the pinned
value, the reserve collapses to one token, so omp compacts only once the
context is already full. omp 18.8.8 and later fall back to the reserve-based
budget for such a pin, so this collapse does not occur there. The kit floor is
omp 18.4.4, so a supported host can still have the clamp. The reserve-based
default always leaves at least 15% of the window free.

No current role model has a window below 272,000, so the hazard was latent
rather than live. Not pinning removes it entirely, including for any future
model with a smaller window.

## Idle compaction is a kit-set value

`SoT/.omp/config.yml` sets `compaction.idleEnabled: true`. The omp default is
`false` in omp 18.4.4 through 18.10.4. Idle compaction fires below the
reserve-based trigger on both lanes. A compaction whose reason is `idle`
skips the progress guard. Keep the key. The merge is additive, so a dropped
key turns idle compaction off on fresh installs.

## Related settings left at their omp defaults

| Setting | Value | Reason |
|---|---|---|
| `extendedContext` | `false` | omp 17.4.0 added the setting with the default on, and a later release changed the default to off. The setting controls the window omp reports for a model with a long-context limit. On omp 18.10.4, `omp models openai-codex` lists `openai-codex/gpt-6.1-sol` at 500,000 tokens with the setting off and 922,000 tokens with it on. The Codex lane uses this model for the `default`, `task`, and `vision` fallbacks. The `reviewer` role uses `openai-codex/gpt-6.1-terra`, which omp 18.16.0 also lists at 500,000 tokens with the setting off and which has the same 272,000-token long-prompt rule. OpenAI bills the whole request at the long-prompt rate when the input is above 272,000 tokens. For GPT-6.1 Sol, that rate is input $4.00 instead of $2.00, cache read $0.20 instead of $0.10, cache write $5.00 instead of $2.50, and output $15.00 instead of $10.00. The cost is a cliff rather than a marginal rate. Keeping the setting off keeps the smaller window, so fewer requests cross that cliff. |
| `compaction.idleThresholdTokens` | `200000` | omp default. |
| `compaction.idleTimeoutSeconds` | `300` | omp default. |
| `compaction.methodOrder` | `["remote","snapcompact","handoff","shake","soft"]` | omp default, remote first. Since omp 18.1.18 the Anthropic server-side lane handles Anthropic models, so snapcompact is a fallback rather than the primary path. |

Every row records a decision to leave the omp default in place. None of these
keys carries a kit value that differs from the default omp already applies.
