# AGENTS.md

Canonical instructions for coding agents working on this project. Compatible with Oh My Pi (`omp`), OpenCode, VS Code Copilot, and any other [agents.md](https://agents.md/)-aware tool.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

## Repository purpose

Portable configuration kit for AI coding agents. The kit manages one coding harness, Oh My Pi (`omp`). Its Single Source of Truth (SoT) directory deploys to omp's user-config location through `./docks-kit sync`. Sync writes no `.agents` or `.claude` folder of its own; omp's folders follow `PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `XDG_DATA_HOME`, so an override that points into one of those folders makes omp's files go there. Sync also writes the kit plugin to `~/.docks-kit/omp-plugin`. Clone once to get a consistent AI-assisted environment on supported Linux, macOS, and Windows hosts. The kit focuses on **token efficiency without sacrificing quality**. Every setting and hook minimizes token use while preserving rigorous output. When you add or edit anything, ask: *does this change reduce tokens without weakening correctness?*

omp uses this `AGENTS.md` file plus the omp SoT under `SoT/.omp/`.

docks-kit runtime and standalone binary support covers Linux x64/arm64, macOS arm64, and Windows x64. Hosts outside this matrix fail before either launcher can fall back to Bun source.

## Context tree

Per-folder conventions live in nested `AGENTS.md` nodes. An agent can load only the nodes from the root down to its working directory, so open the node for the folder you edit from this table. Edit the node, not this list, when a folder's rules change. `context-tree audit` checks this table against the AGENTS.md files on disk.

| Node | Governs |
|---|---|
| `docs/AGENTS.md` | Plan-record routing to `docs/PLAN.md` |
| `cli/AGENTS.md` | Effect CLI, EngineNative sync engine, bundled docs topics, build scripts, unit and golden suites, SoT notes |
| `.agents/skills/AGENTS.md` | Project skills; omp reads `.agents/skills/` directly |

## Repository layout (cross-cutting)

| Path | Purpose |
|------|---------|
| `docks-kit` / `docks-kit.ps1` | POSIX and Windows CLI launchers. On supported hosts, each runs the matching binary in `cli/dist/` only when its `--version` matches `package.json` and no file under `cli/src/` or `cli/docs/` is newer than the binary. Otherwise it runs Bun-from-source and auto-installs Bun plus `node_modules`, and the mismatch or newer-source warning names the rebuild remedy. A launcher never deletes a binary: on a host without Bun it is the only remaining recovery path. Hosts outside the support matrix fail before source fallback. The standalone platform release binary provides no-Bun recovery. |
| `.oxlintrc.json` / `bunfig.toml` | Mechanical lint (correctness, suspicious, eqeqeq, no-var, prefer-const, no-unused) and the `bun fmt` code format settings (`[fmt]`) |
| `cli/` | Effect 4 CLI + bundled docs topics |
| `SoT/toolchain.json` | Toolchain floors manifest (verified pins consumed by EngineNative; optional `upstream` source read by `docks-kit toolchain outdated`) |
| `SoT/.omp/` | Kit-owned omp SoT: `AGENTS.md`, `config.yml`, `models.yml`, `mcp.json`, `intercom.json`, and the kit plugin source `plugin/` |
| `install.sh` / `install.ps1` | POSIX and Windows global installers. Each installer stops on a host outside the support matrix before it downloads anything. |
| `.github/workflows/release-cli.yml` | `cli-v*` release: four binaries (Linux x64 and arm64, macOS arm64, Windows x64), plus `SHA256SUMS`, the bundle's source map `docks-kit.js.map`, and npm publish |
| `README.md` | Front door |
| `package.json` / `bun.lock` | npm package: `bin` = `cli/dist/docks-kit.js`, a minified bundle of the CLI and the generated in-memory SoT payload that `prepack` builds (`bun run build:bundle`); `cli/src` ships too, for the checkout launchers |
| `docs/PLAN.md` | Plan pointer and project plan rules. The plan record is a GitHub issue; no plan markdown is tracked. `docs/AGENTS.md` routes to it. |
| `AGENTS.md` | This file — tool-agnostic instructions |

Module map for `cli/` (engine axes, commands, kit store, test fixtures, and the release-binary build `bun run build:binaries`): `cli/AGENTS.md`.

SoT notes (the shared prompt authorization, the omp deploy targets, the config and model merges, the retired inventories, the role map, the kit plugin sync, and the cleanup scope): `cli/AGENTS.md` (`### SoT notes`).

## Engineering rules

- **EngineNative and CLI rules** (idempotency, failure ledger, removed bash engine, Effect stack and skill routing, kit store, module boundaries): `cli/AGENTS.md`.
- **One sync.** `./docks-kit sync` deploys the omp SoT and takes no positional target. Combine it with `--dry-run`, `--skip-plugin-refresh` (install missing omp plugins without refreshing existing ones), and `--verbose`.
- **Additive by default.** Keys present in deployed config but absent from SoT are preserved on default sync. This protects user-only additions, but means drift accumulates. The exceptions are the omp retired inventories: `ompRemovals.ts` force-prunes retired kit-owned keys, `bash.patterns` rules, and model blocks on every sync (see the omp SoT notes in `cli/AGENTS.md`). Sync has no removal flag.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split an engine/CLI change and a per-tool config change unless the change requires atomicity.
- **Version bumps.** Bump `package.json` on user-visible behavior change; bump a `SoT/toolchain.json` `verified` pin only after testing that release. Refactors, splits, and doc edits bump nothing.
- **Regenerate the payload.** After `SoT/` or `package.json` changes, run `bun cli/scripts/generate-sot-payload.ts`; `bun run check:generated` verifies it. After file moves, clamp cited `metadata.source_files[].lines` ranges so `skillMetadata.test.ts` passes.
- **Dry-run before a real sync.** Preview a change to the omp SoT with `./docks-kit sync --dry-run` before you run `./docks-kit sync`.
- **SoT prompt files are rules, not explanation.** `SoT/.omp/AGENTS.md` is loaded into agent sessions' prompt context — every line costs prompt tokens on every turn for every user. Restrict its content to rules, heuristics, and `<constraint>` blocks the agent must *act on* during a turn. Do NOT add inline source citations (`Source: …`, attributed quotes), "why this rule exists" preface text, version-watermarking trivia (e.g. "Distilled from X v2.0, captured 2025-11-07"), per-bug workarounds, or installation instructions. Provenance, motivation, and historical context belong in `AGENTS.md` (humans read once) or in commit messages — never in the SoT. For every line, apply the official test: …
- **Cache-invariance for kit-authored prompt surfaces.** Never put timestamps, counters, or mutable state into SoT prompt files, extension output that lands in the cached prefix, or tool definitions — cache breaks force cold-start writes. Dynamic context belongs in runtime-injected messages, such as the reminders that the kit omp plugin adds to tool results.

## Code style

- Bash: for launchers and installers, use `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, and function-scoped `local`.
- JSON and YAML config: edit the SoT (`SoT/<tool>/`) and run `./docks-kit sync`. Never edit deployed config under `~/.omp/agent/` directly.

## Security

- No secrets in SoT. The kit's SoT directories are committed; treat them as declarative config only.
- Treat external plugin marketplaces and installer downloads as untrusted input. Prefer download-then-run over `curl … | bash` so a truncated stream cannot execute a partial script.
- **Pin, never float.** Every kit-driven install of third-party software is pinned to a `SoT/toolchain.json` `verified` version, except the exemption in the next item — no `@latest` npm/bun installs (Shai-Hulud-class worm surface), no mutable action tags in workflows (commit SHAs only), installer scripts fetched from version tags where upstream supports it. New third-party install surface ⇒ manifest pin first. The rule also covers a transitive dependency whose declared range is a caret or tilde over a prerelease: `^4.0.0-rc.109` admits every later prerelease of the same version tuple, and a published install resolves that range fresh because `bun.lock` is not packaged, so a runtime pinned in `package.json` meets a newer sibling and the process fails at startup. The fix is an exact root pin plus both guards: the offline `cli/test/unit/dependencyPins.test.ts` and the clean-room `bun run smoke:package`. Moving the Effect release is therefore one lockstep commit: set `effect`, `@effect/platform-bun`, and `@effect/platform-node-shared` to the same version together, then run `bun run smoke:package`. The offline guard fails when a lag breaks a declared range. Its peer-range check fails when the installed `effect` is outside a non-optional peer range of the runtime closure. Its nested-copy check fails when `@effect/platform-node-shared` lags. A lagging `@effect/platform-bun` can keep every declared range satisfied (4.1.1 accepts `@effect/platform-node-shared` `^4.1.1`), so only the lockstep commit keeps it in step. Details: the `toolchain-context` skill and `cli/docs/toolchain.md`.
- **Exemption: the kit's own package.** `install.sh` and `install.ps1` end with `bun add -g docks-kit@latest`, because a global installer that pinned itself would install a fixed old kit forever, and pinning it to `package.json` would request an unpublished version between the release-prep commit and the npm publish. The `@latest` exemption covers `docks-kit` alone. Both installers still pin the Bun installer they download to the manifest's verified version. `cli/test/unit/hostTargets.test.ts` asserts that pin in all four launcher and installer scripts, and `cli/test/unit/install.test.ts` proves `install.sh` passes it to the Bun installer. Any new install surface, a new marketplace or plugin source included, needs a manifest pin first.
## Testing

Run `bun run check` before and after each change: oxlint, `lint:effect` (Effect rules through `effect-tsgo diagnostics --strict`), `bun fmt --check`, `bun check`, the generated-payload check (`check:generated`), unit tests, and both golden suites. Scripts: `lint`, `lint:effect`, `format:check`, `typecheck`, `check:generated`, `test:unit`, `test:integration` (goldens), `test`, `format`; CI runs `check` on pushes to `main` and on pull requests with Bun 1.4.4. Prove-red modes must exit non-zero after detecting planted mismatches. The golden writer emits two-space JSON that `bun fmt` re-serializes, so run `bun run format` after `--update-goldens` or `format:check` fails. For Effect diagnostics in the editor, set the TypeScript language server command to `node_modules/.bin/effect-tsgo tsc --lsp --stdio`. Keep the `@effect/language-service` plugin entry in `cli/tsconfig.json`: without it, `lint:effect` checks no file and passes. Also verify user-facing changes via `./docks-kit sync --dry-run` and `bun run smoke:native`.

Use direct acceptance and focused regressions while iterating, then run the full unit/golden gate once at the pre-commit or release boundary. Reuse still-matching evidence; a later relevant edit invalidates only the affected rung and final gate, not every prior check.

Spawning-suite bundle and `DOCKS_KIT_TEST_CLI_ENTRY`: `cli/AGENTS.md`.

## Landing changes

Open a pull request when the change can alter what CI proves: `cli/`, `SoT/`, `.github/`, the launchers, the installers, `package.json`, `bun.lock`. Wait for every reported check to finish, then ask before merge. A failed or cancelled check blocks the merge. Push direct to `main` only for prose: root Markdown and code comments.

Never rewrite published `main` history to correct a routing mistake. Use a follow-up commit and say what happened.

## Skills

Project-skill authoring rules (scope, canonical layout, vendored `unslop`, citation constraint): `.agents/skills/AGENTS.md`.

**Vendored `unslop`.** The kit never runs the skills CLI. Only a maintainer refreshes the vendored `.agents/skills/unslop/` copy, with `npx skills@1.7.0 add cursor/plugins -s unslop -y -a universal`. The skills CLI 1.7.0 installs the `universal` agent into the project path `.agents/skills/`, which omp reads.

## Kit plugin content

`SoT/.omp/plugin/` holds skills at `skills/<name>/SKILL.md`, task agents at `agents/<name>.md`, and the extensions that `package.json` `omp.extensions` names. It ships the 32 docks and plan-lifecycle skills, the `workspace-hygiene` skill, the `code-reviewer` and `plan-reviewer` agents, the `hygiene`, `verify-gate`, and `context-tree-nudge` extensions, the trigger rules in `rules/`, and the `/cleanup` command. A skill reports a problem in DocksDocks/docks-kit. `bun run check` checks this content with four tests in `cli/test/unit/plugin/`: `skills.test.ts` (layout and name, frontmatter, report section, shared copies, references, durable anchors, transform guard, trigger collisions, score floor), `contentHash.test.ts`, `agents.test.ts` (agent rules, score floor), and `extensions.test.ts` (each entry imports and has a default function export).
After a skill edit, run `bun cli/scripts/skill-content-hash.ts --write` to refresh its `metadata.content_hash` and `metadata.updated`; `--check` names each stale skill. The skill checks, the 16-point rubric, and the check data in `config.json` (floors, report section, shared-copy groups, transform list) are in `cli/src/skills/`, which `docks-kit skill guard` and `docks-kit skill score` also use; the agent, reference, trigger, extension, and content-hash checks are in `cli/scripts/pluginContent/`.

## Plans

Read `docs/PLAN.md` before plan work; `docs/AGENTS.md` holds the docs-folder rules. The canonical contract is `skill://plan-manager/references/plan-contract.md` in the docks-kit kit plugin. Use `plan-workspace` for setup, main-context `plan-manager` for the six phases, and read-only `plan-reviewer` and `code-reviewer` wrappers for review. Use direct implementation only for a clear, reversible, low-risk local diff with one bounded acceptance path. Otherwise follow the plan-manager decision. Plan issues are the live records. Leave `docs/plans/finished/` frozen.

## Notes for nested overrides

Per the agents.md open standard, place an `AGENTS.md` inside any subdirectory that needs different rules. The closest `AGENTS.md` to the file being edited wins; explicit user prompts override everything.

## Setup

```bash
# Clone and sync the kit
git clone <this-repo> ~/projects/docks-kit
cd ~/projects/docks-kit
./docks-kit sync --dry-run           # preview before applying
./docks-kit sync                     # deploy the omp SoT (additive)
./docks-kit toolchain check          # verify installed tools against SoT/toolchain.json floors
```

On Windows, replace `./docks-kit` with `.\docks-kit.ps1` in these checkout commands.
