---
allowed-tools: Read, Grep, Glob
description: Security vulnerability scan following OWASP guidelines
---

# Security Vulnerability Analysis

Analyze the codebase for security vulnerabilities following OWASP Top 10 and secure coding best practices.

## Vulnerability Categories

### Injection Attacks
- SQL Injection (parameterized queries check)
- Command Injection (shell command sanitization)
- NoSQL Injection
- LDAP Injection
- XPath Injection

### Cross-Site Scripting (XSS)
- Reflected XSS
- Stored XSS
- DOM-based XSS
- Template injection

### Authentication & Authorization
- Broken authentication flows
- Weak password policies
- Missing rate limiting
- Session management issues
- Insecure token storage
- IDOR (Insecure Direct Object References)
- Missing authorization checks

### Data Exposure
- Sensitive data in logs
- Exposed credentials or API keys
- Unencrypted sensitive data
- Information leakage in errors
- Debug endpoints in production

### Configuration Issues
- Insecure default configurations
- Exposed stack traces
- Missing security headers
- CORS misconfigurations
- Insecure cookie settings

### Dependencies
- Known vulnerable packages
- Outdated dependencies with CVEs
- Unused dependencies that increase attack surface

## Output Format
For each vulnerability:
1. **CWE ID**: (if applicable)
2. **Location**: File and line number
3. **Severity**: Critical / High / Medium / Low
4. **Description**: Technical explanation
5. **Exploitation**: How an attacker could exploit this
6. **Remediation**: Specific fix with code example
7. **References**: OWASP or other documentation

Make sure to follow OWASP secure coding best practices in all recommendations.
