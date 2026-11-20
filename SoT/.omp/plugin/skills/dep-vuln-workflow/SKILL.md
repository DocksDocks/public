---
name: dep-vuln-workflow
description: Use when running bun/pnpm/npm/yarn audit, pip-audit, cargo audit, or govulncheck; responding to a CVE/GHSA advisory; bumping framework majors (next/react/typescript/django/fastapi/tokio/axum); handling peer-dep or version-resolution conflicts after an upgrade; investigating transitive vulnerabilities; deciding auto-patch vs hold-back; setting dependency-update cadence. Not for fixing the vulnerable code path itself (use fix-workflow) or full security audits (use security).
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-10-23"
  content_hash: "4da60cafda174ac480d497a05983897f90d616f8dc7dea73bd3cc804ce995ab4"
---

# Dependency Vulnerability & Upgrade Workflow

<constraint>
Security patches ship first, always. Hygiene/feature bumps ship separately so a revert on one doesn't roll back the other. Never bump a major without verifying peer-dep / version-resolution compatibility AND running the full check suite (lint + typecheck/static-analysis + build + audit).
</constraint>

## When to Use

- Running an audit tool (`bun/pnpm/npm/yarn audit`, `pip-audit`, `cargo audit`, `govulncheck`) and seeing findings.
- A CVE / GHSA / RUSTSEC advisory lands for a package the project depends on.
- Bumping a framework / runtime / language toolchain across a major version.
- Resolving peer-dep or version-resolution conflicts after an upgrade.
- Investigating a transitive vulnerability (dep of a dep).
- Setting dep-update cadence for a project.

## When to Load References

| Triggered by | Reference file |
|---|---|
| JS/TS project — bun/pnpm/npm/yarn audit; Next/React/TS/ESLint majors | `references/npm-pnpm-playbook.md` |
| Python project — pip-audit, poetry, pipenv, uv; Django/FastAPI/Pydantic majors | `references/pip-playbook.md` |
| Rust project — `cargo audit`, `cargo outdated`; tokio/axum majors, edition or MSRV bumps | `references/cargo-playbook.md` |
| Go project — `govulncheck`, `go list -m -u`; module path `/vN` majors | `references/go-mod-playbook.md` |

## Severity Triage

| Severity | CVSS | Response |
|---|---|---|
| CRITICAL | 9.0-10.0 | Patch **today**. Stop feature work. |
| HIGH | 7.0-8.9 | Patch this week. Bundled commit of its own. |
| MODERATE | 4.0-6.9 | Evaluate exposure. If runtime-reachable, patch this sprint. If build-time-only, bundle with next hygiene pass. |
| LOW | 0.1-3.9 | Next scheduled upgrade cycle. |

## Exposure Filter — Runtime vs Build-time

Not every vulnerability affects you. Before panicking:

1. **Is the vulnerable code in the runtime bundle / binary?** Use your ecosystem's "why" tool (`bun why`, `pnpm why`, `pip show` / `poetry show --tree`, `cargo tree -i`, `go mod why`) — if every dep-path goes through dev/test/build-only sections, it's not in the shipped artifact. `bun why <pkg>` prints each dependency path and labels it `dev` or `optional`, which answers this question directly.
2. **Is the vulnerable API the one you call?** Read the advisory. Many CVEs affect a specific function — if you don't call it, you're not exposed. `govulncheck` does this reachability check automatically; for other ecosystems it's manual.
3. **Does an upgrade fix it?** Check the advisory's `patched_versions`. If the fix is in a patch release, auto-upgrade. If it's in a major, see the Major Version Playbook below.

## Major Version Playbook — The 3 Pre-flight Checks

Before bumping any framework / runtime / language major:

1. **Breaking changes** — read the migration guide, not just the release notes.
2. **Version-resolution compatibility** — every plugin/dep the project uses must satisfy the new major. Declared peer/version ranges sometimes lie (a plugin says it supports the new major but its internals call a removed API). Verify by upgrading and running the full check suite end-to-end.
3. **Config migrations** — language/framework majors often deprecate config fields or tighten rules (e.g., TypeScript 6.0 deprecates `baseUrl`; newer `eslint-plugin-react-hooks` recommended configs add rules such as `set-state-in-effect`; Pydantic v2 renames `Config` to `model_config`). Scan release notes for config / rule changes.

### When to roll back

If a major bump breaks an upstream plugin that you cannot control:
- Revert that single package to the previous major.
- Document the hold-back in the commit message: "held back because X ecosystem isn't ready — revisit when Y publishes fix."
- Open a tracker issue / plan doc.
- Ship the other upgrades that worked.

**Do not** suppress new lint rules or `@ts-ignore` / `# type: ignore` / `#[allow]` / `//nolint` the type errors. See the `lint-no-suppressions` skill.

## Split Strategy — Security vs Hygiene

Always two commits minimum. Commit A (security) must stand alone — small diff, easy to cherry-pick to a release branch. Commit B (hygiene) can be reverted without affecting A. Generic commit hygiene beyond this security-vs-hygiene axis — atomic splits, messages, PR descriptions, squash vs rebase — lives in the `commit-discipline` skill.

```text
# GOOD — split into two independently revertable units
chore(deps): patch CVE-2026-23869 — bump <pkg> X.Y.Z → X.Y.Z'    [commit A]
chore(deps): bump <pkg-b>, <pkg-c>, <pkg-d> to latest             [commit B]
```

```text
# BAD — one mixed commit; reverting hygiene also reverts the CVE patch
chore(deps): bump <pkg>, <pkg-b>, <pkg-c>, <pkg-d> + patch CVE-2026-23869
```

For major bumps, **one commit per major**. Never bundle two majors:

```text
# BAD — if A breaks later, you can't bisect without also reverting B
chore(deps): bump A 5 → 6 AND B 18 → 19
```

```text
# GOOD — bisectable; each major gets its own full-suite verification
chore(deps): bump A 5 → 6
chore(deps): bump B 18 → 19
```

## Verification — Non-negotiable

<constraint>
Every upgrade must pass the full check suite (lint + typecheck/static-analysis + build/compile + audit) before commit. If any step fails, fix the root cause or roll back the specific package that broke — never commit with known failures and never suppress new errors to "make it green" (see the `lint-no-suppressions` skill).
</constraint>

Audit must report zero known vulnerabilities at the chosen severity floor. Ecosystem-specific check-suite commands live in the per-language reference files.

## Cadence

| Trigger | Action |
|---|---|
| New CVE published for any direct dep | Apply the exposure filter, then respond per Severity Triage |
| Weekly | Audit + review what's outdated |
| Monthly | Patch + minor upgrades bundled (hygiene commit) |
| Quarterly | Evaluate pending major bumps against ecosystem readiness |

Set this as a calendar item. Dep security is a habit, not a reaction.

<constraint>
The lockfile (`bun.lock` / `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `poetry.lock` / `Pipfile.lock` / `uv.lock` / `Cargo.lock` / `go.sum`) must be committed — never `.gitignore` it. A vuln in the lockfile is a real vuln. Advisory tools (GitHub Dependabot, Snyk, RustSec) flag everything; their report is a starting point, not a verdict — apply the runtime-vs-build-time exposure filter before patching.
</constraint>

## Gotchas — Universal

- **`--prod` / production-only flags** exclude dev/test/build deps from the audit view. Use them for runtime exposure; don't use them to silence dev-only vulns you should still patch.
- **Peer / version-resolution warnings are signals, not noise.** "Unmet peer X@^N: found N+1" means the plugin does not declare support for N+1. Run the full check suite immediately.
- **Major bumps usually require companion lockstep bumps** (renderer + types in JS, framework + runtime in Python, edition + tokio in Rust, module-path-suffix + module in Go). Missing one = silent type-only or runtime mismatch.

## References

- GitHub Advisory Database: https://github.com/advisories
- CVSS calculator: https://www.first.org/cvss/calculator/3.1
- OSV (cross-language vuln DB): https://osv.dev/
- RustSec Advisory DB: https://rustsec.org/advisories/
- PyPA Advisory DB: https://github.com/pypa/advisory-database
- Go Vulnerability DB: https://pkg.go.dev/vuln/

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
