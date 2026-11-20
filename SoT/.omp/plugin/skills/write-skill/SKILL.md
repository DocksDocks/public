---
name: write-skill
description: "Use when authoring a new skill for the docks plugin skill tree or a kit that follows docks conventions. Guides the `Use when…` description, body size and `references/` split, constraint blocks, BAD/GOOD pairs, baseline and trigger checks, and the bundled `skill-guard.mjs` scorer and validators. Not for refreshing an existing skill after source changes (use skill-maintenance) or measured benchmarks and description optimization (follow the agentskills.io guides)."
user-invocable: true
metadata:
  pattern: meta-skill
  updated: "2026-11-20"
  content_hash: "b938326f7a19cb798e6af11a831de582bbc29214d321b51e64c183c6e823a779"
---

# Write a Skill (docks conventions)

The description is the only thing your agent sees when deciding which skill to load. Get it wrong and the skill never fires. Get it right and the body content barely matters.

This skill encodes docks' specific authoring conventions — the 16-point scorer rubric in the bundled `scripts/skill-guard.mjs` (the single source the kit CI also scores with), the structural guards in `scripts/skills/guard.mjs`, the body sweet spot, the `<constraint>` block reward, the references/ extraction rule. Anthropic's `skill-creator` and Matt Pocock's former `write-a-skill` (MIT, framing inspiration) are both generic; this one is docks-shaped.

<constraint>
Description-first. The description is surfaced in the skill listing every session — it loads always, the body loads only on invocation. Spend disproportionate effort here. CSO rules: (1) starts with `Use when …` (2 pts), (2) ≤500 chars (2 pts; > 1000 = 0 pts; the guard hard-caps at 1024), (3) names the categories of user intent the skill serves and says what the skill does as well as when, with concrete nouns (commands, file types, error text) where they help, rather than abstract capability prose, (4) zero slop words (`comprehensive`, `robust`, `elegant`, `seamless` — each occurrence costs 1 pt, max −2). Do not grow a keyword list one missed query at a time: each added token fixes one query and widens the match surface for every near-miss. When a query misses, name the intent category it belongs to, then re-run the whole trigger check (see "Behavioral checks"). The description is done when the trigger check passes and `node <write-skill-dir>/scripts/skill-guard.mjs score --per-file | grep <name>` (the bundled scorer the kit CI also uses) gives its points.
</constraint>

<constraint>
Body sweet spot: 80–310 lines (the bundled `skill-guard.mjs` scorer awards 2 pts here). Under 80 lines is allowed but loses the 2 pts. Over 310 is also allowed (`skill-guard.mjs` fails past 500) but the agentskills.io specification asks for a body under 5000 tokens and 500 lines, and 5000 tokens is about 310 lines. Every line past that costs context on each activation. When the body crosses ~310 lines, move detail into `references/<topic>.md` files (30–150 lines each) and leave a one-line pointer in the body. Pattern: see `react-component-patterns/SKILL.md` and its `references/` folder.
</constraint>

<constraint>
Bookkeeping is part of the edit, not an afterthought — but let the tooling do it. After any change to a skill's meaning, run the project's content-hash backfill: it re-syncs the stored hash AND stamps `metadata.updated` in the same write, and it writes only when the hash actually differs. So a formatting-only or otherwise meaning-preserving edit leaves both fields untouched and the recorded date keeps describing the last real change. Readers use `metadata.updated` to judge staleness, so a date bumped by a formatting pass is worse than no date at all. Never hand-edit the hash: CI's idempotency gate fails on a stale one, and editing only `updated:` does not change it.
</constraint>

## The minimum viable docks skill

```yaml
---
name: <kebab-case-name>           # must match directory name
description: "Use when <specific trigger words and contexts>. <Concrete pattern keywords>. <When NOT to use — narrows the match surface>."
user-invocable: false             # true only for slash-command-style skills (e.g., zoom-out)
metadata:
  pattern: tool-wrapper           # or: micro-skill, meta-skill
  updated: "YYYY-MM-DD"           # bump ONLY on a real content change
---

# Skill Name

<short paragraph framing the problem this skill addresses>

<constraint>
<non-negotiable rule the agent must follow when this skill is active>
</constraint>

## Quick BAD/GOOD or Decision Tree
<concrete pattern matching the agent can do without reading paragraphs>

## When to Use / NOT to Use
<crisp triggers + exclusions>

## References
<links to references/ files, companion skills, official docs>
```

## Score rubric (out of 16) — internalize before authoring

| # | Bucket | Pts | What earns it |
|---|---|---|---|
| 1 | CSO description starts `Use when` | 2 | docks convention; literal prefix match |
| 2 | Description tightness | 2 | ≤500 chars = 2; ≤1000 = 1; >1000 = 0 |
| 3 | Freshness | 1 | `metadata.updated` within last 180 days |
| 4 | `<constraint>` blocks | up to 3 | 1 pt each, max 3 — promote non-negotiable rules to constraint blocks |
| 5 | BAD/GOOD examples | 2 | both `BAD` and `GOOD` (or "Wrong fix" / "Right fix") idioms present |
| 6 | Slop word check | up to 2 | `comprehensive`/`robust`/`elegant`/`seamless` each cost 1, max −2 |
| 7 | Markdown table for rules | 1 | at least one `\| … \|` table |
| 8 | Code fence with language tag | 1 | ` ```ts `, ` ```bash `, etc. — not bare ` ``` ` |
| 9 | Body 80–310 lines | 2 | sweet spot; either side loses the 2 pts |

**Per-file floor:** `scripts/config/scoring.json` (verify: `node -p "JSON.stringify(require('./scripts/config/scoring.json').skills)"`). CI fails any skill below that floor. Aim for 14+ on new skills — leaves headroom when CSO rules tighten.

## The authoring loop

0. **Record the gaps first.** Before you write anything, give 2–3 realistic prompts for the skill's job to a fresh agent that does not have the skill. Write down what it gets wrong or has to guess: missing project facts, wrong defaults, skipped steps. The skill content targets those gaps and nothing else, because content the agent already gets right costs context on every load and adds nothing. Keep the prompts and outputs: they are the "without" arm of the baseline check.
1. **Draft the description.** Write 3 candidates. Verify ≤500 chars on each (`echo -n "$desc" | wc -m` — characters, not bytes; em-dashes inflate `wc -c` 3×). Pick the one that names the intent categories most clearly and says what the skill does as well as when.
2. **Collision-check the triggers.** Write 3 realistic should-trigger prompts and 3 near-miss should-NOT-trigger prompts, then read the descriptions of the 2–3 sibling skills closest in domain: every near-miss must route cleanly to its sibling via a `Not for…` clause. The kit's `tests/skill-trigger-collision.mjs` catches gross keyword overlap mechanically (a pair sharing ≥5 positive-surface trigger tokens with no routing fails CI), but only this manual near-miss pass catches the subtle ones — this step is where collisions die. See "Near-miss negatives" below.
3. **Draft the body** in `SKILL.md`. Target 80–310 lines. Aim each section at a gap from step 0. Include at least: one `<constraint>`, one BAD/GOOD pair, one table, one fenced code block with a language tag. Pick prescriptiveness per "Degrees of freedom" below.
4. **Baseline check.** Re-run the step 0 prompts with the skill and compare (see "Behavioral checks"). A gap that stays open means the body does not reach it; fix the body, not the prompt.
5. **Trigger check.** Run the query set against the description (see "Behavioral checks").
6. **Score check.** `node <write-skill-dir>/scripts/skill-guard.mjs score --per-file | grep <name>` — the bundled scorer the kit CI also scores with (one rubric, no mirror). Validate one skill: `node …/skill-guard.mjs validate <skill-dir>`. If < 14, find the missing point in the rubric.
7. **Structural check.** Kit: `bun scripts/skills/guard.mjs` (frontmatter rules + `refs-guard.mjs`: broken `references/` links, orphan reference files, the long-reference TOC rule below). Elsewhere: `node skill-guard.mjs validate --strict` covers the portable subset. Failures are non-negotiable — fix them.
8. **Docs check.** Run the self-check in `references/durable-anchors.md` on the body and every reference. If the skill writes docs, check rows A–C of "Durable docs and agent-first output" below against the docs it emits; if it writes into a user repo, check row D too.
9. **Targeted CI while iterating.** In a multi-plugin kit, run the owning plugin's gate after each meaningful change — in this kit, `bun scripts/ci.mjs --plugin <changed-plugin>`. Do not rerun unrelated plugin gates during the edit loop.
10. **Full CI once.** Run `bun scripts/ci.mjs` at the final pre-commit/release gate, or earlier only when shared/repo-wide files changed. It must be green before commit.
11. **Stop when the behavioral checks pass.** Ship when the baseline check shows the step 0 gaps closed and the trigger check passes. The score is a minimum, not the goal: meet the per-file skills floor (`bun scripts/config/read-floor.mjs skills` in this repository), but do not add tables or constraint blocks only to gain points, because a format proxy does not tell you whether the agent behaves better.

## Behavioral checks

Two checks decide whether a skill works. Both use fresh agents with no authoring context: an omp task subagent (it gets no conversation history) or a new omp session. For measured trigger rates, repeated runs, and variance, follow the agentskills.io guides: <https://agentskills.io/skill-creation/optimizing-descriptions> and <https://agentskills.io/skill-creation/evaluating-skills>. Their eval sets use the same `query` / `should_trigger` fields as below.

**Baseline check.** Use 2–3 realistic prompts (the step 0 prompts). Run each one in a fresh agent without the skill (for a rewrite: with the old version) and in a fresh agent with the new skill. Compare the pairs against assertions you write before you read the "with" outputs. The skill passes when the "with" runs close the recorded gaps and break nothing the "without" runs got right.

**Trigger check.** Write 8–10 should-trigger queries and 8–10 near-miss should-not-trigger queries. Make them realistic and messy: file paths, typos, casual phrasing, no skill named. Near-misses share words with this skill but belong to a sibling (see "Near-miss negatives"). Hold back about a third of each set and do not tune the description against those; they decide the result.

```json
[
  { "query": "bun audit says lodash is vulnerable, can you sort it out", "should_trigger": true },
  { "query": "the lodash merge call in src/utils.ts is exploitable, patch it", "should_trigger": false }
]
```

Judge each query in its own fresh session with the full skill listing installed, and record whether the agent loads the skill (the harness shows the skill invocation or a read of its SKILL.md). A cheaper proxy: give one fresh subagent the names and descriptions of all installed skills plus one query, and ask which skill it would load, or none. Count loads per set. The check passes when every held-back near-miss routes away and the held-back should-trigger queries load the skill with at most one miss. Fix a miss at the level of intent category, then re-run the whole set, because a fix aimed at one query often breaks a near-miss.

**Assertions.** Each assertion must be checkable from the output and must cite its evidence (a quoted line, a file path, a command result). A pass needs that evidence; surface compliance, such as the right file name with empty content, fails. An assertion that a wrong output also passes is worse than none, because it reports a gap as closed. Test each assertion against the "without" output: if that output passes too, the assertion does not discriminate. Replace it or drop it. Do not force assertions onto subjective output; for that, compare the two outputs side by side.

## Fresh-instance QA (the author / fresh reviewer test)

The author of a skill (or plan) can't see its own gaps — they fill them from memory the description and body never state. Standing QA: hand the finished artifact to a **fresh reviewer** with no authoring context (in omp, a task subagent, which gets no conversation history). The fresh reviewer does exactly one thing: act on the artifact using only what it says, and every place it has to guess is a handoff defect the author could not perceive. Run it before shipping any skill, agent, or substantive plan — a fresh-context read finding no material gap is a stronger stop than the author's own re-read.

## BAD / GOOD descriptions

```yaml
# BAD — abstract capability prose, no triggers, slop words
description: A comprehensive, robust solution for working with dependencies in your project.

# GOOD — triggers + concrete keywords + "Not for" exclusion
description: "Use when running bun/pnpm/npm/yarn audit, pip-audit, cargo audit, or govulncheck; responding to a CVE/GHSA advisory; bumping framework majors (next/react/typescript/django/fastapi/tokio/axum); handling peer-dep or version-resolution conflicts after an upgrade; investigating transitive vulnerabilities; deciding auto-patch vs hold-back; setting dependency-update cadence. Not for fixing the vulnerable code path itself (use fix-workflow) or full security audits (use security)."
```

The good example fires reliably because each clause names a category of user intent (run an audit, answer an advisory, bump a major, resolve a conflict, set a cadence) and the concrete nouns only anchor those categories. The bad example matches nothing specific — the agent can't disambiguate it from any other dep-related skill. When the trigger check finds a miss, add or sharpen a category; do not append the missed query's words.

## Near-miss negatives (trigger collision)

The only valuable negative test is the near-miss: a prompt that shares keywords with this skill but belongs to a sibling. "Write a fibonacci function" tells you nothing about a PDF skill — it would never trigger anyway. Realistic near-misses are messy: file paths, typos, casual phrasing, no skill named.

| Near-miss prompt | Must route to | Via |
|---|---|---|
| "bun audit flags lodash, fix it" | dep-vuln-workflow, not fix-workflow | "Not for fixing the vulnerable code path itself" |
| "i renamed the source file, update the skill that cites it" | skill-maintenance, not write-skill | "Not for refreshing an existing skill after source changes" |
| "add tests for the existing parser" | test-coverage, not tdd-workflow | "Not for test-first development" |
| "review this diff for SQLi" | code-review, not security | "Not for full security audits" |

If a near-miss has no clean route, the new skill's `Not for…` clause (or the sibling's) is missing a case — fix the description, not the prompt. These rows are also the seed for the near-miss half of the trigger check in "Behavioral checks".

## When to add `references/`

| Trigger | Action |
|---|---|
| Body crosses ~310 lines OR you're about to add another ~50 | Pull the most-detailed section into `references/<topic>.md`. Keep a 1–2 line pointer in the body. |
| Multiple languages share the same principle but need per-language code | One body section explaining the principle, language-specific BAD/GOOD in `references/<lang>-<topic>.md`. Pattern: `solid/references/typescript-solid.md`, `…/rust-solid.md`. |
| A scenario applies but is the exception, not the rule | `references/` keeps it out of the per-session-loaded body. |

Reference file sweet spot: 30–150 lines. Past 150, split again. Any reference file over **100 lines** with 3+ section headings needs a `## Contents` TOC at the top — an agent can read only a range of a long file, and the TOC keeps the full scope visible. This is a docks rule; the agentskills.io specification asks for focused reference files (<https://agentskills.io/specification>). `refs-guard.mjs` enforces this; the heading gate auto-exempts embedded output templates whose sections live inside a verbatim code fence.

### `scripts/` and `assets/` — the other two bundles

| Bundle | Ship it when | Cost model |
|---|---|---|
| `scripts/<tool>` | Every invocation would re-derive the same helper — the smell: three test runs each wrote the same `create_docx.py` | Execution is token-free; only stdout enters context |
| `assets/<file>` | Output needs a template or binary copied, never read (HTML shells, fonts, dashboard masters) | Zero until copied |

State intent explicitly: "Run `scripts/x.py`" (execute) vs "Read `scripts/x.py`" (load as reference). Neither directory is covered by `content_hash` (it hashes SKILL.md + references/ only) — bump `metadata.updated` manually when they change. This skill eats its own cooking: `scripts/skill-guard.mjs` here is the bundled portable validator AND the single source of the scorer rubric the kit CI uses.

## Constraint block discipline

The scorer rewards up to 3 `<constraint>` blocks per skill — promote rules that meet the test below into constraints; leave softer guidance as prose.

| Promote to `<constraint>` when | Leave as prose when |
|---|---|
| Violation has shipped a real bug or wasted user time before | "Generally a good idea" |
| The model's training pulls it toward the wrong default | Aligns with default model behaviour anyway |
| It costs the user trust if the agent gets it wrong silently | Cosmetic preference |
| A concrete consequence is statable in the rule itself ("…because X breaks Y") | Vague "this is cleaner" |

A skill with 4 constraint blocks scores the same as 3. Pick the 3 most load-bearing rules; demote the rest.

## Degrees of freedom (how prescriptive to be)

Match prescriptiveness to fragility, not to how much you know about the task. Frontier models follow literal instructions but won't generalize them past their stated scope — over-prescriptive skills degrade output exactly where judgment was the right tool.

| Freedom | When | Form |
|---|---|---|
| High — goal + constraints | Many valid paths; context decides (reviews, refactors) | Prose goal, non-negotiables in `<constraint>`, no step choreography |
| Medium — preferred pattern | One good default exists, variation acceptable | Template or pseudocode with parameters, escape hatch named |
| Low — exact sequence | Fragile, one safe path (migrations, releases) | Exact commands, "do not modify", validation between steps |

Writing ALWAYS/NEVER in caps is the yellow flag: state the consequence instead ("two-phase write, because a halt mid-relocation loses content"). A rule carrying its why survives paraphrase, model upgrades, and the edge cases the caps-lock version never anticipated.

## Durable docs and agent-first output

Skill bodies and `references/` are durable docs, and so is every AGENTS.md or README-style doc a skill writes into a user repo. Rules, BAD/GOOD pairs, and the inline self-check: [`references/durable-anchors.md`](references/durable-anchors.md). A skill that emits docs states the rules it needs inline in its own body. Check each row before shipping:

| Check | Applies to | Pass when |
|---|---|---|
| A. Durable vs point-in-time | every skill that writes docs | durable outputs (AGENTS.md nodes, README-style docs, skills) follow B and C; point-in-time outputs (findings, plan evidence, audit records) carry a date and keep `file:line` |
| B. One fact, one home | every skill that writes docs | each fact has one owning file; other files name it as a backticked repo-root-relative path; `@path` import only when the target must always be in context; a fact is copied only when it is deleted from its source |
| C. Durable facts only | every skill that writes docs | no live `path:NN`, no bare version/count/size/date, no "currently"/"as of"/"recently", no hand list of changing things unless a check compares it with disk; each volatile value has `(verify: <command>)` or the rule that produces it; one stale-tolerance line per generated durable doc |
| D. Agent-first | every skill that writes or changes files in a user repo | findable (a root AGENTS.md routes to every nested node and canonical location; skills in `.agents/skills/`, with no `.claude/skills` link); fast to understand (root holds commands and repo-wide rules only, folder rules live in the folder AGENTS.md); trustworthy (C holds, behavior claims carry a probe); verifiable (the skill ends with a check an agent can run — commands, not prose); no CLAUDE.md files (one home for instructions: a CLAUDE.md is legacy context that omp ignores next to an AGENTS.md; `claude-md-migration` moves its content into AGENTS.md) |

A failed row is a defect in the skill, not in one output: fix the template or the instruction that produces the doc.

## Common authoring traps

| Trap | Fix |
|---|---|
| Description = "Skill for working with X" | Replace with triggers: "Use when running X, fixing Y, debugging Z" |
| Body restates what the agent already knows ("TypeScript is a typed superset of JavaScript…") | Cut. The body is for project-specific knowledge the agent lacks. |
| BAD/GOOD pair is two snippets of similar code with no annotation | Add the `// BAD — <one-line reason>` and `// GOOD — <one-line reason>` comments; the agent pattern-matches on the comments |
| Every paragraph wrapped in `<constraint>` | Demote to prose — past 3 constraints the scorer gives nothing, and the pattern stops signalling "non-negotiable" |
| `name:` doesn't match directory name | Guard fails. Rename directory to match (kebab-case, `[a-z0-9-]+`, ≤64 chars). |
| Forgot `metadata.updated` bump after editing | Do not bump it by hand. Run the project's content-hash backfill (see the bookkeeping constraint): it re-syncs `metadata.content_hash` and stamps `metadata.updated` in one write, and only when the hash differs. If the project has no hash tooling, do not add a hash or report missing Docks tooling. |
| Body crossed 310 → just left it there | Move detail to `references/`. Past 310 lines, post-compaction re-attachment drops content silently. |
| Used `comprehensive`/`robust`/`elegant`/`seamless` because it "reads better" | Each occurrence costs 1 pt. Rewrite or cut. |
| Mixed terminology — "field"/"box"/"element" for the same thing | Pick one term and use it throughout; the model treats synonyms as potentially distinct concepts. |
| Dated conditionals — "before Aug 2025 use the old API" | Document the current method; park legacy in a collapsed "old patterns" block. |
| Bare MCP tool names (`create_issue`) | Fully qualify as `Server:tool` (`GitHub:create_issue`) — bare names misresolve when several servers are connected. |
| Live `path:NN` line anchor in the body | It rots on the next edit above that line. Use the durable grammar (`references/durable-anchors.md`); line numbers only on fictional example paths. |

## Transforming skills (split / migrate / rewrite existing content)

A skill that MOVES, SPLITS, or REWRITES existing files can drop content with no error. Before authoring one, read [`references/data-preservation.md`](references/data-preservation.md): inventory → per-section approval table → two-phase write → read-back verification. Two non-negotiables, copied **inline** into the skill (never cross-linked): a preservation `<constraint>` near the top (the agent reads it before any step) and a `## Verification` block doing per-section presence + a net-shrink tripwire — NOT a byte-percentage floor, which is backwards for a split. `scripts/skills/transform-guard.mjs` enforces both on the curated transformer list.

## When this skill does NOT apply

- Authoring an **agent** (not a skill) — different conventions live in `scripts/agents/score.mjs` (no `model` key, "Use when …" + "Not …" clauses, anti-hallucination checklist, 60–300 body). The root `AGENTS.md` `## Authoring agents` section is the source of truth for agents.
- Modifying an existing skill — use `skill-maintenance`. Read the skill first, preserve constraint blocks, re-sync metadata with the project's content-hash backfill (never bump `metadata.updated` by hand), and re-score before commit.

## Source attribution

Framing ("the description is the only thing your agent sees") adapted from Matt Pocock's `write-a-skill` (MIT; removed upstream in June 2026 and replaced by `writing-for-agents`, <https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md>). Last version: <https://github.com/mattpocock/skills/blob/ab7196a1584ac60688aeb63cf0b56a5114c4a6f3/skills/productivity/write-a-skill/SKILL.md>. Step 0, the baseline check, the trigger check (query set with `query` / `should_trigger`, held-back queries, intent categories over keyword lists), and the stop condition are paraphrased from Anthropic's `skill-creator` (Apache-2.0; <https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md>). The assertion rules (evidence per pass, surface compliance fails, non-discriminating assertions flagged) are paraphrased from its grader prompt (Apache-2.0; <https://github.com/anthropics/skills/blob/main/skills/skill-creator/agents/grader.md>). Degrees-of-freedom and the near-miss negative idea adapted from the agentskills.io best practices (<https://agentskills.io/skill-creation/best-practices>), the agentskills.io optimizing-descriptions guide (<https://agentskills.io/skill-creation/optimizing-descriptions>), and Anthropic's `skill-creator`. Body / rubric / loop are docks-specific — `skill-creator` covers evals and benchmarking; this one covers the kit conventions neither generic skill knows. The markdown + frontmatter + progressive-disclosure shape itself is convergent prior art: Google's Open Knowledge Format (OKF v0.1, Apache-2.0 — markdown files with YAML frontmatter; <https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing>, spec in <https://github.com/GoogleCloudPlatform/knowledge-catalog>) and Karpathy's LLM-Wiki pattern (raw sources / wiki / schema layers with Ingest–Query–Lint ops; <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>) standardize the same idea independently.

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
