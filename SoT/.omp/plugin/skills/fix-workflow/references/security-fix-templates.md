# Security-Fix Templates

Per-finding-type expansion of the parent SKILL.md Step 4 plan template. Load when the fix list contains CVE / GHSA / RUSTSEC advisories, OWASP findings, or any security audit output.

## Triage Before Fix

Before writing the Step 4 row for a security finding, run this checklist:

| Check | Why it matters |
|---|---|
| CVSS score recorded | Determines tier and urgency (see `dep-vuln-workflow` skill's severity triage) |
| Advisory URL pinned | The "Why" field cites the advisory; no link = no traceable rationale |
| Reachability confirmed | Build-time-only deps don't ship; if vuln isn't in runtime bundle, it's a hygiene fix not a security fix |
| Fixed-version available | If upstream has no fix yet, plan a `replace` / `pnpm.overrides` / `[patch.crates-io]` workaround instead |
| OWASP category tagged | Helps the commit message + future grep (`OWASP A05:2025` for injection, etc.) |

## Test-Strategy Template

Security fixes need test strategies that target the attacker, not just the user:

| Vuln type | Test what |
|---|---|
| Injection (SQL / command / log / path) | Send the actual exploit payload; assert it's rejected or escaped |
| AuthN bypass | Submit forged credentials / expired tokens; assert 401/403 |
| AuthZ escalation | Authenticate as user A; access user B's resource; assert 403 |
| Deserialization | Send malicious pickle / YAML / JSON; assert exception is raised before any object is constructed |
| SSRF | Submit `http://169.254.169.254/...` / `file://...` URLs; assert request is refused at the validator |
| XXE | Send doc with external entity reference; assert entity is never resolved |
| Hardcoded secret | grep for the literal; assert removed AND key rotated in the env source-of-truth |

If a unit test can't trigger the attacker path (e.g., the vuln is in a binary's signature check, not in your code), pin the test at the **integration boundary**: the wrapper that calls the upgraded dep, with a fuzz input.

## Revert Trigger — Security Specifics

The universal "if test X fails, revert" rule isn't enough for security. Add these:

- **Authentication regression** — any test in `auth.*test.ts` / `test_auth.py` / `auth_test.go` flips → revert immediately. Auth regressions are silent; you don't want to ship an auth bypass.
- **Audit-tool re-flag** — `bun audit` / `pnpm audit` / `pip-audit` / `cargo audit` / `govulncheck` reports the same or a NEW finding after the fix → revert, the bump introduced a different vuln.
- **Dependency-tree explosion** — `bun why` / `pnpm why` / `cargo tree` shows the lockfile gained a new vulnerable transitive → revert.
- **TLS / crypto API change** — type-check passes but the new dep version uses a different cipher / kdf / handshake → manual review required; don't auto-merge.

## Common Security-Fix Anti-Patterns

| Anti-pattern | Why it fails | Right thing |
|---|---|---|
| Patch via input-sanitization regex | Blacklists always miss a vector | Fix at the boundary: parameterized query, allowlist validator, output-encoding library |
| Bump dep + add feature in same commit | If revert is needed, you lose the feature too | Security commit stands alone (see `dep-vuln-workflow` split strategy) |
| Silence the security linter (`@ts-ignore`, `# noqa: S301`) | Silences the alarm, not the threat | Fix root cause; if truly justified, document with CVE + advisory link inline (see `lint-no-suppressions`) |
| Pin to a version that "looks safe" without checking the advisory's `patched_versions` | The fix may not be in the picked version | Pin to the version the advisory names; verify with audit tool re-run |
| Apply via auto-fix (`npm audit fix --force`) | `--force` applies BREAKING changes; you ship a different bug | Always review the diff; auto-fix only the non-breaking subset |

## See Also

- `../SKILL.md` — universal 6-step procedure
- `dep-vuln-workflow` skill — severity triage and ecosystem-readiness
- `lint-no-suppressions` skill — never silence security linter output
- OWASP Top 10 (2025): https://owasp.org/Top10/2025/
- GitHub Advisory Database: https://github.com/advisories
