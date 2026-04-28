# nextjs-16-baseline — Pipeline Measurement Fixture

Bounded synthetic Next.js 16 / React 19 project with deliberate cross-agent surface — sized so kit pipelines do real work (~5–10 min per command) without the fixture being unmaintainable. **Used by `tests/baseline/MEASUREMENT-PROCEDURE.md` only**, not by smoke tests.

**Scope: 16 source files, ~600 LOC.** Don't grow it past ~25 files; once the fixture exceeds what one person can review in a sitting, it stops being a measurement target and becomes a real project's worth of upkeep. If a kit feature needs a new trap that doesn't fit in an existing file, swap a trap rather than add another file.

**Don't install/run.** Static fixture. `node_modules/` and `.next/` are gitignored in case anyone tries.

## Trap inventory

| File | Lines | Planted issue | Validates |
|---|---|---|---|
| `proxy.ts` | 18 | Next 16 proxy.ts (NOT legacy `middleware.ts`) | research-gate on `refactor-duplication-scanner` |
| `app/page.tsx` | 18 | Two unused locals (`unusedA`, `unusedB`) | `refactor-dead-code-scanner` SAFE-tier |
| `app/dashboard/page.tsx` | 18 | Passes `searchParams.q` into raw SQL concat | `security-vulnerability-scanner` SQLi flow |
| `app/api/users/route.ts` | 22 | API route with safe + unsafe code paths | `security-vulnerability-scanner` per-flow analysis |
| `lib/user.ts` | 27 | 3-way duplication (`fetchUser`/`fetchAdmin`/`fetchPartner`) + dead `unusedHelper` | `refactor-duplication-scanner` extraction + dead-code |
| `lib/db.ts` | 18 | `getUsersUnsafe` SQL string concat (OWASP A03) + safe `getUserByIdSafe` foil | `security-vulnerability-scanner` precision (must NOT flag the foil) |
| `lib/auth.ts` | 26 | Hard-coded JWT secret + `BCRYPT_ROUNDS=4` (OWASP A02 + A07) | `security-vulnerability-scanner` crypto + auth failures |
| `lib/formatter.ts` | 35 | OCP violation — twin `switch` chains over `Entity` enum | `refactor-solid-analyzer` (OCP), `react-solid` skill (Strategy Map) |
| `components/Button.tsx` | 14 | Well-formed (foil — must NOT be flagged) | precision check |
| `components/UserCard.tsx` | 95 | God component: SRP violation + useEffect data-fetch + derived-state-in-useState | `refactor-solid-analyzer` (SRP), `react-effect-policy` skill |
| `hooks/useUserData.ts` | 26 | Hand-written useEffect data-fetching hook | `react-effect-policy` skill |
| `__tests__/user.test.ts` | 16 | Only one of ~10 testable functions covered | `/test` coverage-gap detection |

Plus: `app/layout.tsx`, `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `README.md` — supporting files (no traps).

## Expected per-command surface

When you run a kit command against this fixture, this is what each pipeline *should* find. Use it as a sanity check while measuring — if the agent finds far fewer issues than listed, the measurement may be biased low (agent gave up early); far more, the agent is hallucinating.

| Command | Expected findings count |
|---|---|
| `/refactor` | ~6: 3-way duplication, OCP×2, SRP god component, dead `unusedHelper`, dead `unusedA`/`unusedB`, twin-switch DRY |
| `/security` | ~3: SQLi via `getUsersUnsafe`, hard-coded JWT secret, weak bcrypt rounds |
| `/review` | superset of /refactor + /security (depends on review scope) |
| `/test` | ~10 untested functions enumerated, ~5–8 test files generated |
| `/human-docs` | README + JSDoc gaps across most files |

## How to use

See `tests/baseline/MEASUREMENT-PROCEDURE.md` for the full measurement protocol. Short version:

```bash
cp -r tests/fixtures/nextjs-16-baseline /tmp/baseline-target
cd /tmp/baseline-target && git init -q && git add -A && git commit -qm "fixture state"
# Run the kit command from inside Claude Code with /tmp/baseline-target as scope
# After: capture rtk gain --history + session JSONL usage blocks
rm -rf /tmp/baseline-target
```

## When to update

- A new kit feature lands that needs a measurement trap → swap a trap (don't grow the file count)
- A framework version bump invalidates a trap (e.g. Next 17 ships) → update the affected file
- Measurement data shows the fixture is too small (pipelines finish too fast) → review whether to add 1–2 files OR accept that the kit is genuinely fast on small projects

Bump versions in `package.json` only when a kit feature would behave differently against the new version — a static fixture's whole point is being a fixed reference.
