# omp models

Why `SoT/.omp/config.yml` points each omp role at a specific model and thinking
level, and the Artificial Analysis (AA) measurements the choices were weighed
against.

## Role map

| Role | Model | Level | Index | Cost/task | TTFT | Coding Agent Index |
|---|---|---|---:|---:|---:|---:|
| `default` | `anthropic/claude-opus-5` | high | 48 | $3.61 | 16.96 s | 66 (Claude Code) |
| `slow` | `anthropic/claude-opus-5` | xhigh | 50 | $4.88 | 28.65 s | 68 (Claude Code) |
| `plan` | `anthropic/claude-opus-5` | xhigh | 50 | $4.88 | 28.65 s | 68 (Claude Code) |
| `task` | `openai-codex/gpt-6-astra` | low | 46 | $0.82 | 2.60 s | n/a |
| `advisor` | `openai-codex/gpt-5.6-sol` | medium | 39 | $0.50 | 4.90 s | 62 (Codex) |
| `designer` | `anthropic/claude-opus-5` | high | 48 | $3.61 | 16.96 s | 66 (Claude Code) |
| `vision` | `anthropic/claude-opus-5` | medium | 45 | $2.19 | 3.79 s | 64 (Claude Code) |
| `smol` / `commit` | `openai-codex/gpt-5.6-luna` | medium | 26 | n/a | 2.18 s | 42 (Codex) |
| `tiny` | `openai-codex/gpt-5.6-luna` | low | 22 | n/a | 1.78 s | 25 (Codex) |
| `fable` | `anthropic/claude-fable-5-1` | medium | 49 | $2.98 | 9.65 s | n/a |
| `switch_fable` | `anthropic/claude-fable-5-1` | medium | 49 | $2.98 | 9.65 s | n/a |

The table reports the measured Artificial Analysis figures for each assigned
model and level. It states no motive that the config or omp's own
documentation does not establish. AA lists no cost per task for Luna medium
and low, and no Coding Agent Index for any Astra or Fable 5.1 level except
max.

What omp's settings catalog establishes about these roles:

- `cycleOrder` lists the roles the model switcher cycles, so `fable` is the
  fourth `Ctrl+P` stop.
- `tiny` overrides the model for lightweight background tasks: titles, memory,
  auto-thinking, and unexpected-stop detection.
- `modelTags` carries role metadata and can introduce roles; `hidden: true`
  keeps `switch_fable` out of the switcher list.

`task.agentModelOverrides` maps `reviewer`, `security-reviewer`,
`code-reviewer`, and `plan-reviewer` to `@task`, so all four inherit whatever
`task` resolves to. `retry.fallbackChains.task` keeps
`anthropic/claude-opus-5:high` as a cross-vendor fallback.

## Artificial Analysis snapshot

Source: `https://artificialanalysis.ai`, read on 2026-09-08. Every score below
comes from one snapshot: Intelligence Index v4.3 and Coding Agent Index v1.4,
taken from each family's release page, its per-level model pages, and the
harness comparison pages. The v4.1.1-era figures in AA's Astra launch article
are excluded, because index composition changed in v4.2 and again in v4.3, so
mixing them would invalidate every ratio here. The head-to-head rows come from
the direct `gpt-6-astra-low-vs-gpt-5-6-sol-high` comparison page, not from a
comparison against another Sol level.

Column meanings:

- **Intelligence Index** - AA's weighted aggregate across its evaluation set.
  Comparable only inside one index version.
- **Coding Agent Index** - agentic coding score inside a named harness. AA
  publishes it per harness, and for most effort levels it publishes nothing.
- **Cost per Index task** - weighted average USD to run one index task,
  including input, cache, reasoning, and answer tokens.
- **Index output tokens** - total output tokens the model spends to complete the
  whole index run. This is the token-efficiency signal.
- **TTFT** - seconds to the first answer token, so reasoning time counts.

### GPT-6 Astra (OpenAI) - `openai-codex/gpt-6-astra`

| Level | Intelligence Index | Coding Agent Index | Cost per Index task | Index output tokens | Output speed t/s | TTFT s |
|---|---:|---:|---:|---:|---:|---:|
| max | 53 | 67 (Codex) | $3.26 | 60M | 59 | 322.48 |
| xhigh | 53 | n/a | $2.31 | 38M | 57 | 161.65 |
| high | 51 | n/a | $1.72 | 26M | 55 | 45.63 |
| medium | 50 | n/a | $1.54 | 19M | 53 | 5.42 |
| low | 46 | n/a | $0.82 | 10M | 53 | 2.60 |
| non-reasoning | 45 | n/a | $1.71 | 12M | n/a | n/a |

Price: $10.00 in, $50.00 out, $1.00 cache read, $12.50 cache write per 1M.
Context 1M. Knowledge cutoff 2026-04-30.
AA lists non-reasoning above low on cost per task.

### Claude Fable 5.1 (Anthropic) - `anthropic/claude-fable-5-1`

| Level | Intelligence Index | Coding Agent Index | Cost per Index task | Index output tokens | Output speed t/s | TTFT s |
|---|---:|---:|---:|---:|---:|---:|
| max | 54 (estimated) | 70 (Claude Code) | n/a | n/a | 70 | 277.47 |
| xhigh | 53 | n/a | $5.98 | n/a | 60 | 124.87 |
| high | 51 | n/a | $3.91 | n/a | 57 | 23.70 |
| medium | 49 | n/a | $2.98 | n/a | 56 | 9.65 |
| low | 47 | n/a | $2.37 | n/a | 53 | 6.55 |

Price: $10.00 in, $50.00 out, $0.25 cache read per 1M; no published cache-write
price. Context 1M. All levels run with fallback.
AA publishes per-task output tokens instead of index totals here: low 22k,
medium 28k, high 38k, xhigh 61k. AA marks the max index score as estimated.

### Claude Opus 5 (Anthropic) - `anthropic/claude-opus-5`

| Level | Intelligence Index | Coding Agent Index | Cost per Index task | Index output tokens | Output speed t/s | TTFT s |
|---|---:|---:|---:|---:|---:|---:|
| max | 51 | 67 (Claude Code) | $5.86 | 140M | 54.3 | 69.92 |
| xhigh | 50 | 68 (Claude Code) | $4.88 | 110M | 53.0 | 28.65 |
| high | 48 | 66 (Claude Code) | $3.61 | 81M | 54.0 | 16.96 |
| medium | 45 | 64 (Claude Code) | $2.19 | 49M | 53.6 | 3.79 |
| low | 40 | 59 (Claude Code) | $1.10 | 26M | 53.2 | 2.32 |

Price: $5.00 in, $25.00 out, $0.50 cache read, $6.25 cache write per 1M, with a
5-minute cache TTL. Context 1M.
AA reports that its Opus 5 index run fell back to Opus 4.8 for part of the set.

### GPT-5.6 Sol (OpenAI) - `openai-codex/gpt-5.6-sol`

| Level | Intelligence Index | Coding Agent Index | Cost per Index task | Index output tokens | Output speed t/s | TTFT s |
|---|---:|---:|---:|---:|---:|---:|
| max | 47 | 65 (Codex) | $1.99 | 90M | 69.8 | 132.10 |
| xhigh | 44 | 63 (Codex) | $1.18 | 51M | 64.8 | 50.59 |
| high | 42 | 64 (Codex) | $0.81 | 34M | 67.8 | 11.26 |
| medium | 39 | 62 (Codex) | $0.50 | 21M | 66.6 | 4.90 |
| low | 34 | 55 (Codex) | $0.26 | 13M | 67.1 | 2.69 |
| non-reasoning | 28 | 43 (Codex) | n/a | n/a | 65.6 | 1.13 |

Price: $4.00 in, $20.00 out per 1M, with a 90% cache-read discount and no
published numeric cache price. Context 1M.

### GPT-5.6 Luna (OpenAI) - `openai-codex/gpt-5.6-luna`

| Level | Intelligence Index | Coding Agent Index | Cost per Index task | Index output tokens | Output speed t/s | TTFT s |
|---|---:|---:|---:|---:|---:|---:|
| max | 38 | 57 (Codex) | $0.18 | n/a | 121 | 168.22 |
| xhigh | 35 | 53 (Codex) | $0.09 | n/a | 113 | 60.22 |
| high | 33 | 52 (Codex) | n/a | n/a | 120 | 9.62 |
| medium | 26 | 42 (Codex) | n/a | n/a | 110 | 2.18 |
| low | 22 | 25 (Codex) | n/a | n/a | 119 | 1.78 |
| non-reasoning | 17 | 19 (Codex) | n/a | n/a | 120 | 0.76 |

Price: $0.20 in, $1.20 out, $0.02 cache read per 1M; no published cache-write
price. Context 1M. AA lists cost per task only for max and xhigh.

## Why `task` runs Astra low

| Metric | Astra low | Sol high | Sol max | Opus 5 high |
|---|---:|---:|---:|---:|
| Intelligence Index | 46 | 42 | 47 | 48 |
| Cost per Index task | $0.82 | $0.81 | $1.99 | $3.61 |
| Output tokens per task | 4k | 13k | 29k | 46k |
| Index output tokens | 10M | 34M | 90M | 81M |
| Answer TTFT | 2.60 s | 11.26 s | 132.10 s | 16.96 s |
| End-to-end latency | 11.99 s | 18.64 s | 139.27 s | 26.22 s |
| Time per task | 84.45 s | 195.67 s | 411.54 s | 525.57 s |
| Terminal-Bench v4.0 | 42% | 21% | 40% | 46% |
| AA-Briefcase | 1253 | 1361 | 1475 | 1557 |
| AA-Omniscience | 41 | 20 | 22 | 34 |

Astra low beats the previous `task` model, Sol high, on intelligence, latency,
and token use at the same cost per task. Astra costs 2.5× per token and spends
about one third the tokens, so the price rise and the efficiency gain cancel:
this is a latency and token-budget win, not a cost saving.

Sol medium is the cheaper measured alternative, and it was not chosen: index
39, Coding Agent Index 62 (Codex), $0.50 per task, 4.90 s TTFT. Against it,
Astra low costs 64% more per task and scores 7 index points higher, with no
published Astra coding-agent score at that level.

Two risks come with it. Astra low loses AA-Briefcase, the eval closest to this
kit's agent workload, and AA publishes no Coding Agent Index score for any Astra
level except max. Watch reviewer output, because the four reviewer agents
inherit `@task`. If review quality drops, pin those four agents to
`anthropic/claude-opus-5:high` rather than reverting the whole role.

## Maintenance

- Refresh the snapshot from the AA release page of each family
  (`/models/releases/<slug>`), the per-level model pages, and the harness
  comparison pages under `/agents/coding-agents/comparisons/`.
- Record the index version with the numbers. AA changes index composition
  between versions, so a score from another version is not a comparison.
- Update the capture date in the same commit as any number.
