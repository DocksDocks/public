# omp models

Why `SoT/.omp/config.yml` points each omp role at a specific model and thinking
level, and the Artificial Analysis (AA) measurements the choices were weighed
against.

## Role map

| Role | Model | Level | Index | Cost/task | TTFT |
|---|---|---|---:|---:|---:|
| `default` | `anthropic/claude-opus-5-5` | high | 54 | $1.82 | 52.85 s |
| `slow` | `anthropic/claude-opus-5-5` | xhigh | 56 | $3.46 | 136.30 s |
| `plan` | `anthropic/claude-opus-5-5` | xhigh | 56 | $3.46 | 136.30 s |
| `task` | `anthropic/claude-opus-5-5` | high | 54 | $1.82 | 52.85 s |
| `advisor` | `anthropic/claude-opus-5-5` | medium | 51 | $1.34 | 21.87 s |
| `designer` | `anthropic/claude-opus-5-5` | high | 54 | $1.82 | 52.85 s |
| `vision` | `anthropic/claude-opus-5-5` | medium | 51 | $1.34 | 21.87 s |
| `smol` / `commit` | `openai-codex/gpt-6-luna` | medium | 29 | $0.02 | n/a |
| `tiny` | `openai-codex/gpt-6-luna` | low | 21 | $0.0045 | 2.18 s |
| `fable` | `anthropic/claude-fable-5-1` | medium | 49 | $2.98 | 8.00 s |
| `switch_fable` | `anthropic/claude-fable-5-1` | medium | 49 | $2.98 | 8.00 s |
| `astra` | `openai-codex/gpt-6-astra` | xhigh | 52 | $2.31 | 126.90 s |
| `web` | `web/firecrawl` | n/a | n/a | n/a | n/a |

The table reports the measured Artificial Analysis figures for each assigned
model and level. It states no motive that the config or omp's own
documentation does not establish. AA has not measured output speed or latency
for GPT-6 Luna medium, so that row carries `n/a` for TTFT. AA measures no web
search provider, so the `web` row carries no figures.

The role map carries no Coding Agent Index column. That index measures specific
agent harnesses and model levels, not omp roles. The snapshot section below
lists the relevant entries, including Codex with GPT-6.1 Sol high.

### GPT-6 Sol and GPT-6 Luna availability

The `openai-codex` selectors for GPT-6 Sol and GPT-6 Luna were deployed on
2026-09-22, while the rollout of both models was still in progress. The owner
chose to deploy them before the rollout completed. Checks on that date, with
omp 18.2.9 and codex-cli 0.153.3:

- At 19:02 UTC, `codex exec -m gpt-6-sol` returned HTTP 400, `The 'gpt-6-sol'
  model is not supported when using Codex with a ChatGPT account.`
  `gpt-6-luna` returned the same error. The Codex model cache fetched at that
  time listed neither model.
- At 19:14 UTC, the Codex model cache for the same account listed
  `gpt-6-sol` and `gpt-6-luna`. A request on the new default could not be
  tested, because the account had reached its Codex usage limit.
- The omp `openai-codex` catalog listed `gpt-6-astra` and the three `gpt-5.6`
  models, but not `gpt-6-sol` or `gpt-6-luna`, both before and after
  `omp models refresh` at 19:14 UTC. omp resolves a selector that is not in
  the catalog by provider-scoped fuzzy match. An `omp -p --mode json` run on
  `openai-codex/gpt-6-sol:low` recorded `gpt-5.6-sol` as the serving model,
  and the Luna selector recorded `gpt-5.6-luna`. omp printed no warning.

On 2026-09-25, omp 18.3.1 listed `gpt-6-sol` and `gpt-6-luna` in
`omp models openai-codex`. An `omp -p --mode json` run on each selector
recorded `gpt-6-sol` and `gpt-6-luna` as the serving model, so the selected
omp roles ran GPT-6 on that date.

On 2026-09-29, omp 18.4.4 listed `gpt-6.1-sol` at low, medium, high, xhigh,
and max, with a 272K context window and 128K maximum output. An
`omp -p --mode json --model openai-codex/gpt-6.1-sol:low` run recorded
`gpt-6.1-sol` as the serving model. To recheck, run
`omp models openai-codex`; the `gpt-6.1-sol` row must appear. Codex-cli
0.159.0 could not complete `codex exec -m gpt-6.1-sol`: the login had ended,
and the request returned HTTP 401 `refresh_token_invalidated`. The Codex
model cache was last fetched on 2026-09-22 and does not list `gpt-6.1-sol`,
so that Codex run did not establish model availability.

What omp's settings catalog establishes about these roles:

- `cycleOrder` lists the roles the model switcher cycles. `fable` is the
  fourth `Ctrl+P` stop, and `astra` is the fifth and last stop.
- `tiny` overrides the model for lightweight background tasks: titles, memory,
  auto-thinking, and unexpected-stop detection.
- `modelTags` carries role metadata and can introduce roles; `hidden: true`
  keeps `switch_fable` out of the switcher list.

`task.agentModelOverrides` maps `reviewer`, `security-reviewer`,
`code-reviewer`, and `plan-reviewer` to `@task`. Only the bundled `reviewer`
and `security-reviewer` exist as OMP agents (omp's task tool lists `scout`,
`reviewer`, `security-reviewer`, `task`, and `sonic`), so those two inherit
whatever `task` resolves to. The `code-reviewer` and `plan-reviewer` entries
are dormant until an OMP agent with that name exists.
`retry.fallbackChains.task` holds `openai-codex/gpt-6.1-sol:high` as a
cross-vendor fallback.

`retry.fallbackChains.astra` holds `anthropic/claude-fable-5-1:medium`.
`retry.fallbackChains.fable` holds `openai-codex/gpt-6-astra:xhigh`.
Each deliberate cycle stop falls to the other vendor. Without these explicit
chains, `retry.fallbackChains.default` would send either stop to
`openai-codex/gpt-6.1-sol:high`.
Chain entries are concrete selectors, not role aliases, so this pair cannot
recurse. The hidden `switch_fable` chain stays empty.

### Why `advisor` runs Opus 5.5 medium

`advisor` runs `anthropic/claude-opus-5-5:medium` with an empty fallback
chain. On 2026-09-24, with omp 18.3.0, an Opus 5.5 session with the advisor
on `openai-codex/gpt-6-sol:medium` looped. In one session the advisor made
1,313 requests for 140 main-agent requests. It issued 1,272 `read` calls on
248 distinct paths, read one 3-line slice 249 times, and never called
`advise`. The advisor prompt averaged about 317k tokens, above the 272K
window omp lists for GPT-6 Sol. With the advisor on Opus 5.5 medium, the
same kind of session made about one advisor request per main-agent request
and called `advise` normally. The owner excluded GPT-6 Sol from the advisor
role and its fallback chain. On 2026-09-29 the owner extended the exclusion to
every GPT model, including GPT-6.1 Sol and GPT-6 Astra. No GPT model was
tested as the advisor again, and Astra costs too much for this role. Do not
put an `openai-codex/gpt-*` selector in `modelRoles.advisor` or
`retry.fallbackChains.advisor`.

`modelRoles.web` is `web/firecrawl`, and `retry.fallbackChains.web` lists the
explicit 20-entry provider order that follows it. The two keys replace the
retired `providers.webSearchOrder` key, which omp no longer carries in its
settings schema. omp still accepts that key in a deployed file, expands it in
memory into the same two keys, and then drops it, but it never writes the
expansion back to disk. The kit therefore declares both keys itself.

The chain starts from the expansion omp produces, read back with
`omp config get retry.fallbackChains`. An explicit chain replaces omp's
built-in web order wholesale, so a shortened list drops providers instead of
reordering them. The kit makes two deliberate edits to omp's order:

- The Codex Luna entry follows the kit's Luna generation and names
  `openai-codex/gpt-6-luna`.
- The owner removed every entry that named an older model:
  `google/gemini-2.5-flash`, `google-antigravity/gemini-2.5-flash`,
  `anthropic/claude-haiku-4-5`, `openai-codex/gpt-5.6`,
  `openai-codex/gpt-5.5`, `xai/grok-4.5`, and `xai-oauth/grok-4.5`. omp never
  tries those search backends now.

The order keeps Firecrawl, Exa, Perplexity, and Codex first. The remaining
`web/*` entries are omp's own ordering of the providers behind them.

## Artificial Analysis snapshot

Source: `https://artificialanalysis.ai`, read on 2026-09-29 at Intelligence
Index v4.3.2 and Coding Agent Index v1.5. Each per-level row comes from the
metric table of `/models/comparisons/<level-slug>-vs-gpt-5-6-sol-high`.
Each page title names the requested model and level and prints the same
Intelligence Index version. AA serves `max` under the bare model slug.
The GPT-5.6 Sol high self-comparison URL does not load, so that baseline row
comes from the GPT-5.6 Sol high column of the GPT-6.1 Sol high comparison.
Index composition changes between versions; figures from an earlier capture
cannot be mixed with these.

The Coding Agent Index page (`/agents/coding-agents`) lists 30 harness, model,
and level entries. It covers GPT-6.1 Sol with Codex at low, medium, high,
xhigh, and max; Opus 5.5 and Fable 5.1 with Claude Code at max; and Astra and
Luna with Codex at max. It also covers Grok Build with Grok 4.7 at xhigh,
Antigravity SDK with Gemini 3.8 Flash at high, and Opencode with GLM-5.3 and
Kimi Code CLI with Kimi K3 without levels. The relevant published scores are:

| Harness and model | Coding Agent Index |
|---|---:|
| Claude Code - Opus 5.5 (max) | 66 |
| Claude Code - Fable 5.1 (max, with fallback) | 62 |
| Codex - GPT-6 Astra (max) | 62 |
| Codex - GPT-6.1 Sol (xhigh) | 63 |
| Codex - GPT-6.1 Sol (medium) | 61 |
| Codex - GPT-6.1 Sol (high) | 60 |
| Codex - GPT-6.1 Sol (max) | 60 |
| Codex - GPT-6.1 Sol (low) | 57 |
| Claude Code - Opus 5 (max) | 60 |
| Codex - GPT-6 Luna (max) | 41 |

These are coding-agent scores for specific harnesses and levels, not scores
for the omp role map.

Column meanings:

- **Index** - AA Intelligence Index, a weighted aggregate across its
  evaluation set. Comparable only inside one index version.
- **Cost/task** - weighted average USD to run one index task, including
  input, cache, reasoning, and answer tokens.
- **Tokens/task** - answer plus reasoning tokens for one index task.
- **Index tokens** - total output tokens the model spends to complete the
  whole index run. This is the token-efficiency signal.
- **Speed** - output tokens per second.
- **TTFT** - seconds to the first answer token, so reasoning time counts.
- **TB 4.0** - Terminal-Bench 4.0, one of the ten index evaluations.

### Claude Opus 5.5 (Anthropic) - `anthropic/claude-opus-5-5`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 58 | $5.98 | 119k | 260M | 93 | 692.63 | 60% |
| xhigh | 56 | $3.46 | 66k | 100M | 80 | 136.30 | 60% |
| high | 54 | $1.82 | 36k | 53M | 74 | 52.85 | 57% |
| medium | 51 | $1.34 | 26k | 38M | 74 | 21.87 | 53% |
| low | 42 | $0.55 | 10k | 20M | 74 | 12.49 | 31% |

Price: $4.00 in, $20.00 out, $0.20 cache hit per 1M. The Anthropic platform
documentation lists the same input, output, and cache-read prices. It adds a
$5.00 five-minute cache write and an $8.00 one-hour cache write, which the AA
comparison table does not show. Context is 1M, with 128K maximum output.
Adaptive thinking is always on, and the Claude API default effort is
`medium`. All AA levels run with fallback. Max has the highest Intelligence
Index in this topic at this capture. AA now measures speed and latency for
every Opus 5.5 level; medium has a shorter TTFT than high.

Until 0.20.1, `SoT/.omp/models.yml` carried the Anthropic limits and prices as
an `anthropic` `modelOverrides` block, because the shared catalog served this
id as a stub with null limits and zero cost. On 2026-09-25 the catalog at
`catalog.stencil.so` published the same context window, output cap, ladder,
and prices, so the block was removed. Sync prunes the deployed copy only while
it still equals the shipped block.

The removal fixes how the Opus role levels reach the API. The block set
`thinking.mode: effort`. For that mode, omp 18.3.1 (`packages/ai/src/stream.ts`,
tag `v18.3.1`) sends `thinking: {type: "enabled", budget_tokens}` and no
`output_config.effort`. The level only picked the budget from
`ANTHROPIC_THINKING`: `medium` 8,192, `high` 16,384, and `xhigh` and `max`
both 32,768 tokens. So before 0.20.1 the levels in the role table above were
not the effort levels that Artificial Analysis measured, and `xhigh` equaled
`max`. The catalog row sets `thinking.mode: anthropic-adaptive`, so omp now
sends `thinking: {type: "adaptive"}` with `output_config.effort` set to the
role level. The block also set `defaultLevel: high` for a bare
`claude-opus-5-5` selector. `SoT/.omp/config.yml` names a level on every Opus
selector, so no kit role depends on that default. Runs on
`anthropic/claude-opus-5-5:high` and `:max` after the prune answered with
exit 0.

### Claude Fable 5.1 (Anthropic) - `anthropic/claude-fable-5-1`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 53 | $7.63 | 78k | 188M | 69 | 285.98 | 52% |
| xhigh | 53 | $5.98 | 61k | 121M | 57 | 104.51 | 55% |
| high | 51 | $3.91 | 38k | 62M | 52 | 26.01 | 52% |
| medium | 49 | $2.98 | 28k | 44M | 50 | 8.00 | 45% |
| low | 47 | $2.37 | 22k | 33M | 48 | 4.83 | 40% |

Price: $10.00 in, $50.00 out, $0.25 cache hit per 1M. Context 1M. All levels
run with fallback.

### GPT-6 Astra (OpenAI) - `openai-codex/gpt-6-astra`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 53 | $3.26 | 27k | 60M | 57 | 305.56 | 59% |
| xhigh | 52 | $2.31 | 17k | 38M | 49 | 126.90 | 60% |
| high | 51 | $1.73 | 12k | 26M | 50 | 41.09 | 54% |
| medium | 50 | $1.54 | 10k | 19M | 47 | 4.88 | 49% |
| low | 46 | $0.82 | 4k | 10M | 49 | 2.81 | 42% |

Price: $10.00 in, $50.00 out, $1.00 cache hit per 1M. Context 1M. Knowledge
cutoff 2026-04-30. AA publishes no non-reasoning Astra row.

### GPT-6.1 Sol (OpenAI) - `openai-codex/gpt-6.1-sol`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 52 | $0.72 | 38k | 67M | 67 | 267.64 | 56% |
| xhigh | 51 | $0.39 | 18k | 36M | 64 | 68.65 | 54% |
| high | 50 | $0.32 | 13k | 25M | 66 | 57.26 | 52% |
| medium | 48 | $0.21 | 8k | 15M | 62 | 5.29 | 48% |
| low | 42 | $0.13 | 4k | 9M | 74 | 1.84 | 31% |

AA lists $2.00 input, $10.00 output, and $0.10 cached input per 1M tokens.
OpenAI also lists $2.50 per 1M cache-write tokens, a 1,050,000-token context,
922,000 maximum input tokens, and 128,000 maximum output tokens. Prompts above
272K input tokens cost 2x input and cache rates and 1.5x output rates for the
full request. The knowledge cutoff is 2026-04-30. The API effort ladder is
`low, medium, high, xhigh, max`, with `medium` as the default. There is no
`none`, `minimal`, or non-reasoning level.

### GPT-6 Luna (OpenAI) - `openai-codex/gpt-6-luna`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 37 | $0.07 | 50k | 145M | 148 | 96.96 | 13% |
| xhigh | 34 | $0.04 | 27k | 69M | 133 | 16.87 | 8% |
| high | 32 | $0.03 | 20k | 47M | 132 | 10.97 | 5% |
| medium | 29 | $0.02 | 11k | 29M | n/a | n/a | 3% |
| low | 21 | $0.0045 | 2k | 8M | 124 | 2.18 | 0% |
| non-reasoning | 18 | $0.01 | 4k | 7M | 142 | 0.80 | 2% |

Price: $0.10 in, $0.50 out, $0.01 cache hit per 1M. OpenAI's model page lists
a $0.125 cache write, the same context, output, and long-prompt billing as
GPT-6.1 Sol, and a 2026-05-18 knowledge cutoff. Luna also offers a
non-reasoning level. AA has not measured speed or latency for `medium`; it
has measured both at the other levels.

### GPT-5.6 Sol (OpenAI) - previous generation

The role map no longer uses GPT-5.6 Sol. This table stays as the measured
baseline for the current Sol task role.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 47 | $1.99 | 29k | 90M | 85 | 98.68 | 40% |
| xhigh | 44 | $1.18 | 20k | 51M | 77 | 24.79 | 25% |
| high | 42 | $0.81 | 13k | 34M | 75 | 9.40 | 21% |
| medium | 39 | $0.50 | 8k | 21M | 73 | 4.92 | 15% |
| low | 33 | $0.26 | 4k | 13M | 74 | 2.26 | 1% |
| non-reasoning | 28 (estimated) | n/a | n/a | n/a | 67 | 1.03 | n/a |

Price: $4.00 in, $20.00 out, $0.40 cache hit per 1M. Context 1M. AA marks the
non-reasoning index score as estimated.

### GPT-5.6 Luna (OpenAI) - previous generation

The role map no longer uses GPT-5.6 Luna. This table stays as the measured
baseline for the GPT-6 Luna switch.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 37 | $0.18 | 41k | 154M | 119 | 106.29 | 12% |
| xhigh | 35 | $0.09 | 24k | 85M | 115 | 43.42 | 4% |
| high | 32 | $0.04 | 14k | 50M | 110 | 14.13 | 3% |
| medium | 25 | $0.02 | 4k | 18M | 114 | 2.28 | 1% |
| low | 21 | $0.01 | 3k | 10M | 116 | 1.56 | 0% |
| non-reasoning | 16 | $0.01 | 2k | 5M | 113 | 0.68 | 1% |

Price: $0.20 in, $1.20 out, $0.02 cache hit per 1M. Context 1M.

## Why `task` runs Opus 5.5 high

`task` runs `anthropic/claude-opus-5-5:high`, the same model and level as
`default`. The owner moved it from `openai-codex/gpt-6.1-sol:high` on
2026-10-09. GPT-6.1 Sol high is now the `task` retry fallback. The owner uses
Astra only for main orchestration, so Astra has a dedicated `astra` cycle stop
at `xhigh`. This comparison keeps the retired Astra-low, GPT-5.6 Sol, and
GPT-6.1 Sol choices beside the current Opus level.

| Metric | Astra low, retired | GPT-5.6 Sol high, retired | GPT-6.1 Sol high, fallback | GPT-6.1 Sol max | Opus 5.5 high, current |
|---|---:|---:|---:|---:|---:|
| Intelligence Index | 46 | 42 | 50 | 52 | 54 |
| Cost per Index task | $0.82 | $0.81 | $0.32 | $0.72 | $1.82 |
| Output tokens per task | 4k | 13k | 13k | 38k | 36k |
| Index output tokens | 10M | 34M | 25M | 67M | 53M |
| Answer TTFT | 2.81 s | 9.40 s | 57.26 s | 267.64 s | 52.85 s |
| End-to-end response time | 13.08 s | 16.04 s | 64.81 s | 275.12 s | 59.60 s |
| Time per index task | 91.73 s | 176.91 s | 202.65 s | 568.66 s | 294.20 s |
| Terminal-Bench 4.0 | 42% | 21% | 52% | 56% | 57% |
| AA-Briefcase v1.1 | 1261 | 1370 | 1471 | 1564 | 1705 |
| AA-Omniscience | 41 | 20 | 41 | 42 | 41 |

GPT-6.1 Sol high scores 50 against GPT-5.6 Sol high at 42. It costs $0.32
against $0.81 per index task, and both use 13k output tokens per task. It
scores 52% against 21% on Terminal-Bench 4.0 and 1471 against 1370 on
AA-Briefcase. The new high level has a longer answer TTFT, 57.26 s against
9.40 s, and longer end-to-end response time, 64.81 s against 16.04 s.

Astra low scores 46 against GPT-6.1 Sol high at 50 and costs $0.82 against
$0.32 per index task. Astra low has the shorter TTFT, 2.81 s against
57.26 s. The owner reserves Astra for interactive orchestration.

GPT-6.1 Sol max scores two index points above high, at 52 against 50. It
costs $0.72 against $0.32 per index task, with TTFT of 267.64 s against
57.26 s.

Opus 5.5 high scores 54 against GPT-6.1 Sol high at 50, 57% against 52% on
Terminal-Bench 4.0, and 1705 against 1471 on AA-Briefcase. It costs $1.82
against $0.32 per index task. Its answer TTFT is 52.85 s against 57.26 s.

The `astra` cycle stop runs xhigh: index 52, $2.31 per index task, and
126.90 s TTFT. AA publishes a Coding Agent Index entry for Astra only at
max with Codex, where it scores 62.

## How Astra is selected in practice

No subagent role or `task.agentModelOverrides` entry resolves Astra.
`modelRoles.astra` is reachable only through the model switcher as a main
orchestrator role. The explicit Fable retry chain can also select Astra.
No subagent selects Astra automatically.

`SoT/.omp/models.yml` declares the full `low, medium, high, xhigh, max` ladder
with `defaultLevel: xhigh` under
`providers.openai-codex.modelOverrides.gpt-6-astra.thinking`.
The override stays as the kit's worked example of a provider ladder
redefinition. The in-session thinking control can still select `low` for a
quick answer.

- The bundled `scout` and `sonic` agents carry `model: "@smol"` and
  `thinking-level: medium` in their embedded frontmatter, so they run Luna,
  not Opus 5.5 or Astra. To move them, change `modelRoles.smol` or add a
  `task.agentModelOverrides` entry for the agent name.
- The bundled `task` agent carries `model: "@task"` and
  `thinking-level: auto`. It resolves Opus 5.5 high. The `:high` suffix on
  `modelRoles.task` is an explicit level, so it outranks the agent's `auto`,
  and the auto classifier does not run for a `task` spawn.
- `task.enableEffort` is `true`, so a caller can pass `effort: lo`, `med`, or
  `hi`. Caller effort outranks the role suffix. omp maps it onto the model's
  own ladder, not onto level names: `lo` selects the lowest level, `med` the
  lower middle, and `hi` the highest (`resolveTaskEffortLevel` in omp's
  `packages/tui/src/thinking.ts`, omp 18.8.5). Then omp caps the result at
  `task.maxEffort`.
- `task.maxEffort` is `xhigh`. On the `low, medium, high, xhigh, max` ladder
  that Opus 5.5, GPT-6.1 Sol, and GPT-6 Luna publish, `lo` gives `low`, `med`
  gives `high`, and `hi` gives `xhigh`. With the former `max` ceiling, `hi`
  gave `max`: on 2026-10-09, `task` spawns with `effort: hi` ran GPT-6.1 Sol
  at `max` despite the `:high` role suffix. `scout` and `sonic` run GPT-6 Luna
  `medium` by default and GPT-6 Luna `xhigh` with `effort: hi`.
- The bundled `reviewer` and `security-reviewer` inherit `@task`, now
  Opus 5.5 high.
- The `code-reviewer` and `plan-reviewer` override entries remain dormant.
  Both point to `@task`, now Opus 5.5 high. omp's task tool rejects both
  names as unknown agents, so neither can spawn.

The runtime per-agent measurement from fresh `omp -p` runs on 2026-09-09
predates this change. It applies to the retired Astra-low `task` configuration,
not the current role map.

omp's 272k context window is the `/extended-context off` window for Astra.
`/extended-context on` uses the 922k input window, 1.05M total, which matches
AA's 1M.

## Free session launcher (`docks-kit omp`)

`docks-kit omp [--model <selector>|--pick] [args...]` starts one interactive
omp session with a configuration overlay that selects a free model. The
overlay sets all 13 model roles to that model and empties all 10 retry fallback
chains. Higher-precedence model selection can replace those values.
The overlay also sets `defaultThinkingLevel` and `task.maxEffort`, except for
a model that publishes no thinking ladder, where both keys are omitted and the
deployed values apply.

The launcher renders a run overlay to
`~/.cache/docks-kit/omp-free-<model>-<digest>.yml` at mode 0600 and passes it
through omp's repeatable `--config` flag. Each model gets its own file,
because omp can re-read the overlay during a live session, and a second
launcher on another model must not rewrite that file. The name sanitizes the
selector for the file system and appends a digest of the exact selector, so
two selectors that differ only in separator characters stay apart. A session
launch never reads or writes `~/.omp/agent/config.yml` or `models.yml`; only
`--fast`, below, edits `config.yml`. It
never touches the SoT. The next plain `omp` run uses the paid configuration
again.

Every argument after the launcher flags forwards verbatim to omp. `docks-kit
omp -p "..."` runs one prompt. `docks-kit omp --continue` resumes the
previous session. A bare `docks-kit omp` opens an interactive session.

The overlay ranks above the deployed global and project configuration, and
below runtime overrides and later overlay files. Each input below therefore
selects a model that the overlay does not control:

- A forwarded later config overlay. The launcher passes its own `--config`
  first, and omp applies a later overlay file over an earlier one.
- The runtime model flags `--model`, `--smol`, `--slow`, and `--plan`. The
  legacy `--provider` flag selects a provider. `--models` sets the model
  patterns that `Ctrl+P` cycling can reach, so cycling can leave the free
  model.
- The model environment variables `PI_SMOL_MODEL`, `PI_SLOW_MODEL`, and
  `PI_PLAN_MODEL`. `PI_CONFIG_FILES` is not in this set, because those files
  load before `--config` overlays.
- The in-session model selector. `Alt+M` sets the roles, and `Alt+P` picks a
  model for the current session only.
- A restored persisted session model. `--continue`, `--resume`, and
  `autoResume` restore the model of the session they open, so a session that
  started under the paid configuration returns to its paid model.

This list names the known selection paths. It is not a closed set. The
launcher does not reject these inputs today.

The default model is `opencode-zen/muse-spark-1.3-contributor-free` ("Muse
Spark 1.3 Free", 1,048,576-token context) at `xhigh`. `xhigh` is the ceiling
of that model ladder: `minimal, low, medium, high, xhigh`. The paid
`muse-spark-1.3` sibling also offers `max`. The free variant does not.

Both levels come from the ladder of the chosen model, never from a fixed
list. The session level is the ceiling of that ladder. The advisor level is
the highest level at or below `medium`, because the advisor performs quick
review passes. When every level of a ladder is above `medium`, the advisor
takes the lowest level, so it never becomes the most expensive role.

Free ladders are not uniform. On 2026-09-11 the 26 free models published six
distinct ladders: 21 include `medium`, 3 stop at `low, high, max` or
`high, max`, and 2 publish no ladder at all. A model without a ladder gets
bare selectors with no `:level` suffix, because an invented level makes omp
fail when the session starts.

The choice persists per machine in `~/.docks-kit/kit.db` (table
`omp_session`), next to the harness selection. It survives across sessions. It is never
committed. `--model <selector>` records one selector and derives both levels
from the catalog row. `--pick` opens an interactive wizard.

The picker lists only models the live `omp models --json` catalog reports at
zero input and output cost (26 entries on 2026-09-11). The resulting overlay
sets every role to the chosen free model and empties every retry chain.
Higher-precedence model selection can replace those values. The catalog can
advertise a free model that the account cannot call; omp reports that provider
error unchanged.

After the model, the wizard asks about thinking levels. `ompOverlay.ts
planEffortChoice` decides which questions apply, because omp accepts a
`:level` suffix only for a level the chosen model publishes:

- No ladder: the wizard asks nothing and the overlay omits every level.
- One level: the wizard states that level and asks nothing.
- Two or more levels: the wizard asks whether every role uses the same
  level. Yes takes the highest level the model offers. No asks one level for
  all roles except the advisor, then one level for the advisor.

The advisor question leads with a recommendation from `ompOverlay.ts
advisorRecommendation`: two steps down the model own ladder, clamped to the
lowest level that model publishes. The recommendation is the first row
because `Prompt.Select` starts on the first entry and accepts no initial
index, so `Enter` takes it. The full ladder follows in ladder order. A
recommendation equal to the chosen level is omitted rather than duplicated.

A session whose advisor differs from the other roles reports both on the
launch line.

An omp login is required. The kit owns no login flow. It surfaces omp's own
authentication error unchanged.

When the catalog renames the free variant, change only the default selector
constant. A ladder change needs no code change. Under `--model` both levels
are derived from the catalog row of the chosen model, and under `--pick` the
user chooses them from the ladder that same row publishes. Refresh the
recorded default and the ladder counts in these docs in the same commit.

## OpenAI fast mode (`docks-kit omp --fast`)

`docks-kit omp --fast` toggles `tier.openai` in the deployed
`~/.omp/agent/config.yml` between `priority` and `none`, prints the old and new
values, and exits without starting a session. `priority` is the tier omp's
`/fast on` selects for OpenAI and OpenAI-Codex models. `--fast` over
`ultrafast` selects `priority`. The kit ships no Ultrafast toggle: omp honors
`ultrafast` for a Codex model only when its catalog `serviceTiers` lists it,
and the omp 18.4.9 catalog lists none for GPT-6.1 Sol, Astra, or Luna. The SoT
does not declare `tier.openai`, so the additive sync merge keeps the toggled
value. New sessions read it; a running session changes through `/fast`.

## Maintenance

- Refresh each per-level row from the metric table of
  `/models/comparisons/<level-slug>-vs-gpt-5-6-sol-high`. Check that the page
  title names the requested model and level. Take `max` from the bare model
  slug. Do not read values from the chart payloads of the model pages: each
  chart holds only about 20 models, so a missing value there does not mean
  that AA has not measured it.
- Refresh the Coding Agent Index from `/agents/coding-agents`.
- Record the index version with the numbers. AA changes index composition
  between versions, so a score from another version is not a comparison.
- Update the capture date in the same commit as any number.
- Verify Astra ladder changes in `SoT/.omp/models.yml` through the model
  switcher and in-session thinking control.
- Verify `task.maxEffort` changes with a fresh `omp -p` spawn per bundled agent.
