---
allowed-tools: Read, Grep, Glob
description: Security vulnerability scan with stack-specific checks
---

# Security Vulnerability Analysis

Analyze the codebase for security vulnerabilities following OWASP guidelines and stack-specific best practices.

## Phase 0: Project Detection

First, identify the project stack for targeted analysis:
1. Check `package.json` for frameworks (Next.js, Fastify, Express, Expo)
2. Check `pnpm-workspace.yaml` for monorepo structure
3. Check `tsconfig.json` for path aliases to trace imports correctly
4. Check for authentication libraries (next-auth, passport, etc.)
5. Check for database/ORM (Prisma, Drizzle, pg, etc.)
6. Check for Docker configuration
7. Check for scripts (`scripts/`, `*.sh`) - review for security
8. Check for environment variable handling

Adapt security checks based on detected stack.

---

## OWASP Top 10 Analysis

### A01: Broken Access Control
- Missing authorization checks on endpoints
- IDOR (Insecure Direct Object References)
- Path traversal vulnerabilities
- CORS misconfigurations
- Missing function-level access control

### A02: Cryptographic Failures
- Sensitive data transmitted in clear text
- Weak encryption algorithms
- Hardcoded secrets or keys
- Missing encryption at rest
- Weak password hashing

### A03: Injection
- SQL Injection (check parameterized queries)
- NoSQL Injection
- Command Injection (shell sanitization)
- LDAP/XPath Injection
- Expression Language Injection

### A04: Insecure Design
- Missing security controls in business logic
- No rate limiting on sensitive operations
- Missing account lockout
- Insecure password recovery

### A05: Security Misconfiguration
- Default credentials
- Unnecessary features enabled
- Missing security headers
- Verbose error messages
- Outdated dependencies

### A06: Vulnerable Components
- Known CVEs in dependencies
- Outdated packages
- Unmaintained libraries

### A07: Authentication Failures
- Weak password policies
- Missing MFA options
- Session fixation
- Insecure token storage
- Missing brute-force protection

### A08: Data Integrity Failures
- Missing integrity checks
- Insecure deserialization
- Unsigned updates/downloads

### A09: Logging Failures
- Sensitive data in logs
- Missing security event logging
- No log integrity protection

### A10: SSRF
- Unvalidated URL fetching
- Internal service exposure

---

## Stack-Specific Security Checks

### If TypeScript Detected
- `any` types bypassing type safety
- Type assertions hiding security issues
- Runtime type validation missing

### If Next.js Detected
- Server Actions input validation
- API routes authentication
- CSRF protection
- Security headers (next.config.js)
- Environment variable exposure (`NEXT_PUBLIC_`)
- Server Component data leakage
- Middleware authorization

### If Fastify/Express Detected
- Helmet.js or security headers
- Rate limiting implementation
- Input validation (Zod, Joi, etc.)
- Authentication middleware
- CORS configuration
- Body parser limits
- Request validation schemas

### If Expo/React Native Detected
- Secure storage usage (not AsyncStorage for secrets)
- Certificate pinning
- Deep link validation
- Biometric authentication
- Sensitive data in bundle
- Debug mode in production

### If Database/ORM Detected
First, identify the ORM: Drizzle, Prisma, TypeORM, or raw queries.

**Universal Security:**
- Use ORM query builders (inherently parameterized)
- Never concatenate user input into queries
- Secure connection strings in environment variables
- Use least privilege database users
- Enable row-level security where applicable

**ORM-Specific:**
- **Drizzle**: Avoid `sql.raw()` with user input, use `sql.placeholder()`
- **Prisma**: Avoid `$queryRaw` with string interpolation, use `$queryRaw` with Prisma.sql
- **TypeORM**: Avoid `query()` with concatenation, use QueryBuilder parameters

```typescript
// UNSAFE - SQL injection in any ORM
`SELECT * FROM users WHERE name = '${userInput}'`

// SAFE - Use ORM query builder
// Drizzle: db.select().from(users).where(eq(users.name, userInput))
// Prisma:  prisma.user.findMany({ where: { name: userInput } })
// TypeORM: repo.find({ where: { name: userInput } })
```

### If Redis Detected
- AUTH enabled
- No sensitive data without encryption
- ACL configuration
- Bind address restrictions

### If Docker Detected
- No secrets in Dockerfile/compose
- Non-root user
- Read-only filesystem where possible
- No privileged mode
- Secrets management (Docker secrets, env files)
- Base image vulnerabilities
- .dockerignore completeness

### If Scripts Detected (*.sh)
- No hardcoded credentials or secrets
- Proper input validation
- Use of `set -e` for error handling
- No unsafe command substitution
- Environment variables properly quoted
- No world-writable files created
- Secure temporary file handling

---

## Data Exposure Checks

- Sensitive data in logs
- API keys in source code
- .env files in repository
- Credentials in configuration
- Information leakage in errors
- Debug endpoints in production
- Source maps in production

---

## Output Format

For each vulnerability found:

1. **CWE ID**: (e.g., CWE-89 for SQL Injection)
2. **OWASP Category**: (A01-A10)
3. **Location**: File and line number
4. **Severity**: Critical / High / Medium / Low
5. **Description**: Technical explanation
6. **Exploitation**: How an attacker could exploit this
7. **Remediation**: Specific fix with code example
8. **References**: OWASP or CWE documentation links

**Priority Order**:
1. Critical: Actively exploitable, high impact
2. High: Exploitable with some conditions
3. Medium: Requires specific circumstances
4. Low: Defense in depth improvements
