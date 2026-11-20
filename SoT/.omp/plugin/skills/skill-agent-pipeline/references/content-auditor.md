# Phase 2c — Content-Accuracy Audit

Verify every checkable claim in each EXISTING skill and agent against the source **as it is now** — file:line refs, quoted snippets, and named identifiers. This is the phase that gives the pipeline its purpose: it is the only check that catches drift baked in *before* the recorded baseline. Distinct from Phase 2b (which extracts *new* patterns for the builder) — 2c looks *backward* at what the artifacts already assert.

<constraint>
Vertical accuracy, not horizontal change. `metadata.updated`, `content_hash`, and git history prove only that text CHANGED — never that it MATCHES source. Ignore all three here. Open and read the cited source for EVERY claim: a skill "updated today" can document an API that never existed.
</constraint>

<constraint>
No artifact may be reported accurate without stating how many claims were opened and verified. A `CLEAN` verdict with "0 claims checked" is a fail, not a pass — that spot-check false-confidence is exactly what this phase exists to kill.
</constraint>

<constraint>
Per-finding reproduction is mandatory. Before a drift finding lands, re-open the cited source and confirm the mismatch at the current `file:line`. DROP anything you cannot reproduce under a `#### Dropped (failed reproduction)` block inside the Phase 2c subheading, with a reason.
</constraint>

## Contents

- [What counts as a checkable claim](#what-counts-as-a-checkable-claim)
- [Drift taxonomy (one verdict per claim)](#drift-taxonomy-one-verdict-per-claim)
- [Procedure — per existing skill](#procedure--per-existing-skill-skillmd--every-referencesmd)
- [Agents (existing) — same loop, lighter](#agents-existing--same-loop-lighter)
- [Prompt-style sub-check](#prompt-style-sub-check-every-existing-skill-and-agent-body)
- [2a reconciliation (feedback to the delta)](#2a-reconciliation-feedback-to-the-delta)
- [Output](#output-write-under--phase-2c-content-accuracy-audit)
- [Gotcha](#gotcha)
- [Sources](#sources)

## What counts as a checkable claim

| Claim type | Example | Verify by |
|---|---|---|
| file:line / path ref | `src/db.ts:42`, `routes/checkout.ts` | read the line/file; confirm it says what the artifact asserts — not merely that it resolves |
| code snippet from source | a fenced block attributed to a file | grep the snippet; confirm it still appears (reformat OK, logic drift NOT) |
| named identifier | function / class / method / env var / route / config key / CLI command | grep the symbol; confirm it is DEFINED, not just mentioned |
| behavior claim | "guard X enforces Y", "CI validates Z", "W updates automatically" | EXERCISE it — feed the tool an input it claims to reject/handle and confirm it does (should-fail probe); a green existence-run proves nothing about coverage |

Soft prose with no source anchor — heuristics, style advice ("prefer early returns"), rationale — is **not** a checkable claim. Mark it `unverifiable`; never bucket it as drift.

## Drift taxonomy (one verdict per claim)

| Verdict | Meaning |
|---|---|
| `confirmed` | source matches the claim |
| `broken-ref` | path / file / line no longer resolves |
| `stale-snippet` | snippet exists in source but the text has drifted |
| `fictional-api` | identifier asserted to exist is NOT defined anywhere (e.g. `getEntry()`, `ApiClient.processPayment`) |
| `drifted-description` | identifier exists but is shaped / behaves differently than described |
| `line-anchor` | a live `path:NN` in a long-lived body (the path resolves in the project) — even if currently accurate, it rots on the next edit; fix = CONVERT to a durable anchor (`path` — `symbol` — purpose — `verify:` command), not just re-point the number. Fictional example paths are exempt. |
| `unverifiable` | soft/heuristic claim, no source anchor — not counted as drift |

## Procedure — per existing skill (`SKILL.md` + every `references/*.md`)

1. Enumerate EVERY checkable claim (the three types above). **Count them.**
2. For each, run its verification and assign a verdict. Audit **full** — every ref and every snippet, not a sample.
3. Reproduce each drift before recording it; drop unreproducible ones.
4. Derive `cited_source_files` = the set of source files actually opened. This is a *floor* (what the skill currently cites), not a complete set — a coverage gap is Phase 2a's job. It seeds the next run's git-delta pre-filter and Phase 3 frontmatter.
5. Roll per-claim verdicts into the artifact verdict (deterministic, so two runs agree):
   - `CLEAN` — zero drift (broken + stale + fictional + drifted = 0).
   - `REWRITE` — **any** `fictional-api`, OR drift ≥ 30% of claims checked.
   - `REFRESH` — otherwise, ≥1 drift.

Run this loop sequentially, in this context, one artifact at a time. This is the most expensive phase by design — that cost is the point; it is the only one that catches pre-baseline drift, so never substitute a sample to make it cheaper.

## Agents (existing) — same loop, lighter

Run the identical enumerate → verify → taxonomy over each on-disk agent body (`.omp/agents/*.md`). A legacy `.claude/agents/*.md` is not a live omp agent: Phase 1 routes it to `agent-first-setup` (`convert-agent`), so do not audit it here. A non-`CLEAN` agent escalates to **regenerate** in Phase 5 (agents are not part of the Phase 2a skills delta).

## Prompt-style sub-check (every existing skill and agent body)

Accuracy asks "does the text match the source?". This sub-check asks a second question: "does the text still help the model, or is it cruft from an older model or one bad session?". Run it in the same pass as the accuracy loop, over the same files. Its findings do not change the accuracy verdict above, because a skill can be accurate and still badly worded.

Flag these patterns:

| Pattern | Signal | Proposed rewrite |
|---|---|---|
| Pressure language with no reason | caps `MUST` / `NEVER` / `ALWAYS` / `CRITICAL` / `IMPORTANT`, `!!`, or several "critical" rules in one section, with no "because" near them | State the rule once, in normal case, with its reason. Current models follow instructions literally, so shouting makes them over-apply the rule. |
| History narrative | past-tense stories, incident IDs, PR or issue numbers, plan names, pinned model names, "this caught X on plan Y" | State the current rule and drop the story. The rule gets its authority from the behavior it asks for, not from the incident. |
| Enumerated trigger list in a description | a `description` that lists near-synonym queries or tools one by one, and that only grows in git history | Name the categories of intent. Keep concrete nouns (commands, file types) that route the skill. Check the result with a trigger check (see `write-skill`), not by adding tokens. |
| Rule from one incident | a narrow special case that only one session needed | Find the provenance: `git log -L '/<rule text>/,+1:<file>'` or `git blame <file>` shows the commit that added the line. If the commit fixed one session's stumble, propose to generalize the rule into a principle or remove it. |
| Volatile specifics | versions, counts, sizes, model names, or flags with no `verify:` command | Convert to the durable form that `references/skills-builder.md` § Durable anchors owns. Do not duplicate `line-anchor` findings from the taxonomy above. |

Git history is allowed here only to find where a rule came from. It is still not evidence of accuracy (see the first constraint).

**Keep list.** A grep hit is not a finding when the text is one of these:

1. **Context is not cruft.** Facts only the author knows (audience, environment, quality bar, tool contracts, and the reasons for constraints) stay.
2. **Length is not cruft.** Never propose a removal only because a section is long. The harm comes from specific outdated instructions.
3. **Fragile operations keep exact scripts.** Where only one sequence is safe (destructive commands, auth, release, migrations), exact low-freedom text is correct.
4. **Blocking approval gates stay.** A gate that stops all writes until the user answers is load-bearing. Do not soften it. The omp `ask` tool is the gate; when `ask` is not available (a headless fork gets an error from it), "print the question as your final message and end the turn" is the fallback. Flag the defect: a plain-text question ("Approve? yes/no") with no block, where the agent can keep writing.
5. **Calibrated urgency in trigger text can stay.** A description may be firm about when to load the skill, because skills tend to under-trigger. Flag shouting in bodies, not routing text.

**Verdict shape.** Each finding is a proposal, not an edit. Record the file, the quoted text, the pattern, the provenance (commit or "unknown"), and a proposed rewrite. Prefer a rewrite over a bare removal when the rule still has a purpose. A removal is a hypothesis: before it lands, run a baseline check (see `write-skill`) on the old and the new text. If the old text gives better results, keep it or restore it in its simplest form.

Output, under the `### Phase 2c` subheading after the accuracy table:

| Artifact | Pattern | Evidence (quoted) | Provenance | Proposed rewrite |
|---|---|---|---|---|

Write "no prompt-style findings" when the table is empty. A clean result changes nothing.

## 2a reconciliation (feedback to the delta)

After this phase, return to the `### Phase 2a` block and amend each non-`CLEAN` **skill** action inline: append `→ escalated by 2c: REFRESH|REWRITE (<top finding>)`. For a skill with prompt-style findings, append `→ style: <n> findings` so Phase 3 applies the proposed rewrites. Route non-`CLEAN` **agents** to the Phase 5 regenerate list. The gate then reads one reconciled delta, not two conflicting ones.

## Output (write under `### Phase 2c: Content-Accuracy Audit`)

Write this subheading inside `## Research`. Use `####` or lower for every block inside it; never write a `##` heading (the plan helper rejects it).

One row per skill and per agent:

| Artifact | claims checked | confirmed | broken-ref | stale-snippet | fictional-api | drifted-desc | verdict |
|---|---|---|---|---|---|---|---|

Then a roll-up line — total claims checked / total drift / skills CLEAN·REFRESH·REWRITE / agents CLEAN·REGEN — and a `#### Dropped (failed reproduction)` block. Every artifact gets a row even when CLEAN (with its non-zero claims-checked count); if the whole tree is clean, still write the table — never "no changes" without the counts.

## Gotcha

| Gotcha | Fix |
|---|---|
| Reporting a skill CLEAN after reading 3 of 40 refs | State claims-checked; CLEAN requires every checkable claim opened |
| Treating `metadata.updated`="today" or a matching `content_hash` as accuracy | They prove the text changed, not that it matches source — re-verify regardless |
| Bucketing a heuristic ("prefer early return") as `drifted-description` | Mark it `unverifiable` — only source-anchored assertions get a drift verdict |
| Auditing a legacy `.claude/agents/*.md` as a live agent | omp does not load it; Phase 1 routes it to `agent-first-setup` (`convert-agent`); audit `.omp/agents/*.md` only |
| Reading git history to judge staleness | Pre-baseline drift predates every diff — judge against current source only |
| Using `git blame` output as proof that a rule is accurate | Git history shows where a rule came from (prompt-style provenance), never whether it matches source |
| Deleting every caps `NEVER` in a sweep | Keep-list items stay; each finding needs a pattern, a reason, and a proposed rewrite, and a removal needs a baseline check |

## Sources

The prompt-style sub-check adapts ideas from the `prompt-audit` guide in the Anthropic `claude-api` skill (Apache-2.0), paraphrased and narrowed to skill files: https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-audit.md
