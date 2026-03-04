# Instructions

## Critical Rules
- NEVER use TypeScript `any`. Use `unknown` + type guards or generics.
- NEVER swallow exceptions. Handle or propagate all errors explicitly.
- NEVER write custom CSS. Use Tailwind utility classes only.
- NEVER amend commits unless explicitly asked. Always create new commits.
- NEVER force-push to main/master.

## Code
- Use early returns. Max 2 levels of nesting.
- Keep functions single-purpose. Extract when doing more than one thing.
- Use dependency injection. No hardcoded concrete dependencies in business logic.
- Prefer composition over inheritance.
- Write self-documenting code. Only comment non-obvious "why", never "what".

## TypeScript
- Strict mode always. No type assertions unless provably safe.
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Use `const` assertions and discriminated unions over enums.

## Frontend
- Use shadcn/ui + Tailwind CSS for all UI.
- Solo projects: Next.js (App Router).
- WordPress plugins: React + Vite + Tailwind v4.

## Mobile
- Use Expo + UniWind.

## Git
- Imperative mood, max 72 char title.
- Branches: feature/, fix/, chore/, docs/

## Communication
- Be direct and concise. Skip pleasantries.
- Do not explain basic concepts unless asked.
- Recommend one choice with reasoning. Use tables for comparisons.

## Verification
- After code changes: run the project's test/lint command if one exists.
- After config edits: validate JSON/YAML syntax.
- Before committing: review changes with `git diff`.
- Use Context7 MCP to verify library APIs before implementing unfamiliar packages.

## Compaction
When context is compacted, preserve:
- Current task description and acceptance criteria
- All files modified and key decisions made
- Active blockers or open questions
- Test/build command for the current project
