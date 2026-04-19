---
name: dep-vuln-workflow
description: Use when running a pnpm audit / npm audit / yarn audit / pip-audit / cargo audit / go list -m -u, responding to a CVE advisory, upgrading npm packages (major/minor/patch), dealing with a GHSA advisory, bumping next.js / react / typescript / eslint, handling peer-dependency conflicts after a major upgrade, deciding whether to auto-patch vs hold back a major, investigating a transitive vulnerability, or setting the dependency-update cadence for a project. Covers CVSS severity triage (critical/high/moderate/low), major-vs-patch upgrade risk, ecosystem-readiness check (peer-dep compatibility before major bumps), transitive-vuln handling (build-time vs runtime), the "one security commit + one hygiene commit" split, how to verify an upgrade (lint + typecheck + build + audit), and the rollback trigger (ESLint 10 + eslint-plugin-react story).
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-04-18"
---

# Dependency Vulnerability & Upgrade Workflow

<constraint>
Security patches ship first, always. Hygiene/feature bumps ship separately so a revert on one doesn't roll back the other. Never bump a major version without verifying peer-dep compatibility AND running the full check suite (lint + typecheck + build).
</constraint>

## When to Use

- Running `pnpm audit` / `npm audit` / `yarn audit` and seeing findings.
- A CVE / GHSA advisory lands for a package we use.
- Bumping `next`, `react`, `typescript`, `eslint`, or any framework across a major version.
- Resolving peer-dependency conflicts after an upgrade.
- Investigating a transitive vulnerability (comes from a dep of a dep).
- Setting the dep-update cadence for a project.

## Severity Triage

| Severity | CVSS | Response |
|---|---|---|
| CRITICAL | 9.0-10.0 | Patch **today**. Stop feature work. |
| HIGH | 7.0-8.9 | Patch this week. Bundled commit of its own. |
| MODERATE | 4.0-6.9 | Evaluate exposure. If runtime-reachable, patch this sprint. If build-time-only, bundle with next hygiene pass. |
| LOW | 0.1-3.9 | Next scheduled upgrade cycle. |

## Exposure Filter — Runtime vs Build-time

Not every vulnerability affects you. Before panicking:

1. **Is the vulnerable code in the runtime bundle?** Check with `pnpm why <package>` — if the path goes through `devDependencies` only, it's not in the production artifact.
2. **Is the vulnerable API the one we use?** Read the advisory. Many CVEs affect a specific function (e.g., `marked.setOptions`) — if we only call `marked.parse`, we're not exposed.
3. **Does an upgrade fix it?** Check the advisory's `patched_versions`. If the fix is in a patch release (`^x.y.z`), auto-upgrade. If it's in a major, see "Major Version Playbook" below.

Example: in this codebase, a MODERATE `hono` vuln appeared as transitive via `shadcn>@modelcontextprotocol/sdk>hono`. The `shadcn` CLI is build-time only and we don't SSR hono JSX — runtime exposure was zero. Still, a `shadcn` minor bump cleared the transitive without risk.

## Upgrade Playbook — Patches & Minors

```bash
pnpm audit                              # See what's there
pnpm outdated                           # What's available
pnpm up <pkg-a>@latest <pkg-b>@latest   # Single `pnpm up` for the batch
pnpm lint && pnpm typecheck && pnpm build
pnpm audit                              # Confirm cleared
```

Commit once: `chore(deps): bump X/Y/Z + patch CVE-XXXX-YYYY` with the advisory link in the body.

## Major Version Playbook — The 3 Pre-flight Checks

Before bumping a framework major, verify:

1. **Breaking changes**: read the migration guide, not just the release notes.
2. **Peer dependency range**: the major must be satisfied by every plugin we use. Example: `eslint-config-next@16.2.4` declares `peer: "eslint": ">=9.0.0"` — satisfies ESLint 10 on paper, but the bundled `eslint-plugin-react@7.37.5` uses a removed ESLint API (`context.getFilename`). **The peer declaration lied.** Verify by upgrading and running `pnpm lint`.
3. **Config migrations**: TypeScript 6.0 deprecates `baseUrl`. React 19 tightens `react-hooks/set-state-in-effect`. Always scan the release notes for config/rule changes.

### When to roll back

If a major bump breaks an upstream plugin that you cannot control:
- Revert that single package to the previous major (`pnpm up eslint@^9`)
- Document the hold-back in the commit message: "held back because X ecosystem isn't ready — revisit when Y publishes fix"
- Open a tracker issue / plan doc
- Ship the other upgrades that worked

**Do not** suppress the new lint rules or `@ts-ignore` the type errors. See the `lint-no-suppressions` skill.

## Split Strategy — Security vs Hygiene

Always two commits minimum. Commit A (security) must stand alone — small diff, easy to cherry-pick to a release branch. Commit B (hygiene) can be reverted without affecting A.

```
# GOOD — split into two independently revertable units
chore(deps): patch CVE-2026-23869 — bump next 16.1.7 → 16.2.4     [commit A]
chore(deps): bump supabase-js, postcss, shadcn to latest          [commit B]
```

```
# BAD — one mixed commit; reverting hygiene also reverts the CVE patch
chore(deps): bump next, supabase-js, postcss, shadcn + patch CVE-2026-23869
```

For major bumps, **one commit per major**. Never bundle two majors in the same commit:

```
# BAD — if TS 6 breaks later, you can't bisect without also reverting React 19
chore(deps): bump TypeScript 5 → 6 AND React 18 → 19
```

```
# GOOD — bisectable; each major gets its own full-suite verification
chore(deps): bump TypeScript 5 → 6
chore(deps): bump React 18 → 19
```

## Lint/Typecheck/Build — Non-negotiable Verification

<constraint>
Every upgrade must pass `pnpm lint && pnpm typecheck && pnpm build && pnpm audit` before commit. If any step fails, fix the root cause or roll back the specific package that broke — never commit with known failures and never suppress the new errors to "make it green" (see the `lint-no-suppressions` skill).
</constraint>

After every upgrade:

```bash
pnpm lint       # ESLint, must be zero errors
pnpm typecheck  # tsc --noEmit, must be zero errors
pnpm build      # Next.js production build must succeed
pnpm audit      # Must show "No known vulnerabilities found"
```

```
# BAD — suppress the new React 19 rule to ship the upgrade faster
// eslint-disable-next-line react-hooks/set-state-in-effect
useEffect(() => { setOpen(true) }, [])
```

```
# GOOD — fix the underlying pattern surfaced by the upgrade
const [open, setOpen] = useState(true)   // derive initial state inline
```

## Common Upgrade Surprises

| Upgrade | Watch out for |
|---|---|
| Next.js 15 → 16 | `middleware.ts` → `proxy.ts`; edge runtime removed |
| Next.js 14 → 15 | `cookies()` / `headers()` / `params` / `searchParams` become async |
| React 18 → 19 | `react-hooks/set-state-in-effect` new rule; `use()` hook; async transitions |
| TypeScript → 6.0 | `baseUrl` deprecated; stricter type narrowing; `ignoreDeprecations: "6.0"` escape hatch |
| TypeScript → 5.0 | `decorators` native syntax; `const` type params; module resolution changes |
| ESLint → 9 | `.eslintrc` removed, flat config only |
| ESLint → 10 | Node 20.19+/22.13+ required; some legacy plugins break |

## Cadence

| Trigger | Action |
|---|---|
| New CVE published for any direct dep | Patch within 48h |
| Weekly | `pnpm audit` + review `pnpm outdated` |
| Monthly | Patch + minor upgrades bundled (hygiene commit) |
| Quarterly | Evaluate pending major bumps against ecosystem readiness |

Set this as a calendar item. Dep security is a habit, not a reaction.

## Gotchas

- **`pnpm audit --prod` vs full audit**: `--prod` excludes devDependencies. Use it when you want a runtime-only view. But don't use it to silence dev-only vulns you should still patch.
- **Lockfile must be committed**. A vuln in `pnpm-lock.yaml` matters. Never gitignore the lockfile.
- **Peer warnings are signals, not noise**. `unmet peer X@">=9": found 10` means the plugin was never tested against 10. Run `pnpm lint` immediately to see if it breaks in practice.
- **`pnpm why <pkg>`** tells you the import path. Use it to see if a transitive vuln is reachable from your entry points.
- **Snyk / GitHub Dependabot are not substitutes** for the exposure filter. They flag everything. Your judgment is whether a flag matters for your project.
- **Major React bumps often require renderer + types bumps together**: `react@19` needs `@types/react@19` and `react-dom@19`. Missing one = silent type-only mismatch.

## References

- pnpm audit: https://pnpm.io/cli/audit
- GitHub Advisory Database: https://github.com/advisories
- CVSS calculator: https://www.first.org/cvss/calculator/3.1
- Next.js upgrade guides: https://nextjs.org/docs/app/building-your-application/upgrading
