# Phase 1 — Refactor Exploration

Map the project so downstream scanners and the SOLID analyzer are oriented. Enumerate; do not diagnose.

<constraint>
Enumerate, don't judge. Record facts ("file X uses pattern Y at line Z"), never verdicts ("this should be refactored"). Diagnosis belongs to Phases 2–3.
</constraint>

## Project profile

- Stack: languages, frameworks (check `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pyproject.toml`).
- Monorepo: check `package.json` workspaces, `pnpm-workspace.yaml`, `lerna.json`, `nx.json`, Cargo `[workspace]`. List packages with their stacks.
- Package manager and lockfile (`bun.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`), test runner (per-package if monorepo), linter.
- Scope: a path argument, or the whole project.

## Available analysis tools

Check `node_modules/.bin/` and PATH for:

| Language | Tools |
|---|---|
| JS/TS | `knip`, `depcheck`, `ts-prune` |
| Python | `vulture`, `ruff` |
| Go | `deadcode` |
| Rust | `cargo-udeps` (also record whether a nightly toolchain is installed: `rustup toolchain list`; `cargo udeps` runs only on nightly) |

Record exact availability — Phase 2 uses them tool-first, manual-second.

## Existing abstractions & DI patterns

- Interfaces / type aliases / abstract classes / protocols — search `interface `, `Protocol`, `abstract class`; cite `file:line`.
- Class hierarchies — search `extends `, `implements `, `class ...(...):`; surface base classes with >1 descendant.
- DI: constructor injection (`constructor(private`, `def __init__(self,`, `func New`), containers (NestJS `@Injectable`, InversifyJS, Spring `@Component`), factories, registries.

## Output (write under `### Phase 1: Exploration Results` in `## Research`)

`Project Profile` · `Analysis Tools` (each tool from the table above: available yes/no, with resolved path) · `File Map` (source dirs + counts) · `Existing Abstractions` (interfaces / hierarchies / DI, each `file:line`) · `Conventions` (relevant patterns from AGENTS.md / CLAUDE.md / project skills).

## Gotcha

| Gotcha | Fix |
|---|---|
| Assuming a tool is installed | Confirm it resolves in `node_modules/.bin/` or PATH before Phase 2 relies on it |
| Guessing a test command | Verify it exists in `package.json` scripts / project config |
