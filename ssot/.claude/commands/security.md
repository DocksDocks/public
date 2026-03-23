# Security Audit

Security and logic analysis across the entire codebase using parallel specialized scanners with a final synthesis pass.

> **Model Tiering:** Subagents default to `sonnet` (via CLAUDE_CODE_SUBAGENT_MODEL).
> Only set `model: "opus"` for quality-critical agents (analyzers, planners, builders, generators).
> Explorers, scanners, verifiers, and synthesizers use the default. Do NOT use haiku.

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output and IMMEDIATELY launch the next Task agent(s) in the same turn. Do not end your turn between phases.

The ONLY time you stop is after the final Synthesizer phase produces its report.

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Scope

This command analyzes the **entire codebase** for:
- Security vulnerabilities (OWASP Top 10 and beyond)
- Logic flaws and edge cases
- Authentication/authorization weaknesses
- Data handling issues
- Cryptographic misuse
- Race conditions and concurrency bugs

---

## Phase 1: Discovery

```xml
<task>
Launch a Task agent as the CODEBASE DISCOVERER:

**Objective:** Map the entire codebase to identify all security-relevant areas, entry points, and attack surface.

**Context:**
First, run `date "+%Y-%m-%d"` to confirm current date.

Map the entire codebase to identify security-relevant areas:

1. **Project Stack**: Identify languages, frameworks, dependencies
   - Check package.json, requirements.txt, go.mod, Cargo.toml, etc.
   - Note framework versions (Express, Django, Rails, etc.)
   - If `.claude/skills/` exists, read relevant project skills for project architecture

2. **Security-Critical Areas**: Locate and list:
   - Authentication/login handlers
   - Authorization/permission checks
   - API endpoints and route definitions
   - Database queries and ORM usage
   - File upload/download handlers
   - User input processing
   - Session management
   - Cryptographic operations
   - External API integrations
   - Configuration files with secrets
   - Environment variable usage

3. **Entry Points**: Map all ways data enters the system:
   - HTTP routes
   - WebSocket handlers
   - CLI arguments
   - File imports
   - Message queue consumers

Output a structured map of security-relevant files and their purposes.

**Output Format:**
Structured map of security-relevant files and their purposes, organized by category.

**Constraints:**
- Read-only exploration, no modifications
- Focus on completeness — missing an entry point means missing a vulnerability

**Success Criteria:**
All entry points (HTTP routes, WebSocket handlers, CLI args, message consumers) identified with file paths. Project stack fully mapped.
</task>
```

## Phase 2: Parallel Analysis

<constraint>
Launch ALL THREE agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Each agent runs independently and their results will be combined in Phase 3.

### Vulnerability Scanner

```xml
<task>
Launch a Task agent with model="opus" as the VULNERABILITY SCANNER:

**Objective:** Systematically scan the entire codebase for exploitable security vulnerabilities with concrete evidence.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output for security-relevant file map

Systematically scan the entire codebase for security vulnerabilities:

<constraint>
- Every finding MUST include file:line and a concrete exploitation scenario
- Do NOT report theoretical vulnerabilities without evidence in actual code
- Severity must reflect actual exploitability, not theoretical worst-case
</constraint>

**Injection Vulnerabilities**
- SQL Injection: Raw queries, string concatenation, missing parameterization
- NoSQL Injection: Unvalidated operators in MongoDB/similar
- Command Injection: Shell commands with user input, exec/spawn misuse
- XSS: Unescaped output, innerHTML, dangerouslySetInnerHTML, template injection
- LDAP Injection: Unvalidated LDAP queries
- XML/XXE: External entity processing, insecure XML parsers
- Path Traversal: File operations with user-controlled paths

**Authentication Flaws**
- Weak password policies or storage (plaintext, weak hashing)
- Missing brute-force protection
- Insecure session management
- JWT vulnerabilities (none algorithm, weak secrets, no expiry)
- OAuth/OIDC misconfigurations
- Missing MFA where appropriate

**Authorization Flaws**
- Missing permission checks on endpoints
- IDOR (Insecure Direct Object References)
- Privilege escalation paths
- Role/permission bypass opportunities
- Horizontal access control failures

**Data Exposure**
- Sensitive data in logs
- Secrets in source code
- Verbose error messages
- Missing encryption for sensitive data
- Insecure data transmission

**Security Misconfiguration**
- Debug mode in production configs
- Default credentials
- Unnecessary features enabled
- Missing security headers
- CORS misconfigurations
- Insecure cookie settings

**Cryptographic Issues**
- Weak algorithms (MD5, SHA1 for security, DES, RC4)
- Hardcoded keys/IVs
- Insufficient key lengths
- Missing salt in hashing
- Predictable random number generation

**Dependency Vulnerabilities**
- Check for known vulnerable packages
- Outdated dependencies with security patches

For each finding, provide:
1. File path and line number
2. Vulnerability type and CWE ID if applicable
3. Severity: Critical/High/Medium/Low
4. Proof of concept or attack scenario
5. Recommended fix

Output as categorized list by severity.

**Success Criteria:**
Every finding includes file:line and a concrete exploitation scenario. Zero theoretical-only findings without evidence in actual code.
</task>
```

### Logic Analyzer

```xml
<task>
Launch a Task agent with model="opus" as the LOGIC ANALYZER:

**Objective:** Analyze the entire codebase for logic flaws, edge cases, and trust boundary violations.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output for codebase map

Analyze the entire codebase for logic flaws and edge cases:

**Business Logic Flaws**
- Price/quantity manipulation opportunities
- Race conditions in transactions
- Order of operations issues
- State machine violations
- Workflow bypass possibilities

**Input Validation**
- Missing validation on critical inputs
- Inconsistent validation across layers
- Type confusion possibilities
- Integer overflow/underflow
- Array/buffer bounds issues

**Error Handling**
- Uncaught exceptions that leak info
- Error conditions that skip security checks
- Fail-open vs fail-closed analysis
- Missing null/undefined checks

**Concurrency Issues**
- Race conditions in shared state
- TOCTOU (Time-of-check to time-of-use)
- Deadlock possibilities
- Missing locks on critical sections
- Async/await pitfalls

**Edge Cases**
- Empty input handling
- Maximum/minimum value handling
- Unicode/encoding edge cases
- Timezone and date edge cases
- Floating point precision issues

**Trust Boundaries**
- Client-side trust issues (trusting client data)
- Inter-service trust assumptions
- Third-party data validation

For each finding, provide:
1. File path and line number(s)
2. Logic flaw description
3. Severity and exploitability
4. Attack scenario or edge case trigger
5. Recommended fix

Output as categorized list.

**Success Criteria:**
Every finding includes file:line location and a concrete trigger scenario. Logic flaws verified by reading surrounding code context.
</task>
```

### Adversarial Hunter

```xml
<task>
Launch a Task agent with model="opus" as the ADVERSARIAL HUNTER:

**Objective:** Think like an attacker and hunt for vulnerabilities that systematic scanning might miss, including chained attacks.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output for entry points and attack surface

You are an adversarial hunter. Think like an attacker and hunt for vulnerabilities that a systematic scan might miss.

**Hunt for Missed Issues**

1. **Authentication Bypass**: Alternative paths to authenticated resources
2. **Hidden Endpoints**: Debug routes, admin panels, API docs
3. **Chained Attacks**: Low-severity issues that combine into high-severity
4. **Timing Attacks**: Information leakage through response times
5. **Cache Poisoning**: Cache key manipulation
6. **Deserialization**: Unsafe object deserialization
7. **SSRF**: Server-side request forgery opportunities
8. **Mass Assignment**: Unprotected object property assignment
9. **Prototype Pollution**: JavaScript prototype chain attacks
10. **Subdomain Takeover**: Dangling DNS/cloud resources

**Specific Attack Scenarios**
For the top 5 most critical findings, write detailed attack scenarios:
- Prerequisites
- Step-by-step exploitation
- Expected impact
- Detection difficulty

Output:
**Additional Vulnerabilities Found**
[New findings with full details]

**Top 5 Attack Scenarios**
[Detailed exploitation paths]

**Success Criteria:**
Top 5 attack scenarios include step-by-step exploitation paths with file:line references. At least 2 chained-attack scenarios identified.
</task>
```

<constraint>
After Phase 2 completes (all 3 parallel agents return), immediately launch Phase 3 (Synthesizer). Do NOT stop to summarize between phases.
</constraint>

## Phase 3: Synthesis & Challenge

### Synthesizer

```xml
<task>
Launch a Task agent as the SYNTHESIZER:

**Objective:** Produce the final security report by challenging, verifying, and consolidating all findings from Phase 2.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use findings from all 3 Phase 2 agents

Produce the FINAL SECURITY REPORT from all previous analysis.

<constraint>
- Challenge EVERY finding — reject anything without concrete file:line evidence
- Adjust severity based on actual mitigating factors in the codebase
- Do NOT inflate severity counts for a more dramatic report
</constraint>

**Challenge All Findings**
For each vulnerability/logic flaw reported by the analysis agents:
1. Is it actually exploitable in this context?
2. Are there mitigating factors not considered?
3. Is the severity rating accurate?
4. Could the suggested fix introduce new issues?

**Consolidation Rules**
1. Accept findings that survive your challenge review
2. Reject false positives with clear reasoning
3. Adjust severity based on exploitability and impact
4. Group related issues together
5. Prioritize by: Exploitability > Impact > Ease of Fix

**Execute three verification passes in order:**

1. **Correctness Pass:** For each finding, read the actual file at the stated line. REJECT if code doesn't exist or doesn't match.

2. **Completeness Pass:** Check all OWASP Top 10 categories were examined. For each, mark "reviewed — clean" or "not examined." Flag gaps.

3. **Priority Pass:** For each Critical/High finding, verify exploitability:
   - Is user input actually reachable at this code path?
   - Are there existing mitigations (middleware, validation) the scanners missed?
   - Downgrade severity if mitigations exist.

**Output Format**

# Security Audit Report

## Executive Summary
- Total vulnerabilities: X
- Critical: X | High: X | Medium: X | Low: X
- Most affected areas: [list]
- Immediate action required: [yes/no]

## Critical Vulnerabilities (Immediate Action)
For each:
- **Title**: Brief description
- **Location**: file:line
- **CWE**: CWE-XXX (if applicable)
- **Description**: What and why it's dangerous
- **Exploitation**: How it can be attacked
- **Remediation**: Specific fix with code example
- **References**: Links to relevant documentation

- BAD: "The application has some security issues with user input handling"
- GOOD: "src/api/users.ts:87 — CWE-89 SQL Injection: `db.query(\`SELECT * FROM users WHERE id = ${req.params.id}\`)` — attacker can inject via URL param. Fix: `db.query('SELECT * FROM users WHERE id = $1', [req.params.id])`"

## High Severity Vulnerabilities
[Same format as critical]

## Medium Severity Vulnerabilities
[Same format]

## Low Severity / Informational
[Same format]

## Logic Flaws & Edge Cases
[Separate section for non-security logic issues]

## Recommendations
1. Immediate fixes (do now)
2. Short-term improvements (this sprint)
3. Long-term hardening (roadmap)

## Files Requiring Review
[List of files with issue counts]

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)

**Success Criteria:**
All findings cross-referenced against actual code. False positive rate documented. OWASP Top 10 coverage status included.
</task>
```

## Phase 4: Report Delivery

Present the final security report to the user with:
1. Executive summary first
2. Critical issues highlighted
3. Clear remediation steps
4. Offer to help fix specific issues if requested

---

<constraint>
Allowed Tools (READ-ONLY — this command does not modify code):
- Read, Glob, Grep, Task, Bash(date, ls, git status, git log, npm audit, pip audit)
- Do NOT use: Write, Edit, or any modifying tools
</constraint>

## Usage

```bash
# Full codebase security audit
/security

# Focus on specific area (still checks entire codebase but emphasizes this area)
/security $ARGUMENTS
```
