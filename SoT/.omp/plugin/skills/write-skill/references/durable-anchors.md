# Durable docs — the kit standard for long-lived text

## Contents

- [A. Durable doc or point-in-time artifact](#a-durable-doc-or-point-in-time-artifact)
- [B. One fact, one home](#b-one-fact-one-home)
- [C. Durable facts only](#c-durable-facts-only)
- [The durable-anchor grammar](#the-durable-anchor-grammar)
- [Behavior claims — cue must EXERCISE, not check existence](#behavior-claims--cue-must-exercise-not-check-existence)
- [Stale-tolerance line](#stale-tolerance-line)
- [Self-check (inline, no tooling required)](#self-check-inline-no-tooling-required)

This file is the one home of the durable-docs rules (A, B, C). Other skills restate the
rule they need inline; they do not copy this file.

## A. Durable doc or point-in-time artifact

A durable doc is read as the current state of the repo. Nobody in particular maintains it,
and it outlives the commit it cites. A point-in-time artifact carries a date and is read
against the commit it was written at.

| Artifact | Class | Anchor form |
|---|---|---|
| Every AGENTS.md node, every SKILL.md and `references/` file, knowledge-bundle concepts, README-style docs a skill writes into a user repo | **durable** | rules B and C; bare `path:NN` forbidden unless the path is fictional (teaching example) |
| Plan issues (every section, including `## Research`), review/security/refactor findings, pipeline working notes, incident notes, release evidence, dated audit records | **point-in-time** (EXEMPT) | `file:line` REQUIRED (precision at creation is the job) |

The test: *will anyone read this after the cited code has changed?* Yes → durable.
A fenced code block that teaches a BAD example is exempt inside a durable doc.

## B. One fact, one home

1. Every fact has exactly one owning file. Other files name that file as a path in backticks
   (`scripts/AGENTS.md`) and do not restate the fact. A path to another folder is
   repo-root-relative, so an agent can open it from anywhere. A path inside the doc's own
   folder may be folder-relative (in `scripts/AGENTS.md`, `tests/idempotency.mjs`).
2. Use a plain backticked path by default. Use an `@path` import only when the target must
   always be in context: omp expands `@` imports at load time, so each import costs
   context in every session.
3. Copy a fact into a second file only when you delete it from the first.
4. A node stays actionable alone. It states the rules an agent needs to edit files in ITS
   folder; the node owns those rules. Facts owned elsewhere (commands defined in another
   folder, repo-wide policy, generated data) are pointers, not copies.
5. A pointer must resolve: resolve it against the doc's own folder first, then the repo root.
   A dead pointer is worse than a stale copy. A path that names a location in another
   project (a consumer repo, an upstream repo) is not a pointer; say whose path it is or use a URL.

```markdown
BAD  — (in api/AGENTS.md) Run lint with `pnpm lint --max-warnings 0`; the release
       script tags as vX.Y.Z and pushes both manifests.
GOOD — (in api/AGENTS.md) Lint and release commands: `AGENTS.md` (root) owns them.
```

## C. Durable facts only

NEVER write in a durable doc:

- a line number (`file.ts:42`), even if it is accurate today;
- a live version, count, size, score, or date that changes when code changes ("9 tabs",
  "floor 14" as a bare number without its source, "v2.3");
- "currently", "as of today", "now has", "recently";
- an enumeration of things that change (nodes, skills, tables), UNLESS the list is the one
  home of that fact AND a gate or check compares it with disk. A routing table that a guard
  checks is allowed; a hand copy is not.

Write instead:

- the durable identity (symbol, file name, constant, config key) + purpose +
  `(verify: <command>)` that re-derives the volatile part;
- the RULE that produces a value ("must equal the highest X.Y file under migrations/"),
  never the value;
- a stable policy threshold that is itself the rule ("a node is at most 500 lines"). It is
  durable when this doc is the home of that rule or points at the file that enforces it.

```markdown
BAD  — The selftest has 62 checks.
GOOD — The selftest prints its check count on PASS (verify: `node test/selftest.mjs | tail -1`).
BAD  — The per-file review floor is 14.
GOOD — `src/config/limits.json` — `review.per_file_floor` — the per-file review floor
       (verify: `jq .review.per_file_floor src/config/limits.json`).
BAD  — Nodes: api/, web/, infra/ (hand list, no check).
GOOD — Every folder with its own rules has an AGENTS.md
       (verify: `git ls-files '*AGENTS.md'`).
BAD  — The schema is currently at migration 0042.
GOOD — The schema version must equal the highest `NNNN_*.sql` file under `migrations/`.
```

If a fact has no re-derivation source, either it is not volatile (state it plainly) or it
must not be asserted (omit it, or mark it explicitly unverified).

## The durable-anchor grammar

```text
`<path>` — `<symbol or config key>` — <one-line purpose> (verify: `<command that re-derives it>`)
```

- **path** — file or directory; the coarsest pointer that still routes a reader.
- **symbol** — function, type, config key, CLI flag: greppable, moves far less than lines.
- **purpose** — what the code is FOR; survives renames and rewrites, guides re-search when
  the pointer dies.
- **verify** — the command that re-derives the fact from source right now.

A line anchor is one edit away from a lie: every edit above the cited line shifts it. The
grammar form still works after the file gains 50 lines, and if the key is renamed the
purpose + verify command lead to the truth.

## Behavior claims — cue must EXERCISE, not check existence

A claim about what a tool DOES ("X enforces Y", "CI validates Y", "Z is automated") is the
most dangerous volatile fact: the tool can exist, run, and pass while it does less than the
sentence says. Only an input the tool claims to handle can show that. So a behavior claim's
cue is a **should-fail probe**, and a behavior claim you cannot probe is not written:

```markdown
BAD  — Author-script references are blocked by the lint guard.
       (existence-shaped: the guard exists and passes — proves nothing about coverage)
GOOD — Author-script references are blocked by the lint guard
       (verify: add `node tools/lint.mjs` to a doc body → the guard run must FAIL naming it; revert).
BAD  — Dependency-pin updates are automated.
GOOD — Dependency pins are bumped manually when upgrading
       (verify: `ls .github/dependabot.yml renovate.json` → none exist — no automation to rely on).
```

## Stale-tolerance line

Every durable doc a skill generates (a built skill, an emitted AGENTS.md node) carries this
line once, so a missed update degrades safely instead of misleading the next agent:

```markdown
Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.
```

## Self-check (inline, no tooling required)

Before shipping a durable doc, scan it. A `path:NN` whose path exists is a live line anchor;
a fictional example path is fine. Time words flag point-in-time phrasing:

```bash
grep -nE '[A-Za-z0-9_./-]+\.[a-z]{1,5}:[0-9]+' <doc.md> | while read -r hit; do
  p=$(echo "$hit" | grep -oE '[A-Za-z0-9_./-]+\.[a-z]{1,5}:[0-9]+' | head -1 | cut -d: -f1)
  [ -e "$p" ] && echo "live line anchor (convert to durable grammar): $hit"
done
grep -niE '\b(currently|as of|now has|recently)\b' <doc.md>   # rewrite each hit (rule C)
```

Then read each number, version, and list in the doc: it needs a `verify:` cue, a rule that
produces it, an owning file it points to, or a check that compares it with disk. Leave
fictional teaching paths (`src/api/users.ts:87`) alone — they do not resolve and cannot drift.
