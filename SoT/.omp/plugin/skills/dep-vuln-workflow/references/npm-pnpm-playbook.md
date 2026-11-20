# JS/TS Dependency Workflow — Bun / pnpm / npm / yarn

Ecosystem-specific layer to the parent SKILL.md (`../SKILL.md`). Parent covers severity triage, exposure filter, the pre-flight checks, split strategy, and cadence — they apply unchanged. Load this file when the project ships JavaScript or TypeScript.

## Contents

- [Audit & Upgrade Commands](#audit--upgrade-commands)
- [JS Major Upgrade Surprises](#js-major-upgrade-surprises)
- [Peer-Dep Trap (Concrete Example)](#peer-dep-trap-concrete-example)
- [Exposure Filter — JS Specifics](#exposure-filter--js-specifics)
- [Suppression Trap — BAD / GOOD](#suppression-trap--bad--good)
- [JS Gotchas](#js-gotchas)
- [See Also](#see-also)

## Audit & Upgrade Commands

```bash
# Bun
bun audit                                   # See findings
bun audit --audit-level=high                # High-and-critical findings
bun outdated                                # What's available
bun update <a>@latest <b>@latest            # Batch upgrade (single commit)
bun why <pkg>                               # Why it is installed; labels each path dev/optional
bun pm ls                                   # Top-level installed deps (--all for the whole tree)

# pnpm (preferred for monorepos / disk efficiency)
pnpm audit                                  # See findings
pnpm audit --prod                           # Runtime-only view
pnpm outdated                               # What's available
pnpm up <a>@latest <b>@latest               # Batch upgrade (single commit)
pnpm why <pkg>                              # Trace transitive paths

# npm (registry / Node default)
npm audit
npm audit fix                               # Auto-patch non-breaking
npm audit fix --force                       # AVOID — applies breaking changes
npm outdated
npm update <pkg>
npm ls <pkg>                                # Trace transitive

# yarn classic (v1)
yarn audit
yarn outdated
yarn upgrade <pkg>@latest
yarn why <pkg>

# yarn berry (v2+)
yarn npm audit
yarn up <pkg>
```

Full check suite after every upgrade (use the project's package manager):

```bash
# Bun
bun run lint && bun run typecheck && bun run build && bun audit

# pnpm
pnpm lint && pnpm typecheck && pnpm build && pnpm audit
```

Commit in at least two independently revertible units: the security bump stands alone with the advisory link in its body, and hygiene upgrades go in a separate commit.

## JS Major Upgrade Surprises

| Upgrade | Watch out for |
|---|---|
| Next.js 15 → 16 | `middleware` convention deprecated → `proxy` (Node.js runtime only; keep `middleware` if you need the edge runtime); synchronous Request API access removed |
| Next.js 14 → 15 | `cookies()` / `headers()` / `params` / `searchParams` become async |
| React 18 → 19 | `use()` hook; async transitions; ref-as-prop replaces `forwardRef` |
| `eslint-plugin-react-hooks` bumps | Newer recommended configs add rules such as `set-state-in-effect`; new lint errors can appear with no React bump |
| TypeScript → 6.0 | `baseUrl` deprecated; stricter type narrowing; `ignoreDeprecations: "6.0"` escape hatch |
| TypeScript → 5.0 | `decorators` native syntax; `const` type params; module resolution changes |
| ESLint → 9 | Flat config (`eslint.config.*`) is the default; `.eslintrc` deprecated (opt back in with `ESLINT_USE_FLAT_CONFIG=false`) |
| ESLint → 10 | `.eslintrc` format removed; Node 20.19+/22.13+/24+ required; deprecated `context` / `SourceCode` methods removed, so some legacy plugins break |

## Peer-Dep Trap (Concrete Example)

`eslint-config-next@16.2.4` declares `peer: "eslint": ">=9.0.0"` — satisfies ESLint 10 on paper. But the bundled `eslint-plugin-react@7.37.5` calls a removed ESLint API (`context.getFilename`). **The peer declaration lied.**

Always verify by upgrading and running the project's lint script (`bun run lint`, `pnpm lint`, or its actual equivalent) — don't trust the declared range.

## Exposure Filter — JS Specifics

`bun why <pkg>` and `pnpm why <pkg>` both trace transitive paths. Bun labels each
edge, so a dev-only path is visible without reading the manifest:

```text
@biomejs/cli-linux-x64@2.5.4
  └─ optional @biomejs/biome@2.5.4 (requires 2.5.4)
     └─ dev docks-plugin-tooling (requires 2.5.4)
```

- Every path goes through `devDependencies` only → not in the production bundle.
- A path goes through a `dependencies` chain → in the bundle. Read the advisory to confirm you touch the vulnerable API.

A package that runs only at build time (a scaffolding CLI, a code generator) does not ship its transitive dependencies to runtime, even when it sits in `dependencies`. Check where the package runs, not only which manifest section lists it. Runtime exposure is zero, but still bump the parent package when a minor bump clears the transitive: the fix is low-risk and clears the audit.

## Suppression Trap — BAD / GOOD

```ts
// BAD — suppress the new React 19 rule to ship the upgrade faster
// eslint-disable-next-line react-hooks/set-state-in-effect
useEffect(() => { setOpen(true) }, [])
```

```ts
// GOOD — fix the underlying pattern the upgrade surfaced
const [open, setOpen] = useState(true)   // derive initial state inline
```

The upgrade exposed a real anti-pattern; the lint rule did its job.

## JS Gotchas

- **React + @types/react + react-dom version lockstep.** `react@19` needs `@types/react@19` AND `react-dom@19`. Missing one → silent type-only mismatch (build passes, runtime crashes on hooks signature changes).
- **pnpm workspace protocol.** `workspace:*` deps inside a monorepo aren't on the registry. `pnpm audit` follows them through; standalone `npm audit` in a sub-package may miss them.
- **Yarn v1 vs Berry are different CLIs.** Berry uses `yarn npm audit` (note the `npm` infix); commands like `yarn upgrade` don't exist in Berry.
- **`pnpm patch <pkg>` for fast fixes.** When a transitive has no fixed release yet, `pnpm patch` writes a local patch and applies it on install. Faster than vendoring; document the reason in `package.json`.
- **`overrides` (npm) / `pnpm.overrides`.** Force-pin a transitive to a fixed version when upstream is slow. Document inline so you remember to remove once upstream catches up.

## See Also

- `../SKILL.md` — universal playbook (severity, exposure filter, split strategy, cadence)
- `lint-no-suppressions` skill — never silence new lint rules surfaced by an upgrade
- pnpm audit docs: https://pnpm.io/cli/audit
- Bun audit docs: https://bun.com/docs/install/audit
- Next.js upgrade guides: https://nextjs.org/docs/app/guides/upgrading
