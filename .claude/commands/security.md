# Security Audit

Comprehensive security and logic analysis across the entire codebase using a specialized security committee approach.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

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
Launch a Task agent with model="opus" for CODEBASE DISCOVERY:

First, run `date "+%Y-%m-%d"` to confirm current date.

Map the entire codebase to identify security-relevant areas:

1. **Project Stack**: Identify languages, frameworks, dependencies
   - Check package.json, requirements.txt, go.mod, Cargo.toml, etc.
   - Note framework versions (Express, Django, Rails, etc.)
   - If `.claude/context/_index.json` exists, read it and relevant branch files for project architecture

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

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

### Logic Analyzer

```xml
<task>
Launch a Task agent with model="opus" as the LOGIC ANALYZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

### Adversarial Hunter

```xml
<task>
Launch a Task agent with model="opus" as the ADVERSARIAL HUNTER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

## Phase 3: Synthesis & Challenge

### Synthesizer

```xml
<task>
Launch a Task agent with model="opus" as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
