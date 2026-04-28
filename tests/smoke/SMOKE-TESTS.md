# Kit Smoke Tests — Canonical Battery

Manual battery of agent invocations against `tests/fixtures/nextjs-16-min/` to validate kit behavior. **Run after non-trivial kit changes** (new constraints, frontmatter additions, scoring-rubric edits, agent restructures). Each test is a single agent invocation with a fixed prompt; pass/fail is observable from the agent's reported output.

This is NOT automated CI — it costs API tokens and runs on real models. The point is: when a kit change feels uncertain, you can validate it on a known surface in ~5 minutes per test instead of waiting to discover the regression on real work.

## Setup

The fixture lives in version control at `tests/fixtures/nextjs-16-min/`. Copy it to a temp directory before testing — agents will mutate the working tree (e.g., write plan files), and you don't want those mutations in the kit repo.

```bash
# From kit root:
cp -r tests/fixtures/nextjs-16-min /tmp/smoke-test-kit
cd /tmp/smoke-test-kit && git init -q
```

`git init` is optional but recommended — agents that run `git log` / `git status` produce more representative output against a real repo.

After tests complete:

```bash
rm -rf /tmp/smoke-test-kit
```

Do not commit `/tmp/smoke-test-kit` artifacts back into the kit. Record findings inline in this file (under `## Run log` at the bottom) or as a roadmap entry.

## Tests

### T1 — Research-gate works (`refactor-duplication-scanner` + `proxy.ts`)

**Why this matters:** Without research-gate, the scanner suggests renaming Next 16's `proxy.ts` to legacy `middleware.ts`, citing training-data drift. This was the original motivating bug (see `docs/roadmap/ongoing/subagent-pipeline-improvements.md` Tier 1 context).

**Agent:** `refactor-duplication-scanner`

**Prompt (copy-paste verbatim into the kit's Claude Code session):**

```text
@agent-refactor-duplication-scanner

SMOKE TEST — Run /refactor Phase 2b against /tmp/smoke-test-kit/.

Plan file path: /tmp/smoke-test-kit/SMOKE-PLAN-dup.md (create it; write findings under `## Phase 2b: Duplication Findings`).

Target scope: /tmp/smoke-test-kit/ — a 4-file Next.js 16 project. Files:
- /tmp/smoke-test-kit/package.json (Next 16, React 19)
- /tmp/smoke-test-kit/app/page.tsx (Server Component with deliberate unused variable)
- /tmp/smoke-test-kit/lib/user.ts (fetchUser + fetchAdmin — deliberate duplication; unusedExport)
- /tmp/smoke-test-kit/proxy.ts (Next.js 16 middleware — uses proxy() function, runtime: 'nodejs')

This is a fixture, NOT the kit. Ignore /home/vagrant/projects/public/ entirely.

Do your normal Phase 2b work (duplication, extraction, modernization).

CRITICAL: proxy.ts uses Next.js 16's CURRENT convention. Older training data may suggest renaming to middleware.ts. Your research-gate constraint requires verifying Next.js conventions via context7 / WebFetch BEFORE recommending any framework migration.

Report: (1) plan file path, (2) whether you flagged proxy.ts and citation if so, (3) confirmation you used context7 or WebFetch for any framework claim.
```

**Pass criteria:**

- [ ] Agent does NOT suggest renaming `proxy.ts` → `middleware.ts`
- [ ] Agent cites a concrete current source (e.g., `vercel/next.js` v16.0.1 `packages/next/src/lib/constants.ts` defining `PROXY_FILENAME = 'proxy'`)
- [ ] Agent flags the `fetchUser`/`fetchAdmin` duplication as an extraction candidate

**Common failure modes:**

- *Suggests `middleware.ts` rename without citation* → research-gate constraint not loaded; check `tools:` includes `WebFetch, WebSearch` and constraint block exists in the agent body
- *Cites context7 but no concrete API verification* → constraint wording too soft; tighten "MUST cite" language

---

### T2 — Enumerate-don't-diagnose works (`refactor-explorer`)

**Why this matters:** Explorers are mapping phases — they should report facts, not judgments. If they drift toward "this is wrong / should refactor", they encroach on downstream analyzer/scanner phases and dilute the Builder-Verifier separation.

**Agent:** `refactor-explorer`

**Prompt:**

```text
@agent-refactor-explorer

SMOKE TEST — Run /refactor Phase 1 against /tmp/smoke-test-kit/.

Plan file path: /tmp/smoke-test-kit/SMOKE-PLAN-explorer.md (create it; write findings under `## Phase 1: Exploration Results`).

Target scope: /tmp/smoke-test-kit/ — a 4-file Next.js 16 project. This is a fixture, NOT the kit; ignore /home/vagrant/projects/public/ entirely.

Do your normal Phase 1 work — map stack, structure, available analysis tooling (note knip in devDependencies), test infrastructure, abstractions, DI patterns. Use Bash with absolute paths.

Caveats: this is a tiny synthetic project; abstractions and DI patterns may not apply. Note their absence as facts. Honor your enumerate-don't-diagnose constraint.

Report: (1) plan file path, (2) confirmation you stayed enumerate-only — list any phrasing in your output that approached judgment ("this should…" / "this is wrong") so we can audit.
```

**Pass criteria:**

- [ ] Output is a flat inventory: stack/versions, file paths, abstractions list, DI patterns
- [ ] No phrasing like "this should be refactored", "this is wrong", "this needs fixing"
- [ ] Deliberate dead-code markers (the `unused = 42` comment, `unusedExport`) are listed as facts with `file:line` — not flagged as findings
- [ ] Agent's self-audit reports zero judgment phrases

**Common failure modes:**

- *Agent flags traps as "issues to fix"* → constraint not loaded; verify the `<constraint>` block is present in body
- *Agent self-audit claims compliance but output contains "should refactor"* → constraint wording too vague; tighten

---

### T3 — Phase Output Integrity catches missing output

**Why this matters:** Orchestrators write phase output to a plan file and immediately launch the next agent. If a Builder fails silently (failed Write, malformed output), the next phase reads stale data. The Phase Output Integrity constraint should abort the pipeline before propagation.

**Setup (this test simulates a silent failure):**

```bash
# Create plan file with all expected sections EXCEPT Phase 1
cat > /tmp/smoke-test-kit/SMOKE-PLAN-integrity.md <<'EOF'
# Smoke Test Plan

## Environment
(stub)

## Phase 2: Analyzer Findings
(stub)
EOF
```

Note: `## Phase 1: Exploration Results` is deliberately missing.

**Trigger:** Any orchestrator that runs Phase 1 → Phase 2 should `Grep('^## Phase 1:', /tmp/smoke-test-kit/SMOKE-PLAN-integrity.md)`, find zero matches, and abort with the standard error: `"Phase 1 (<agent>) produced no plan-file output. Aborting pipeline."`

This test is **manual / observational** — to fully validate, run an actual `/refactor` command against the fixture (with the corrupted plan file pre-staged) and observe whether the orchestrator aborts or proceeds. The constraint is in all 7 commands as of `58715cd`.

**Pass criteria:**

- [ ] Orchestrator aborts at the Phase 1 → Phase 2 transition with a clear error
- [ ] Orchestrator does NOT launch Phase 2

**Common failure modes:**

- *Orchestrator proceeds anyway* → constraint not enforced; check the command file for the Phase Output Integrity `<constraint>` block
- *Orchestrator aborts but with a confusing error* → tighten the abort-message wording in the constraint

---

### T4 — Skill auto-trigger sanity check (post `3084ce9` description rewrites)

**Why this matters:** The skill description rewrites in `3084ce9` are aimed at improving auto-trigger reliability. Without empirical sampling we have no signal that the rewrites actually helped.

**Setup:** Open Claude Code in `/tmp/smoke-test-kit/`. Type the prompt below. Observe whether the matcher fires the listed skill.

**Test prompts (one per skill — record OBSERVED behavior in the run log):**

| Prompt | Expected skill | Should it fire? |
|---|---|---|
| "this dropdown anchored to the user button feels detached, fix it" | `make-interfaces-feel-better` | Yes — popover-anchored-to-trigger + "feels detached" both in description |
| "i don't like this useEffect, refactor to drop it" | `react-effect-policy` | Yes — "useEffect" + "refactor" maps cleanly |
| "split this 400-line component into smaller pieces" | `react-solid` | Yes — "300+ LOC component" trigger |
| "add a route handler for /api/users" | `nextjs-conventions` | Yes — "route handler" trigger |
| "i don't like useEffects" *(standalone, no task)* | `react-effect-policy` | **Borderline** — preference statement, no task verb. Usually weak trigger. |

**Pass criteria:**

- [ ] First 4 prompts trigger the expected skill (observable via the skill's content surfacing in Claude's response, or via Claude explicitly invoking the skill)
- [ ] 5th prompt's behavior is documented (whether it triggered or not — both outcomes are informative)

**Common failure modes:**

- *Skill fires but content is wrong* → skill body content drift; re-audit the body against current framework versions
- *Skill doesn't fire on (1)–(4)* → description still too abstract; rewrite to lead with even more concrete trigger
- *Skill fires on prompts that should NOT trigger it* → false-positive risk; description too broad

---

## Run log

Append findings here. Each run: ISO date, kit commit SHA at run time, per-test pass/fail, notable observations.

---

### 2026-04-27 (commit `58715cd`, pre-fixture-extraction)

Ad-hoc smoke test against `/tmp/smoke-test-kit/` (since deleted). Findings:

- **T1 PASS** — `refactor-duplication-scanner` correctly held off on `proxy.ts`, cited `vercel/next.js` v16.0.1 `packages/next/src/lib/constants.ts` `PROXY_FILENAME = 'proxy'` via WebFetch. Research-gate verified working.
- **T2 PASS** — `refactor-explorer` self-reported "no judgments, no 'should', no recommendations". Output was flat enumeration. Enumerate-don't-diagnose verified.
- **T-memory FAIL** — `refactor-explorer` did NOT bootstrap `MEMORY.md` despite `memory: project` frontmatter. Looked at `/tmp/.../MEMORY.md` instead of `.claude/agent-memory/refactor-explorer/MEMORY.md`. Hallucinated about its own definition. Diagnosis led to revert in `53eb8d2`.

Outcome: research-gate + enumerate-don't-diagnose validated. Memory feature reverted.
