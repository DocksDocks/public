# Phase 3 — Skills Builder

Draft complete `SKILL.md` bodies and `references/` files for every delta the categorizer proposed, using Phase 2b's `file:line` evidence — **converted to durable anchors** in what you emit (2b notes are point-in-time evidence; the skill you write outlives them).

<constraint>
References split is mandatory. If a drafted SKILL.md body would exceed 310 lines, move the most-detailed sections into `references/<topic>.md` (30–150 lines each) and leave a 1–2 line pointer in the body. The agentskills.io specification (https://agentskills.io/specification) advises a SKILL.md body under 5000 tokens and 500 lines, with detail in reference files that load on demand. The kit chose 310 lines as a line budget that keeps a typical body inside that token budget; it is kit policy, not a documented line limit. The verifier (Phase 6) hard-fails a 310–500 line body with no `references/`.
</constraint>

<constraint>
Before documenting any library / framework / external API in a skill, fetch current docs (context7 `resolve-library-id` → `query-docs`, plus the official docs) — do not write API signatures from memory. Skills persist across sessions; a hallucinated API propagates to every future load.
</constraint>

## SKILL.md frontmatter

```yaml
---
name: <skill-name>
description: "Use when <triggers>. Covers <5+ project-specific identifiers>. Not for <near-miss work> (use <sibling-skill>)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files: ["<paths that inform this skill>"]
  updated: "<today>"
---
```

## Body structure (≤310 lines, then split)

Title → `<constraint>` block (2–4 rules) → `## When to Use` → `## Core Patterns` (tables, code, durable anchors) → `## Key Decisions` → `## Gotchas` → `## References`.

## AI-optimization rules

Critical constraints at START, gotchas at END (U-shaped attention). Tables for comparisons, bullets for sequences — no prose paragraphs. Every claim carries a durable anchor (below). Positive framing ("Use `const`, not `var`"). Code blocks from actual source. No slop ("important to note", inflated adjectives). `| Good | Bad | Why |` tables for fragile rules.

## Durable anchors (what the emitted body cites)

A generated skill outlives the commit it was written at, so bare `file:line` anchors rot on the next edit and then mislead. Emit the durable form instead:

```text
`<path>` — `<symbol or config key>` — <one-line purpose> (verify: `<command that re-derives it>`)
```

- Convert every 2b `file:line` note to this grammar; line numbers survive ONLY inside clearly-fictional teaching examples (paths that don't exist in the project).
- Volatile facts (versions, counts, sizes, thresholds, ports, flag defaults) always carry their `verify:` command — a reader re-derives before relying. Prefer the RULE that produces a value ("must equal the highest file under `migrations/`") over the value.
- No "currently", "as of today", "now has", or "recently" — state the rule, not the moment.
- No hand-maintained enumerations of things that change (lists of routes, tables, skills, nodes). Name the directory or file that owns the set plus a `verify:` command that lists it (e.g. `ls src/routes/`).
- One fact, one home: a fact owned by another file (an `AGENTS.md` node, a config file, another skill) gets a backticked repo-root-relative path, not a copy. Every pointer must resolve.
- Behavior claims ("X enforces/validates/automates Y") get a cue that EXERCISES the behavior (a should-fail probe), never an existence check — a tool can exist and pass while doing less than the sentence says. Unprobeable behavior claims are omitted.
- Include one stale-tolerance line in each generated body, verbatim: "Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting."
- Self-check before handing to Phase 6: `grep -nE '[A-Za-z0-9_./-]+\.[a-z]{1,5}:[0-9]+'` over the drafted files; any hit whose path exists in the project is a live line anchor — convert it. Then `grep -nEi '\b(currently|as of today|now has|recently)\b'` — rewrite every hit outside a BAD example.

## Frontmatter rules

Generated skills follow the agentskills.io specification, which omp loads:

| Rule | Why |
|---|---|
| Quote every `description` string | YAML treats `: ` as a mapping and `#` as a comment in plain scalars |
| Keep `description` ≤1024 chars | The agentskills.io specification caps `description` at 1024 chars; a loader that validates against the specification rejects a longer one |
| Put concrete triggers first | The body loads only after the skill triggers |
| Move enumerations to `references/` | Prevent overlong descriptions and session-listing bloat |

```yaml
# BAD — invalid YAML
description: Use when editing routes: checkout, account, webhook.

# GOOD — one YAML string, under the hard cap
description: "Use when editing checkout routes, STRIPE_WEBHOOK_SECRET handling, CartExpiredError, order state transitions, or pnpm seed:orders fixtures. Not for generic React UI work."
```

## Maintenance skill (if proposed)

Prefer the plugin skill `skill-maintenance`. Create a local `skill-maintenance` only for project-specific behavior not covered by the plugin. If proposed: `pattern: reviewer`, body ≤100 lines, quoted description ≤1024 chars. Workflow: identify modified files → cross-reference skill `source_files` → update affected skills → bump `metadata.updated` ONLY when the skill's meaning changed (normalized body or any `references/*.md` differs). Re-running on an unchanged skill MUST be a no-op. Describe checks as inline read/search/list steps — do NOT reference kit-internal validators, which don't ship to downstream projects.

## Output (write under `### Phase 3: Skills Plan`)

Write this subheading inside `## Research`. Use `####` or lower for every block inside it; never write a `##` heading (the plan helper rejects it).

Per skill, a delimited block: `#### File: <skills-dir>/<name>/SKILL.md`, then each `#### File: .../references/<topic>.md`. Under each one, put the full content in a fenced block whose fence is longer than any fence inside the content (for example four backticks), so the plan helper ignores the file's own `##` headings. `<skills-dir>` is `.agents/skills` when that directory exists, else `.claude/skills`. In the second case, recommend `agent-first-setup` in the report: it moves the `.claude/skills` folders to `.agents/skills`, where omp finds project skills.

## Gotcha

| Gotcha | Fix |
|---|---|
| Body restates what the model already knows ("TypeScript is typed…") | Cut — the body is for project-specific knowledge only |
| `name:` ≠ directory name | Rename so they match (kebab-case) — guards fail otherwise |
| Touching AGENTS.md / CLAUDE.md | Out of scope here — legacy `CLAUDE.md` content goes to `claude-md-migration`; the root `AGENTS.md` and the `.claude/` cleanup go to `agent-first-setup` |
| Unquoted description with `: ` or `#` | Quote it before the plan reaches approval — a YAML loader fails or reads a different value |
