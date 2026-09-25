# omp models

Why `SoT/.omp/config.yml` points each omp role at a specific model and thinking
level, and the Artificial Analysis (AA) measurements the choices were weighed
against.

## Role map

| Role | Model | Level | Index | Cost/task | TTFT |
|---|---|---|---:|---:|---:|
| `default` | `anthropic/claude-opus-5-5` | high | 54 | $1.82 | 12.49 s |
| `slow` | `anthropic/claude-opus-5-5` | xhigh | 56 | $3.46 | 165.20 s |
| `plan` | `anthropic/claude-opus-5-5` | xhigh | 56 | $3.46 | 165.20 s |
| `task` | `openai-codex/gpt-6-sol` | high | 43 | $0.37 | n/a |
| `advisor` | `anthropic/claude-opus-5-5` | medium | 51 | $1.34 | 22.17 s |
| `designer` | `anthropic/claude-opus-5-5` | high | 54 | $1.82 | 12.49 s |
| `vision` | `anthropic/claude-opus-5-5` | medium | 51 | $1.34 | 22.17 s |
| `smol` / `commit` | `openai-codex/gpt-6-luna` | medium | 29 | $0.02 | n/a |
| `tiny` | `openai-codex/gpt-6-luna` | low | 21 | $0.0045 | n/a |
| `fable` | `anthropic/claude-fable-5-1` | medium | 49 | $2.98 | 8.61 s |
| `switch_fable` | `anthropic/claude-fable-5-1` | medium | 49 | $2.98 | 8.61 s |
| `astra` | `openai-codex/gpt-6-astra` | xhigh | 52 | $2.31 | 188.20 s |
| `web` | `web/firecrawl` | n/a | n/a | n/a | n/a |

The table reports the measured Artificial Analysis figures for each assigned
model and level. It states no motive that the config or omp's own
documentation does not establish. AA has not measured output speed or latency
for GPT-6 Sol or GPT-6 Luna at any level, so those rows carry `n/a` for TTFT.
AA measures no web search provider, so the `web` row carries no figures.

The role map carries no Coding Agent Index column. That index publishes one
entry per harness and model, and the Codex entries for GPT-6 Sol and GPT-6
Luna run at `max`, a level no role here uses. The snapshot section below
lists the entries.

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
recorded `gpt-6-sol` and `gpt-6-luna` as the serving model, so the omp roles
now run GPT-6. To check again, run `omp models openai-codex`: the `gpt-6-sol`
and `gpt-6-luna` rows must appear.

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
`retry.fallbackChains.task` keeps `anthropic/claude-opus-5-5:high` as a
cross-vendor fallback.

`retry.fallbackChains.astra` holds `anthropic/claude-fable-5-1:medium`.
`retry.fallbackChains.fable` holds `openai-codex/gpt-6-astra:xhigh`.
Each deliberate cycle stop falls to the other vendor. Without these explicit
chains, `retry.fallbackChains.default` would send either stop to
`openai-codex/gpt-6-sol:high`.
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
role and its fallback chain.

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

Source: `https://artificialanalysis.ai`, read on 2026-09-22. Every figure below
comes from that one capture at Intelligence Index v4.3.2 and Coding Agent Index
v1.5. Each per-level row was read from the metric table of the comparison page
`/models/comparisons/<level-slug>-vs-gpt-5-6-sol-high`. The page title named
the requested model and level, and the page printed index v4.3.2. AA serves
the `max` level under the bare model slug. Index composition changed in v4.2,
again in v4.3, and again in v4.3.2, so figures from an earlier capture cannot
be mixed with these.

Coding Agent Index v1.5 (`/agents/coding-agents`) lists 12 harness and model
entries. Most carry `max`. Grok Build with Grok 4.7 runs at `xhigh`, and
Antigravity SDK with Gemini 3.8 Flash runs at `high`. Opencode with GLM-5.3
and Kimi Code CLI with Kimi K3 name no level. The entries that involve a model
family in this topic:

| Harness and model | Coding Agent Index |
|---|---:|
| Claude Code - Fable 5.1 (max, with fallback) | 62.2 |
| Codex - GPT-6 Astra (max) | 61.6 |
| Claude Code - Opus 5 (max) | 59.7 |
| Codex - GPT-6 Sol (max) | 56.7 |
| Codex - GPT-6 Luna (max) | 41.1 |

AA lists no Opus 5.5 entry. The page stores each score as a fraction, such as
`0.6222`, and this table shows it multiplied by 100.

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
| max | 58 | $5.98 | 119k | 260M | n/a | n/a | 60% |
| xhigh | 56 | $3.46 | 66k | 100M | 72 | 165.20 | 60% |
| high | 54 | $1.82 | 36k | 53M | 91 | 12.49 | 57% |
| medium | 51 | $1.34 | 26k | 38M | 76 | 22.17 | 53% |
| low | 42 | $0.55 | 10k | 20M | 94 | 4.79 | 31% |

Price: $4.00 in, $20.00 out, $0.20 cache hit per 1M. The Anthropic platform
documentation read the same day lists the same input, output, and cache-read
prices. It adds a $5.00 five-minute cache write and an $8.00 one-hour cache
write, which the AA comparison table does not show. Context 1M, maximum output
128K. Adaptive thinking is always on, and the Claude API default effort is
`medium`. All AA levels run with fallback. Max is the highest Intelligence
Index in this topic at this capture. AA has not measured speed or latency for
max. It measures a longer TTFT for medium than for high.

`SoT/.omp/models.yml` carries the Anthropic limits and prices as an `anthropic`
`modelOverrides` block, because the shared catalog still serves this id as a
stub with null limits and zero cost. Remove that block once the catalog
publishes the row.

### Claude Fable 5.1 (Anthropic) - `anthropic/claude-fable-5-1`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 53 | $7.63 | 78k | 188M | 66 | 311.51 | 52% |
| xhigh | 53 | $5.98 | 61k | 121M | 61 | 164.82 | 55% |
| high | 51 | $3.91 | 38k | 62M | 55 | 26.22 | 52% |
| medium | 49 | $2.98 | 28k | 44M | 55 | 8.61 | 45% |
| low | 47 | $2.37 | 22k | 33M | 54 | 7.28 | 40% |

Price: $10.00 in, $50.00 out, $0.25 cache hit per 1M. Context 1M. All levels
run with fallback.

### GPT-6 Astra (OpenAI) - `openai-codex/gpt-6-astra`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 53 | $3.26 | 27k | 60M | 61 | 322.65 | 59% |
| xhigh | 52 | $2.31 | 17k | 38M | 55 | 188.20 | 60% |
| high | 51 | $1.73 | 12k | 26M | 50 | 79.00 | 54% |
| medium | 50 | $1.54 | 10k | 19M | 48 | 6.19 | 49% |
| low | 46 | $0.82 | 4k | 10M | 51 | 2.76 | 42% |

Price: $10.00 in, $50.00 out, $1.00 cache hit per 1M. Context 1M. Knowledge
cutoff 2026-04-30. AA publishes no non-reasoning Astra row.

### GPT-6 Sol (OpenAI) - `openai-codex/gpt-6-sol`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 48 | $1.06 | 31k | 77M | n/a | n/a | 44% |
| xhigh | 44 | $0.53 | 16k | 40M | n/a | n/a | 30% |
| high | 43 | $0.37 | 10k | 25M | n/a | n/a | 26% |
| medium | 40 | $0.25 | 6k | 16M | n/a | n/a | 19% |
| low | 34 | $0.13 | 3k | 9M | n/a | n/a | 9% |
| non-reasoning | 28 | $0.33 | 5k | 8M | n/a | n/a | 13% |

Price: $2.00 in, $10.00 out, $0.20 cache hit per 1M. OpenAI's model page lists
a $2.50 cache write and a 1,050,000-token context with 128,000 maximum output
tokens. It bills a prompt above 272K input tokens at 2x input and cache rates
and 1.5x output for the full request. Knowledge cutoff 2026-04-20. The API
effort ladder is `none, low, medium, high, xhigh, max`, with `medium` as the
default. AA has not measured speed or latency for any level.

### GPT-6 Luna (OpenAI) - `openai-codex/gpt-6-luna`

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 37 | $0.07 | 51k | 145M | n/a | n/a | 13% |
| xhigh | 34 | $0.04 | 27k | 68M | n/a | n/a | 8% |
| high | 32 | $0.03 | 20k | 47M | n/a | n/a | 5% |
| medium | 29 | $0.02 | 11k | 28M | n/a | n/a | 3% |
| low | 21 | $0.0045 | 2k | 8M | n/a | n/a | 0% |
| non-reasoning | 18 | $0.01 | 4k | 7M | n/a | n/a | 2% |

Price: $0.10 in, $0.50 out, $0.01 cache hit per 1M. OpenAI's model page lists
a $0.125 cache write, the same context, output, long-prompt billing, and
effort ladder as Sol, and a 2026-05-18 knowledge cutoff. AA has not measured
speed or latency for any level.

### GPT-5.6 Sol (OpenAI) - previous generation

The role map no longer uses GPT-5.6 Sol. This table stays as the measured
baseline for the GPT-6 Sol switch.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 47 | $1.99 | 29k | 90M | 82 | 130.17 | 40% |
| xhigh | 44 | $1.18 | 20k | 51M | 72 | 35.55 | 25% |
| high | 42 | $0.81 | 13k | 34M | 68 | 17.49 | 21% |
| medium | 39 | $0.50 | 8k | 21M | 58 | 5.07 | 15% |
| low | 33 | $0.26 | 4k | 13M | 58 | 3.85 | 1% |
| non-reasoning | 28 (estimated) | n/a | n/a | n/a | 64 | 1.22 | n/a |

Price: $4.00 in, $20.00 out, $0.40 cache hit per 1M. Context 1M. AA marks the
non-reasoning index score as estimated.

### GPT-5.6 Luna (OpenAI) - previous generation

The role map no longer uses GPT-5.6 Luna. This table stays as the measured
baseline for the GPT-6 Luna switch.

| Level | Index | Cost/task | Tokens/task | Index tokens | Speed t/s | TTFT s | TB 4.0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| max | 37 | $0.18 | 41k | 154M | 145 | 122.15 | 12% |
| xhigh | 35 | $0.09 | 24k | 85M | 143 | 40.24 | 4% |
| high | 32 | $0.04 | 14k | 50M | 132 | 15.15 | 3% |
| medium | 25 | $0.02 | 4k | 18M | 133 | 2.57 | 1% |
| low | 21 | $0.01 | 3k | 10M | 131 | 1.69 | 0% |
| non-reasoning | 16 | $0.01 | 2k | 5M | 140 | 0.81 | 1% |

Price: $0.20 in, $1.20 out, $0.02 cache hit per 1M. Context 1M.

## Why `task` runs GPT-6 Sol high

`task` runs `openai-codex/gpt-6-sol:high`, the same level GPT-5.6 Sol ran
before it. The owner uses Astra only for main orchestration, so Astra has a
dedicated `astra` cycle stop at `xhigh`. The comparison below records the
retired Astra-low and GPT-5.6 Sol choices beside the current GPT-6 Sol choice.

| Metric | Astra low, retired | GPT-5.6 Sol high, previous | GPT-6 Sol high, current | GPT-6 Sol max | Opus 5.5 high, `default` |
|---|---:|---:|---:|---:|---:|
| Intelligence Index | 46 | 42 | 43 | 48 | 54 |
| Cost per Index task | $0.82 | $0.81 | $0.37 | $1.06 | $1.82 |
| Output tokens per task | 4k | 13k | 10k | 31k | 36k |
| Index output tokens | 10M | 34M | 25M | 77M | 53M |
| Answer TTFT | 2.76 s | 17.49 s | n/a | n/a | 12.49 s |
| End-to-end response time | 12.49 s | 24.87 s | n/a | n/a | 18.00 s |
| Time per index task | 87.88 s | 189.16 s | n/a | n/a | 244.35 s |
| Terminal-Bench 4.0 | 42% | 21% | 26% | 44% | 57% |
| AA-Briefcase v1.1 | 1261 | 1370 | 1289 | 1483 | 1705 |
| AA-Omniscience | 41 | 20 | 27 | 27 | 41 |

GPT-6 Sol high scores one index point above GPT-5.6 Sol high. It costs $0.37
against $0.81 per index task and uses 10k output tokens per task against 13k.
It also scores 26% against 21% on Terminal-Bench 4.0. AA-Briefcase is the one
metric where the older model leads, at 1370 against 1289. AA has not measured
GPT-6 Sol latency, so the latency comparison is open.

Astra low still beats GPT-6 Sol high on the index, at 46 against 43, and on
Terminal-Bench 4.0, at 42% against 26%. It costs $0.82 against $0.37 per index
task. The owner reserves Astra for interactive orchestration.

Opus 5.5 high scores 11 points above GPT-6 Sol high and costs $1.82 against
$0.37 per index task. It is the `default`, `designer`, and fallback model, not
the `task` model, so the subagent fan-out keeps the cheaper Sol.

The `astra` cycle stop runs xhigh: index 52, $2.31 per index task, and
188.20 s TTFT. AA publishes a Coding Agent Index entry for Astra only at max,
paired with Codex, where it scores 61.6.

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
  not Sol or Astra. To move them, change `modelRoles.smol` or add a
  `task.agentModelOverrides` entry for the agent name.
- The bundled `task` agent carries `model: "@task"` and
  `thinking-level: auto`. It resolves GPT-6 Sol, and `auto` classifies each prompt
  to choose a thinking level.
- `task.enableEffort` is `true`, so a caller can pass `effort: lo`, `med`, or
  `hi`, which overrides `auto`.
- `task.maxEffort` is `max`, so `scout` and `sonic` run GPT-6 Luna `medium`
  by default and GPT-6 Luna `max` with `effort: hi`.
- The bundled `reviewer` and `security-reviewer` inherit `@task`, now GPT-6
  Sol high.
- The `code-reviewer` and `plan-reviewer` override entries remain dormant.
  Both point to `@task`, now GPT-6 Sol high. omp's task tool rejects both
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
two selectors that differ only in separator characters stay apart. The
launcher never reads or writes `~/.omp/agent/config.yml` or `models.yml`. It
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
