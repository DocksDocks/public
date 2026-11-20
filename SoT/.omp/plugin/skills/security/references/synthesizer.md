# Phase 3 — Synthesis

Produce the final report by challenging, verifying, and consolidating every finding from Phases 2a–2c. This pass is what keeps the false-positive rate low.

<constraint>
Per-finding reproduction is mandatory. For each surviving finding: (1) re-search for the vulnerability *pattern itself* (not just the file path) and confirm it still appears at the cited `file:line`; (2) read 5+ lines of context and confirm the data-flow narrative holds; (3) for Critical/High, trace taint upward to a real input source (route handler / form / URL param / external API). DROP anything you cannot reproduce or whose taint path you cannot trace — log it under `#### Dropped (failed reproduction)` inside this phase's subheading, with a reason.
</constraint>

<constraint>
Verify any remediation library API (helmet, cors, csrf-csrf, bcrypt, argon2, passport, …) against current docs before recommending it. A fix with a wrong API is worse than no fix.
</constraint>

## Passes (in order)

1. **Challenge** — is each finding actually exploitable here? Are there mitigations (middleware, validation, framework defaults) the scanners missed? Is the severity right? Reject findings without `file:line` evidence.
2. **Correctness** — read the file at the cited line; reject if the code doesn't exist or doesn't match.
3. **Completeness** — walk OWASP Top 10; mark each "issues found" / "reviewed — clean" / "not examined". Flag gaps explicitly.
4. **Priority** — for Critical/High, confirm input reachability; downgrade where mitigations exist. Order by Exploitability > Impact > Ease of fix.
5. **Consolidate** — accept survivors, group related issues, dedupe across the three phase-2 lenses.

## Report (write under `## Research` → `### Phase 3: Security Audit Report`)

Write each report part as a `####` subheading inside `### Phase 3: Security Audit Report` — never as a `##` heading, because the plan helper rejects any `##` heading outside its fixed sections: `#### Executive Summary` (counts + most-affected areas + action-required) · `#### Critical` · `#### High` · `#### Medium` · `#### Low/Informational` · `#### Logic Flaws & Edge Cases` · `#### OWASP Top 10 Coverage` (per-category verdict table A01–A10) · `#### Recommendations` (immediate / short-term / long-term) · `#### Files Requiring Review` · `#### Dropped (failed reproduction)`.

Per finding: Title · Location `file:line` · CWE · Description · Exploitation (concrete) · Remediation (with verified code) · References.

| | Example |
|---|---|
| BAD | "The application has some security issues with user input handling." |
| GOOD | "`src/api/users.ts:87` — CWE-89 SQL Injection: `db.query(\`SELECT * FROM users WHERE id = ${req.params.id}\`)` — inject via URL param. Fix: `db.query('SELECT ... WHERE id = $1', [req.params.id])`." |

## Output discipline

Report the false-positive rate (dropped ÷ total phase-2 findings). Every Critical/High has verified exploitability evidence. Zero findings without `file:line` + a concrete attack scenario.

## Gotcha

| Gotcha | Fix |
|---|---|
| Trusting a scanner finding because it "looks right" | Re-grep the pattern and read context; the scanners optimize for recall, synthesis optimizes for precision |
