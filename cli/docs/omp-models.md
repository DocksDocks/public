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
| `designer` | `anthropic/claude-opus-5-5` | high | 54 | $1.82 | 52.85 s |
| `vision` | `anthropic/claude-opus-5-5` | medium | 51 | $1.34 | 21.87 s |
| `smol` / `commit` | `openai-codex/gpt-6-luna` | medium | 29 | $0.02 | n/a |
| `tiny` | `openai-codex/gpt-6-luna` | low | 21 | $0.0045 | 2.18 s |
| `fable` | `anthropic/claude-fable-5-2` | medium | 56 (v5.0.1) | $3.80 (v5.0.1) | 11.23 s (v5.0.1) |
| `switch_fable` | `anthropic/claude-fable-5-2` | medium | 56 (v5.0.1) | $3.80 (v5.0.1) | 11.23 s (v5.0.1) |
| `astra` | `openai-codex/gpt-6.2-astra` | xhigh | 62 (v5.0.1) | $2.52 (v5.0.1) | 52.89 s (v5.0.1) |
| `reviewer` | `openai-codex/gpt-6.1-terra` | high | 42 (v5.0.1) | $0.26 (v5.0.1) | 10.91 s (v5.0.1) |
| `web` | `web/firecrawl` | n/a | n/a | n/a | n/a |

The table reports the measured Artificial Analysis figures for each assigned
model and level. It states no motive that the config or omp's own
documentation does not establish. AA has not measured output speed or latency
for GPT-6 Luna medium, so that row carries `n/a` for TTFT. AA measures no web
search provider, so the `web` row carries no figures. The `astra`, `reviewer`,
`fable`, and `switch_fable` rows come from later captures at Intelligence
Index v5.0.1: GPT-6.1 Terra from 2026-11-05, Fable 5.2 from 2026-11-12, and
GPT-6.2 Astra from 2026-11-18. The 2026-09-29 capture predates these models.
Compare those rows only with other v5.0.1 figures (see GPT-6.2 Astra, GPT-6.1
Terra, and Claude Fable 5.2 below). A review benchmark chose the model of the
`reviewer` role (DocksDocks/public#130), not these figures. The tier of that
role follows the main session (DocksDocks/public#134).

The role map carries no Coding Agent Index column. That index measures specific
agent harnesses and model levels, not omp roles. The snapshot section below
lists the relevant entries, including Codex with GPT-6.2 Sol and GPT-6.2 Astra
at high and xhigh.

### AA rows for each role model

For each model that an omp role or retry chain uses, this topic records AA
rows at `high` and `xhigh` at least. Each set of rows names its Intelligence
Index version and its capture date. A role or chain change adds the missing
rows in the same commit. On 2026-11-18, the role map and the retry chains use
six models, and each has both rows:

| Model | Index version | Capture date |
|---|---|---|
| Claude Opus 5.5 | v4.3.2 | 2026-09-29 |
| GPT-6 Luna | v4.3.2 | 2026-09-29 |
| Claude Fable 5.2 | v5.0.1 | 2026-11-12 |
| GPT-6.1 Terra | v5.0.1 | 2026-11-05, speed re-measured 2026-11-18 |
| GPT-6.2 Sol | v5.0.1 | 2026-11-18 |
| GPT-6.2 Astra | v5.0.1 | 2026-11-18 |

### OpenAI model availability in omp

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

On 2026-11-18, omp 18.22.2 listed `gpt-6.2-sol` with a 500K context window
and `gpt-6.2-astra` with a 272K context window. Both had low, medium, high,
xhigh, and max. An `omp -p --mode json` run on each selector at `:low`
recorded that same id as the serving model. omp 18.22.2 listed no GPT-6.2
Terra and no GPT-6.2 Luna. To recheck, run `omp models openai-codex`; the
`gpt-6.2-sol` and `gpt-6.2-astra` rows must appear. Sync deploys the selectors
without a catalog check. On an omp release without these ids, omp can resolve
them by fuzzy match to another model without a warning, as on 2026-09-22.

On 2026-11-19, omp 19.0.0 became the toolchain floor and verified pin. Its
`omp models --json` catalog listed each of the 12 model selectors of
`modelRoles` and `retry.fallbackChains` (the `web/` entries left out) as an
exact `provider/id` row, so no role depends on a fuzzy match. This check read
the catalog only; it ran no model request. The rows also carry the fields that
the free launcher reads (`ompOverlay.ts parseFreeModels`): a string
`selector`, a `cost` object with numeric `input` and `output`, a numeric
`contextWindow`, and a `thinking` ladder array or `null`.

What omp's settings catalog establishes about these roles:

- `cycleOrder` lists the roles the model switcher cycles. `fable` is the
  fourth `Ctrl+P` stop, and `astra` is the fifth and last stop.
- `tiny` overrides the model for lightweight background tasks: titles, memory,
  auto-thinking, and unexpected-stop detection.
- `modelTags` carries role metadata and can introduce roles; `hidden: true`
  keeps `switch_fable` and `reviewer` out of the switcher list.

`modelRoles.reviewer` is a kit-defined role, not an omp built-in. It runs
`openai-codex/gpt-6.1-terra:high`. omp resolves `@<name>` for any key in
`modelRoles` (`getModelRoleAlias` in omp's `model-resolver.ts`, omp 18.8.5).
`task.agentModelOverrides` maps `reviewer`, `security-reviewer`,
`code-reviewer`, and `plan-reviewer` to `@reviewer`, so one key sets the
model for every reviewer. `task.agentServiceTierOverrides` sets the same four
agents to `inherit`, so they take the live tier of the main session for each
provider. "OpenAI fast mode" below describes how that tier changes. The bundled
`reviewer` and `security-reviewer` agents ship with omp, and the kit plugin
`docks-kit-omp` ships `code-reviewer` and `plan-reviewer`.
`retry.fallbackChains.reviewer` holds `anthropic/claude-opus-5-5:high`, and
`retry.fallbackChains.task` holds `openai-codex/gpt-6.2-sol:high`; both are
cross-vendor fallbacks.

The review benchmark of DocksDocks/public#130 ran on 2026-11-05. It used 24
held-out cases of the `review-benchmark` skill, 2 runs each. The cases came
from DocksDocks/docks, the source repository of that skill at the time.
It compared `gpt-6.1-sol` and `gpt-6.1-terra` at `high`, each on the `default`
and `priority` tiers. The user set the effort `high`; the benchmark chose the
model. `gpt-6.1-terra` on `default` let the fewest known defects escape (34.90
per 50 known). No other setting stayed within the pre-registered bounds. A
Terra review took a median of 69.3 s, against 172.8 s for `gpt-6.1-sol` on
`default`. It used about a third of the tokens. It returned more wrong
findings: 0.49 per run against 0.20. The issue holds the full tables and the
decision rule.

The benchmark rule first pinned the `default` tier. The user then chose to
let the reviewers follow the fast toggle (DocksDocks/public#134). On the
`priority` tier, Terra `high` let 35.15 known defects per 50 escape, against
34.90 on `default`, and a review took a median of 35.7 s. Its 90% intervals
missed two pre-registered bounds: escaped difference up to 3.26 (bound 2) and
recall difference down to -0.07 (bound -0.05). Both intervals include 0, and
the user judged the difference as noise.

`retry.fallbackChains.astra` holds `anthropic/claude-fable-5-2:medium`.
`retry.fallbackChains.fable` holds `openai-codex/gpt-6.2-astra:xhigh`.
Each deliberate cycle stop falls to the other vendor. Without these explicit
chains, `retry.fallbackChains.default` would send either stop to
`openai-codex/gpt-6.2-sol:high`.
Chain entries are concrete selectors, not role aliases, so this pair cannot
recurse. The hidden `switch_fable` chain stays empty.

### Advisor removed

By owner decision (2026-11-12, 0.22.22), the kit sets no omp advisor.
`SoT/.omp/config.yml` has no `advisor` block, no `modelRoles.advisor`, and no
`retry.fallbackChains.advisor`. omp keeps the advisor off by default. The
plan-lifecycle verification loop takes its place: acceptance checks, a fresh
code review of the diff, and a round limit. Since 2026-11-01, 33 main
sessions had an advisor log, and no subagent session had one. A session that
runs `/advisor on` takes its advisor model from the `slow` role, because no
`advisor` role is set.

History: on 2026-09-24, with omp 18.3.0, an advisor on
`openai-codex/gpt-6-sol:medium` looped and made 1,313 requests for 140
main-agent requests. The kit then ran the advisor on Opus 5.5 `medium` and
excluded every GPT model from that role until this removal.

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

At v1.5 on 2026-09-29, the Coding Agent Index page (`/agents/coding-agents`)
listed 30 harness, model, and level entries. It covered GPT-6.1 Sol with Codex
at low, medium, high, xhigh, and max; Opus 5.5 and Fable 5.1 with Claude Code
at max; and Astra and Luna with Codex at max. It also covered Grok Build with
Grok 4.7 at xhigh, Antigravity SDK with Gemini 3.8 Flash at high, and Opencode
with GLM-5.3 and Kimi Code CLI with Kimi K3 without levels. The relevant
published v1.5 scores are:

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
for the omp role map. The v1.5 table stays as history. Coding Agent Index v2.1
below has the 2026-11-18 entries for GPT-6.2 Sol and GPT-6.2 Astra.

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
- **TB 4.0** - Terminal-Bench 4.0, one of the index evaluations (ten at v4.3.2,
  nine at v5.0.1).

### Coding Agent Index v2.1

Source: `https://artificialanalysis.ai/agents/coding-agents`, read on
2026-11-18 at Coding Agent Index v2.1. This version gives equal weight to
FrontierCode-AA 2.0, Terminal-Bench 4.1, and SWE-Atlas-QnA-AA, and lists 39
entries. The page draws the scores only in charts. The values below are the
`indexScore` fields of the page data, on a 0 to 1 scale. The cost and agent
wall time columns are the mean per task from the same data. This capture did
not observe the rendered integer values. Do not compare these values with the
v1.5 integers above.

| Harness and model | indexScore | Cost/task | Agent wall time s |
|---|---:|---:|---:|
| Codex - GPT-6.2 Astra (max) | 0.5347 | $5.117 | 1506.7 |
| Codex - GPT-6.2 Astra (xhigh) | 0.5312 | $3.198 | 992.4 |
| Codex - GPT-6.2 Astra (high) | 0.5228 | $2.372 | 947.4 |
| Codex - GPT-6.2 Sol (max) | 0.4862 | $1.216 | 1051.4 |
| Codex - GPT-6.2 Sol (xhigh) | 0.4979 | $0.898 | 755.8 |
| Codex - GPT-6.2 Sol (high) | 0.4746 | $0.764 | 635.4 |

GPT-6.2 Sol scores higher at `xhigh` than at `max`. v2.1 lists GPT-6.1 Sol
and GPT-6.1 Terra with Codex only at max.

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

### Claude Fable 5.2 (Anthropic) - `anthropic/claude-fable-5-2`

Source: `https://artificialanalysis.ai`, read on 2026-11-12 at Intelligence
Index v5.0.1, from the metric table of
`/models/comparisons/<level-slug>-vs-gpt-5-6-sol-high`. AA serves `max` under
the bare model slug. These figures use another index version than the rest of
this snapshot, so they do not compare with the v4.3.2 rows above. Compare them
with GPT-6.1 Terra below.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 65 | $26.54 | 274k | 275M | 98 | 262.29 | 60% |
| xhigh | 62 | $14.83 | 162k | 144M | 102 | 85.87 | 62% |
| high | 62 | $9.08 | 98k | 85M | 97 | 27.98 | 60% |
| medium | 56 | $3.80 | 43k | 41M | 93 | 11.23 | 55% |
| low | 54 | $3.10 | 36k | 35M | 97 | 8.42 | 55% |

Price: $8.00 in, $40.00 out, $0.20 cache hit per 1M. The omp catalog lists
the same prices, a $10.00 cache write, a 1M context, and 128K maximum output.
All AA levels run with default fallback. On 2026-11-12, omp 18.19.0 listed
`claude-fable-5-2` at low, medium, high, xhigh, and max, and an
`omp -p --mode json --model anthropic/claude-fable-5-2:medium` run recorded
`claude-fable-5-2` as the serving model.

`fable` and `switch_fable` moved from Fable 5.1 to Fable 5.2 at the same
level, `medium`. The Fable 5.1 table below stays as the previous-generation
baseline at v4.3.2.

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

### GPT-6.2 Sol (OpenAI) - `openai-codex/gpt-6.2-sol`

Source: `https://artificialanalysis.ai`, read on 2026-11-18 at Intelligence
Index v5.0.1. The rows come from the rendered metric table of
`/models/comparisons/gpt-6-2-sol-vs-gpt-6-1-terra`, which shows every level of
both models. Tokens per task and index tokens come from the data of the model
page `/models/gpt-6-2-sol`, because the comparison table does not show them.
The other values in that data match the rendered table. These rows compare
only with other v5.0.1 figures, not with the v4.3.2 rows.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 57 | $1.01 | 40k | 61M | 85 | 66.70 | 60% |
| xhigh | 56 | $0.65 | 24k | 33M | 81 | 26.63 | 56% |
| high | 55 | $0.56 | 20k | 23M | 78 | 9.63 | 59% |

AA and OpenAI list $2.00 input, $0.10 cached input, $2.50 cache write, and
$10.00 output per 1M tokens. OpenAI also lists a 1,050,000-token context,
922,000 maximum input tokens, and 128,000 maximum output tokens
(<https://developers.openai.com/api/docs/models/gpt-6.2-sol>). Prompts above
272K input tokens cost 2x input and cache rates and 1.5x output rates for the
full request. The knowledge cutoff is 2026-06-01. OpenAI released the model on
2026-11-17 (<https://developers.openai.com/api/docs/changelog>). Codex uses a
500,000-token default context (<https://developers.openai.com/codex/models>).
On 2026-11-18, omp 18.22.2 listed `gpt-6.2-sol` with the same 500K context
window, 128K maximum output, and the levels low, medium, high, xhigh, and max.

`retry.fallbackChains.default` and `.task` moved from GPT-6.1 Sol `high` to
GPT-6.2 Sol `high`, and `.vision` moved at `medium` (DocksDocks/public#175).
On 2026-11-18, the v5.0.1 data of the model page `/models/gpt-6-1-sol` listed
GPT-6.1 Sol high at index 50 and $0.59 per task. GPT-6.2 Sol high has 55 and
$0.56.

### GPT-6.2 Astra (OpenAI) - `openai-codex/gpt-6.2-astra`

Source: `https://artificialanalysis.ai`, read on 2026-11-18 at Intelligence
Index v5.0.1. The rows come from the rendered metric table of
`/models/comparisons/gpt-6-2-astra-vs-gpt-6-2-sol`. Tokens per task and index
tokens come from the data of the model page `/models/gpt-6-2-astra`. These
rows compare only with other v5.0.1 figures, not with the v4.3.2 rows.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 62 | $4.00 | 41k | 66M | 53 | 170.99 | 64% |
| xhigh | 62 | $2.52 | 22k | 27M | 54 | 52.89 | 64% |
| high | 60 | $2.07 | 18k | 20M | 56 | 22.07 | 60% |

The `max` and `xhigh` rows both round to 62. The page data gives 62.14 and
61.56.

AA and OpenAI list $8.00 input, $0.40 cached input, $10.00 cache write, and
$40.00 output per 1M tokens. OpenAI also lists a 1,050,000-token context,
922,000 maximum input tokens, and 128,000 maximum output tokens
(<https://developers.openai.com/api/docs/models/gpt-6.2-astra>). The
long-prompt rule of GPT-6.2 Sol also applies. The knowledge cutoff is
2026-05-18. OpenAI released the model on 2026-11-17, in the same changelog
entry as GPT-6.2 Sol. Codex uses a 272,000-token default context. On
2026-11-18, omp 18.22.2 listed `gpt-6.2-astra` with the same 272K context
window, 128K maximum output, and the levels low, medium, high, xhigh, and max.

`modelRoles.astra` and `retry.fallbackChains.fable` moved from GPT-6 Astra
`xhigh` to GPT-6.2 Astra `xhigh` (DocksDocks/public#175). GPT-6 Astra below
has the v5.0.1 figures for a like-for-like comparison.

### GPT-6 Astra (OpenAI) - previous generation

The role map and the retry chains no longer use GPT-6 Astra. This table stays
as the v4.3.2 baseline for the previous `astra` role.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 53 | $3.26 | 27k | 60M | 57 | 305.56 | 59% |
| xhigh | 52 | $2.31 | 17k | 38M | 49 | 126.90 | 60% |
| high | 51 | $1.73 | 12k | 26M | 50 | 41.09 | 54% |
| medium | 50 | $1.54 | 10k | 19M | 47 | 4.88 | 49% |
| low | 46 | $0.82 | 4k | 10M | 49 | 2.81 | 42% |

Price: $10.00 in, $50.00 out, $1.00 cache hit per 1M. Context 1M. Knowledge
cutoff 2026-04-30. AA publishes no non-reasoning Astra row.

On 2026-11-18, the v5.0.1 data of the AA model page `/models/gpt-6-astra`
listed GPT-6 Astra `xhigh` at index 55 and $3.66 per task, with 44 t/s and an
83.77 s TTFT. It listed `high` at index 55, $3.24, 44 t/s, and 40.21 s. At
`xhigh`, GPT-6.2 Astra scores 62 against 55 and costs $2.52 against $3.66 per
task. It produces 54 against 44 t/s, with a TTFT of 52.89 s against 83.77 s.
AA marks GPT-6 Astra deprecated, so its comparison pages return HTTP 404.

### GPT-6.1 Sol (OpenAI) - previous generation

The role map and the retry chains no longer use GPT-6.1 Sol. This table stays
as the v4.3.2 baseline for the former `task` role and retry fallbacks.

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
`none`, `minimal`, or non-reasoning level. On 2026-11-18, omp 18.22.2 still
served `gpt-6.1-sol`, and the OpenAI deprecations page did not list it. AA
marks it deprecated.

### GPT-6.1 Terra (OpenAI) - `openai-codex/gpt-6.1-terra`

Source: `https://artificialanalysis.ai`, read on 2026-11-05 at Intelligence
Index v5.0.1, from the metric table of
`/models/comparisons/<level-slug>-vs-gpt-5-6-sol-high`. AA serves `max` under
the bare model slug. These figures use another index version than the rest of
this snapshot, so they do not compare with the v4.3.2 rows above.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 51 | $0.96 | 60k | 99M | 76 | 159.59 | 56% |
| xhigh | 45 | $0.40 | 26k | 35M | 74 | 33.02 | 46% |
| high | 42 | $0.26 | 17k | 21M | 73 | 10.91 | 42% |
| medium | 38 | $0.17 | 11k | 14M | 72 | 4.43 | 32% |
| low | 29 | $0.07 | 4k | 7M | 72 | 2.34 | 15% |

For comparison at the same index version, AA lists GPT-6.1 Sol high at index
50, $0.59 per task, 23k tokens per task, 25M index tokens, 57 t/s, a 38.27 s
TTFT, and 52% on Terminal-Bench 4.0. The same Sol high row read 50, $0.32, and
57.26 s at v4.3.2, which shows why the two captures do not mix.

On 2026-11-18, the release comparison page
`/models/comparisons/gpt-6-2-sol-vs-gpt-6-1-terra` showed new speed and TTFT
figures for GPT-6.1 Terra at v5.0.1. `high` ran at 65 t/s with a 10.50 s
TTFT, `xhigh` at 65 t/s with 30.33 s, and `max` at 69 t/s with 146.49 s. The
index, cost, and token figures were unchanged. AA measures speed and latency
continuously, so the table keeps the 2026-11-05 rows. The speed comparison
below uses the 2026-11-18 figures.

AA and OpenAI list $1.00 input, $5.00 output, and $0.05 cached input per 1M
tokens. OpenAI also lists a 1,050,000-token context, 922,000 maximum input
tokens, and 128,000 maximum output tokens
(<https://developers.openai.com/api/docs/models/gpt-6.1-terra>).
Fast mode costs 2x Standard. The knowledge cutoff is 2026-06-01. The API effort
ladder is `none, low, medium, high, xhigh, max`, with `medium` as the default.

### Output speed: GPT-6.2 Sol and GPT-6.1 Terra

GPT-6.2 Sol has the higher output speed at `high` and at `xhigh`.
The figures come from one page,
`/models/comparisons/gpt-6-2-sol-vs-gpt-6-1-terra`, read on 2026-11-18 at
Intelligence Index v5.0.1.

| Metric | GPT-6.2 Sol | GPT-6.1 Terra |
|---|---:|---:|
| `high` output speed | 78 t/s | 65 t/s |
| `xhigh` output speed | 81 t/s | 65 t/s |
| `high` TTFT | 9.63 s | 10.50 s |
| `xhigh` TTFT | 26.63 s | 30.33 s |
| `high` end-to-end time | 42.65 s | 43.91 s |
| `xhigh` end-to-end time | 85.03 s | 86.53 s |

At `high`, Sol produces about 19% more tokens per second than Terra. At
`xhigh`, the gain is about 24%. Sol also has the lower TTFT and end-to-end
time at both levels.

The `reviewer` role stays on GPT-6.1 Terra `high`. The #130 benchmark chose
Terra by escaped defects, not by speed. omp 18.22.2 lists no GPT-6.2 Terra. A
move of the reviewer to GPT-6.2 Sol needs a new benchmark.

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
baseline for the former GPT-6.1 Sol `task` retry fallback.

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
2026-10-09. GPT-6.1 Sol high then became the `task` retry fallback. Since
DocksDocks/public#175, the fallback is GPT-6.2 Sol high
(`openai-codex/gpt-6.2-sol:high`). The owner uses Astra only for main
orchestration, so Astra has a dedicated `astra` cycle stop at `xhigh`. This
comparison keeps the retired Astra-low, GPT-5.6 Sol, and GPT-6.1 Sol choices
beside the current Opus level. It is the v4.3.2 capture of 2026-09-29, so it
does not compare with the v5.0.1 GPT-6.2 rows. GPT-6.2 Sol above has the
figures for the current fallback.

| Metric | Astra low, retired | GPT-5.6 Sol high, retired | GPT-6.1 Sol high, former fallback | GPT-6.1 Sol max | Opus 5.5 high, current |
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

The `astra` cycle stop runs GPT-6.2 Astra `xhigh`. At v5.0.1 it has index 62,
$2.52 per index task, and a 52.89 s TTFT (see GPT-6.2 Astra). Coding Agent
Index v2.1 lists Codex with GPT-6.2 Astra at high, xhigh, and max.

## How Astra is selected in practice

No subagent role or `task.agentModelOverrides` entry resolves Astra.
`modelRoles.astra` is reachable only through the model switcher as a main
orchestrator role. The explicit Fable retry chain can also select Astra.
No subagent selects Astra automatically.

`SoT/.omp/models.yml` declares the full `low, medium, high, xhigh, max` ladder
with `defaultLevel: xhigh` under
`providers.openai-codex.modelOverrides.gpt-6.2-astra.thinking`.
The override stays as the kit's worked example of a provider ladder
redefinition. The in-session thinking control can still select `low` for a
quick answer. The block is keyed by model id, so it moved from `gpt-6-astra`
to `gpt-6.2-astra` with the role. `ompRemovals.ts syncOmpModelRemovals`
prunes the deployed `gpt-6-astra` block while it equals the shipped block, and
keeps a block that the user edited.

- The bundled `scout` and `sonic` agents carry `model: "@smol"` and
  `thinking-level: medium` in their embedded frontmatter, so they run Luna,
  not Opus 5.5 or Astra. To move them, change `modelRoles.smol` or add a
  `task.agentModelOverrides` entry for the agent name.
- The bundled `task` agent carries `model: "@task"` and
  `thinking-level: auto`. It resolves Opus 5.5 high. The `:high` suffix on
  `modelRoles.task` is an explicit level, so it outranks the agent's `auto`,
  and the auto classifier does not run for a `task` spawn.
- `task.enableEffort` stays at omp's default `false`, so the task tool has no
  `effort` field and every spawn runs the level of its agent's role. When the
  field is on, a caller can pass `effort: lo`, `med`, or `hi`, and caller
  effort outranks the role suffix. omp maps it onto the model's own ladder,
  not onto level names: `lo` selects the lowest level, `med` the lower middle,
  and `hi` the highest (`resolveTaskEffortLevel` in omp's
  `packages/tui/src/thinking.ts`, omp 18.8.5). Then omp caps the result at
  `task.maxEffort`. Up to 0.23.0 the kit set that cap to `xhigh`. On the
  `low, medium, high, xhigh, max` ladder, `hi` then gave `xhigh`, so many
  `task` spawns ran Opus 5.5 xhigh despite the `:high` role suffix. On
  2026-11-05, a fresh `omp -p` run on omp 18.16.0 with the field off had no
  `effort` field, and its `task` child recorded
  `resolvedModel: anthropic/claude-opus-5-5:high`.
- Since 0.24.0 the kit sets no `task.maxEffort`, so the cap is omp's default
  `max`. With `task.enableEffort` off, the cap applies only to a per-call
  `model` with a `:level` suffix.
- In the deployed config, `scout` and `sonic` run GPT-6 Luna `medium`. The
  four reviewer agents resolve `@reviewer` and run GPT-6.1 Terra `high` on the
  live tier of the main session. A `docks-kit omp` free session replaces
  both roles with its free model (see Free session launcher). A retry can
  fall back to the role's fallback chain, for the reviewers Opus 5.5 `high`.

The runtime per-agent measurement from fresh `omp -p` runs on 2026-09-09
predates this change. It applies to the retired Astra-low `task` configuration,
not the current role map.

On 2026-11-18, omp 18.22.2 listed GPT-6.2 Astra with a 272,000-token context
window. This is the `/extended-context off` window, and it equals the Codex
default context. OpenAI lists a 1,050,000-token context and 922,000 maximum
input tokens. For GPT-6 Astra, `/extended-context on` used the 922k input
window. The kit has not checked the window that `/extended-context on` gives
for GPT-6.2 Astra.

## Free session launcher (`docks-kit omp`)

`docks-kit omp [--model <selector>|--pick] [args...]` starts one interactive
omp session with a configuration overlay that selects a free model. The
overlay sets the 16 chat-model roles in `ompOverlay.ts ROLE_ORDER` to that
model and empties the 12 retry fallback chains in `ompOverlay.ts
FALLBACK_ORDER`. These roles include `memory`, `judge`, and `advisor`. The SoT
does not set them, but omp otherwise uses its built-in priority chain for
`memory` and `judge`, and that chain can name a paid model. omp resolves the
`/advisor on` model from `modelRoles.advisor` before the `slow` role. A
deployed, user, or project `advisor` role could otherwise send it to a paid
model. The overlay also empties the retry
chains keyed by the free model: the bare selector, `<selector>:off`, and
`<selector>:<level>` for every level in `ompOverlay.ts THINKING_LADDER`. omp
uses a chain keyed by the model before a role chain, so a project or
`PI_CONFIG_FILES` chain for the free model could otherwise reach a paid model.
The overlay does not set the `web` role or its retry chain. The deployed
web-search provider order therefore applies, and that order includes the paid
`openai-codex/gpt-6-luna` entry. omp merges the overlay key by key. Each other
deployed retry chain, such as a `plan`, `slow`, or `designer` chain, therefore
stays in the merged config. A retry of the free model does not reach such a
chain, because omp uses the empty chain keyed by the free model first.
The overlay also sets `defaultThinkingLevel` and `task.maxEffort` to the
session level. For a model that publishes no thinking ladder, the overlay
omits both keys. A value in the deployed config then applies, or else the omp
default, which is `max` for `task.maxEffort`.

The launcher renders a run overlay to
`~/.cache/docks-kit/omp-free-<model>-<digest>.yml` at mode 0600 and passes it
through omp's repeatable `--config` flag. Each distinct model-and-level
combination gets its own file, because omp re-reads a changed overlay during
a live session, and a second launcher must not change the level of that
session. The name sanitizes the selector for the file system and appends a
digest of the rendered overlay. The digest covers the selector and the
level, so two selectors that differ only in separator characters stay
apart. A session launch never reads or writes `~/.omp/agent/config.yml` or
`models.yml`; only `--fast`, below, edits `config.yml`. It
never touches the SoT. The next plain `omp` run uses the paid configuration
again.

The launcher starts omp as
`omp launch --config <overlay> --model <selector>[:<level>] [args...]`, where
`[args...]` are the arguments after the launcher flags, in the same order.
`docks-kit omp -p "..."` runs one prompt. `docks-kit omp --continue` resumes
the previous session. A bare `docks-kit omp` opens an interactive session.

`launch` makes omp read every forwarded word as message text. So `docks-kit
omp commit` sends `commit` to the free model as a prompt, and no omp
subcommand runs through the launcher. To run an omp subcommand such as
`commit`, `bench`, or `search`, run `omp` directly. The explicit `--model`
outranks the model that omp restores from a stored session. So `--continue`,
`--resume`, and `autoResume` keep the free model and its level.

### Model selection that the launcher controls

The overlay ranks above the deployed global and project configuration, and
below runtime overrides and later overlay files. The launcher handles each
known input that can select a model above the overlay:

- Forwarded model flags. The launcher rejects `--config`, `--model`,
  `--smol`, `--slow`, `--plan`, `--models`, `--provider`, `--prewalk-into`,
  and `--plan-yolo-into`, in the `--flag value` and the `--flag=value` form.
  It exits with code 2 and starts no omp process. It checks every forwarded
  argument, also after a `--`, because omp can read that `--` as the value of
  a flag such as `--api-key` and then read the next flag. The error names the
  flag and the recoveries. For a free model, put `--model <selector>` before
  the other arguments or use `--pick`. For a paid model, run `omp` directly.
  For another config file, list it in `PI_CONFIG_FILES`.
- A restored session model. The explicit `--model` keeps the free model.
- An omp subcommand. `launch` makes it message text.
- The model environment variables `PI_SMOL_MODEL`, `PI_SLOW_MODEL`, and
  `PI_PLAN_MODEL`. The launcher sets each one to the overlay value of its
  role in the omp environment, and prints one warning for each exported value
  that it replaces. omp fills an unset or empty variable from its `.env`
  files, so the launcher sets the variables instead of removing them.
- `PI_CONFIG_FILES`. The launcher appends the overlay path to the exported
  entries, so an `omp` that the bash tool of the session starts loads the
  overlay too. omp loads these files below `--config` overlays, so an exported
  entry still applies below the overlay. A `PI_CONFIG_FILES` value in an omp
  `.env` file does not apply in a launcher session, because the launcher
  always sets the variable.
- The omp profile. The catalog check below covers every profile that the
  launch can select.

### Model selection outside the launcher

These paths act after omp starts or outside the chat roles. The launcher does
not control them:

- In-session selection. `Alt+M` (model hub), `Alt+P` (session-only picker),
  `/switch <selector>`, `/model`, and `/modelpreset` can select any catalog
  model. `/resume` and a session switch restore the model of the target
  session. A seance subagent runs on the models of its source session. An
  `Alt+M` assignment of the `default` role writes `modelRoles.default` to the
  deployed `~/.omp/agent/config.yml`, so later plain `omp` runs use it too.
- The `web` role and its retry chain. By owner decision they keep the
  deployed web-search provider order, which can reach the paid
  `openai-codex/gpt-6-luna` entry.
- The model-kind roles `image`, `speech`, and `dictation`. A chat model
  cannot serve them, so the overlay does not set them.
- Extensions and hooks. `-e`, `--hook`, and `--plugin-dir` run arbitrary
  code, and that code can select any model.

These lists name the known paths. They are not a closed set.

The default model is `opencode-zen/muse-spark-1.3-contributor-free` ("Muse
Spark 1.3 Free", 1,048,576-token context) at `xhigh`. `xhigh` is the ceiling
of that model ladder: `minimal, low, medium, high, xhigh`. The paid
`muse-spark-1.3` sibling also offers `max`. The free variant does not.

The level comes from the ladder of the chosen model, never from a fixed list.
Every role, `advisor` included, runs the same level. Under `--model`, that
level is the ceiling of the ladder.

Free ladders are not uniform. On 2026-09-11 the 26 free models published six
distinct ladders: 21 include `medium`, 3 stop at `low, high, max` or
`high, max`, and 2 publish no ladder at all. A model without a ladder gets
bare selectors with no `:level` suffix, because an invented level makes omp
fail when the session starts.

The choice persists per machine in `~/.docks-kit/kit.db` (table
`omp_session`). It survives across sessions. It is never
committed. `--model <selector>` records one selector and derives the level
from the catalog row. `--pick` opens an interactive wizard.

The picker lists only models the live `omp models --json` catalog reports at
zero input and output cost with `pricingStatus` `free` or `unknown` (26
entries on 2026-09-11). A zero-cost row with another status, such as
`variable` or `included`, is billed outside the token price, so the picker
leaves it out. The resulting overlay sets the 16 `ROLE_ORDER` roles to the
chosen free model and empties the 12 `FALLBACK_ORDER` chains and the chains
keyed by that model. The `web` role, its chain, and each other deployed chain
keep the deployed values. The
catalog can advertise a free model that the account cannot call; omp reports
that provider error unchanged.

After the model, the wizard asks about the thinking level. `ompOverlay.ts
planEffortChoice` decides whether the question applies, because omp accepts a
`:level` suffix only for a level the chosen model publishes:

- No ladder: the wizard asks nothing and the overlay omits every level.
- One level: the wizard states that level and asks nothing.
- Two or more levels: the wizard asks one question, the thinking level for
  every role. It lists the levels of the model from the highest down, so
  `Enter` keeps the highest level.

The launch line names the selector and the level, or the model default level
for a model without a ladder. It reports no separate advisor level.

An omp login is required. The kit owns no login flow. Every launch reads the
live free catalog of each candidate profile. A plain launch checks the
remembered model, or the default model, against those catalogs. When the
model is not there, the launcher stops before omp starts. The model can be
renamed, repriced, or on a provider that is not logged in. Without this
check, omp silently starts the default model of the first logged-in
provider, which can be paid.

Each omp profile has its own login and `models.yml`, so a selector can be
free in one profile and missing or paid in another. The candidate profiles
are the profile of the environment (`OMP_PROFILE`, `PI_PROFILE`, or the
default) and each forwarded `--profile <name>` or `--profile=<name>` value.
The launcher reads every forwarded argument, also after a `--`, because omp
can read that `--` as a flag value and then select a later profile. It runs
`omp models --json` for the profile of the environment and
`omp --profile <name> models --json` for each forwarded name. The session
model must be free in every one of these catalogs. `--model` and `--pick`
choose from the catalog of the last forwarded profile, or of the profile of
the environment when the arguments name none. A `--profile` without a name
stops the launcher before omp starts.

When the catalog renames the free variant, change only the default selector
constant. Until then, a plain launch on that default stops with an error. A
ladder change needs no code change. Under `--model` the level is derived
from the catalog row of the chosen model, and under `--pick` the user chooses
it from the ladder that same row publishes. Refresh the recorded default
and the ladder counts in these docs in the same commit.

## OpenAI fast mode (`docks-kit omp --fast`)

`docks-kit omp --fast` toggles `tier.openai` in the deployed
`~/.omp/agent/config.yml` between `priority` and `none`, prints the old and new
values, and exits without starting a session. `priority` is the tier omp's
`/fast on` selects for OpenAI and OpenAI-Codex models. `--fast` over
`ultrafast` selects `priority`. The kit ships no Ultrafast toggle: omp honors
`ultrafast` for a Codex model only when its catalog `serviceTiers` lists it.
The omp 18.4.9 catalog listed none for GPT-6.1 Sol, Astra, or Luna. On
2026-11-18, `omp models openai-codex --json` on omp 18.22.2 listed no
`serviceTiers` for any `gpt-6` id, `gpt-6.2-sol` and `gpt-6.2-astra`
included. The SoT does not declare `tier.openai`, so the additive sync merge
keeps the toggled value. New sessions read it; a running session changes
through `/fast`.

The four review agents inherit the live tier of the main session
(`task.agentServiceTierOverrides: inherit`). In a new session after
`docks-kit omp --fast`, they run on `priority` when `tier.openai` is `priority`,
and on standard processing when it is `none`. A running session keeps the tier
it started with, so its reviewers do not follow a later toggle.

`--fast` never changes the Anthropic tier. The SoT leaves `tier.anthropic` at
omp's default `none`, so each session starts with it. In omp
18.16.0, `/fast on` in a session whose current
model is Anthropic sets `anthropic: priority` for that session. The reviewers
then inherit it, so their Opus 5.5 fallback also runs fast. omp has no
override value that inherits only the OpenAI tier. To keep Anthropic models
on normal processing, use `docks-kit omp --fast` and a new session, not
`/fast` in an Opus session.

## Maintenance

- Refresh each per-level row from the rendered metric table of a release
  comparison page, for example
  `/models/comparisons/gpt-6-2-sol-vs-gpt-6-1-terra` and
  `/models/comparisons/gpt-6-2-astra-vs-gpt-6-2-sol`. Each page shows every
  level of both models. Take tokens per task and index tokens from the data
  of the model page, for example `/models/gpt-6-2-sol`, and check that its
  other values match the rendered table. A model-page chart holds only about
  20 models, so a value missing there does not mean that AA has not measured
  it.
- On 2026-11-18, the per-level pattern
  `/models/comparisons/<level-slug>-vs-gpt-5-6-sol-high` returned HTTP 404. A
  comparison with a model that AA marks deprecated also returned HTTP 404, for
  example `gpt-6-1-sol`, `gpt-6-astra`, or `gpt-5-6-sol`. Read such a model
  from the data of its model page.
- Keep AA rows at `high` and `xhigh` at least for each model that an omp role
  or retry chain uses, with the index version and the capture date (see AA
  rows for each role model). Add the missing rows in the same commit as a
  role or chain change.
- After a role or chain change, run `omp models openai-codex` and check that
  it lists every `openai-codex` id that the roles and chains name. Sync does
  not check the omp catalog.
- Refresh the Coding Agent Index from `/agents/coding-agents`.
- Record the index version with the numbers. AA changes index composition
  between versions, so a score from another version is not a comparison.
- Update the capture date in the same commit as any number.
- Verify Astra ladder changes in `SoT/.omp/models.yml` through the model
  switcher and in-session thinking control.
- The kit leaves `task.maxEffort` and `task.enableEffort` at omp's defaults,
  `max` and `false`. After an omp update, check both in
  `omp config list --json`. Verify a kit change to either key with a fresh
  `omp -p` spawn per bundled agent.
