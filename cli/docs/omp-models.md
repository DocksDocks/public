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
`code-reviewer`, and `plan-reviewer` to `@task`. Only the bundled `reviewer`
and `security-reviewer` exist as OMP agents (omp's task tool lists `scout`,
`reviewer`, `security-reviewer`, `task`, and `sonic`), so those two inherit
whatever `task` resolves to. The `code-reviewer` and `plan-reviewer` entries
are dormant until an OMP agent with that name exists.
`retry.fallbackChains.task` keeps `anthropic/claude-opus-5:high` as a
cross-vendor fallback.

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

## Why `task` points at Astra low

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
level except max. Watch reviewer output, because `reviewer` and
`security-reviewer` inherit `@task`. If review quality drops, pin those agents
to `anthropic/claude-opus-5:high` rather than reverting the whole role.

## What resolves to Astra low in practice

`modelRoles.task` sets the model. The `:low` suffix alone does not cap every
spawn. `SoT/.omp/models.yml` restricts the `openai-codex/gpt-6-astra` effort
ladder to `[low]` through
`providers.openai-codex.modelOverrides.gpt-6-astra.thinking`. omp clamps any
requested effort to the model ladder, and `auto` has only one choice. Every
Astra spawn therefore runs `low`, regardless of its `effort` hint.

- The bundled `scout` and `sonic` agents carry `model: "@smol"` and
  `thinking-level: medium` in their embedded frontmatter, so they run Luna,
  not Astra. To move them, change `modelRoles.smol` or add a
  `task.agentModelOverrides` entry for the agent name.
- The bundled `task` agent carries `model: "@task"` and
  `thinking-level: auto`. `auto` classifies each prompt and picks a level for
  the resolved model, but Astra's ladder permits only `low`.
- `task.enableEffort` is `true`, so a caller can pass `effort: lo`, `med`, or
  `hi`, which overrides `auto`.
- `task.maxEffort` is `high`, so `scout` and `sonic` run Luna `medium` by
  default and Luna `high` with `effort: hi`.
- The `code-reviewer` and `plan-reviewer` override entries remain dormant.
  omp's task tool rejects both names as unknown agents, so neither can spawn.

Fresh `omp -p` runs on 2026-09-09 verified the model ladder with
`task.maxEffort: high`. Child session logs recorded these results:

| Agent | Effort hint | Resolved model and level |
|---|---|---|
| `task` | `hi` | `gpt-6-astra:low` |
| `task` | None, complex prompt | `gpt-6-astra:low` |
| `reviewer` | `hi` | `gpt-6-astra:low` |
| `security-reviewer` | None | `gpt-6-astra:low` |
| `scout` | `hi` | `gpt-5.6-luna:high` |
| `sonic` | `hi` | `gpt-5.6-luna:high` |

The complex `task` run completed with 682 output tokens.

omp's 272k context window is the `/extended-context off` window for Astra.
`/extended-context on` uses the 922k input window, 1.05M total, which matches
AA's 1M.

## Free session launcher (`docks-kit omp`)

`docks-kit omp [--model <selector>|--pick] [args...]` starts one interactive
omp session on a single free model. All 12 model roles resolve to that model.
All 9 retry fallback chains are empty, so a retry cannot reach a paid model.
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

The choice persists per machine in `~/.docks-kit/state.json` under
`ompSession`, next to `harnesses`. It survives across sessions. It is never
committed. `--model <selector>` records one selector. `--pick` opens an
interactive picker.

The picker lists only models the live `omp models --json` catalog reports at
zero input and output cost (26 entries on 2026-09-11). This path cannot start
a paid session. The catalog can advertise a free model that the account
cannot call; omp reports that provider error unchanged.

An omp login is required. The kit owns no login flow. It surfaces omp's own
authentication error unchanged.

When the catalog renames the free variant, change only the default selector
constant. A ladder change needs no code change, because both levels come from
the catalog row of the chosen model. Refresh the recorded default and the
ladder counts in these docs in the same commit.

## Maintenance

- Refresh the snapshot from the AA release page of each family
  (`/models/releases/<slug>`), the per-level model pages, and the harness
  comparison pages under `/agents/coding-agents/comparisons/`.
- Record the index version with the numbers. AA changes index composition
  between versions, so a score from another version is not a comparison.
- Update the capture date in the same commit as any number.
- Verify changes to the Astra ladder in `SoT/.omp/models.yml` and to
  `task.maxEffort` together with a fresh `omp -p` spawn per bundled agent.
