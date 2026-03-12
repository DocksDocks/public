# Comprehensive improvements for a Claude Code multi-agent configuration kit

**Your 8-command pipeline is already well-architected.** The Builder-Verifier pattern, DAG fan-out/fan-in parallelism, and Plan Mode with approval gates align with Anthropic's own recommended agentic patterns. But research across official documentation, academic papers, competing frameworks, and production deployments reveals **high-impact improvements** in every priority area — from multi-dimensional verification that catches issues your single verifier misses, to a three-tier progressive disclosure system that can cut context loading by 62% while improving agent grounding. What follows are specific, implementable recommendations drawn from Anthropic's engineering blog, the Codified Context paper (arXiv 2602.20478), SWE-Pruner research, and patterns proven at scale in Cursor, OpenHands, and Aider.

---

## Priority 1: Improving output quality and accuracy of agents

Output quality is fundamentally a function of three things: how well agents understand their task, how effectively they verify their work, and how gracefully they recover from errors. Your current Builder-Verifier pattern handles the middle concern. The recommendations below address all three.

### Structured delegation prompts are the highest-leverage fix

Anthropic's production multi-agent research system found that **without detailed delegation descriptions, "agents duplicate work, leave gaps, or fail to find necessary information."** Every Task tool invocation in your 8 commands should include five elements: an objective, expected output format, relevant file paths, explicit constraints, and success criteria. The parent-to-subagent channel is *only* the prompt string — subagents start with zero context. This means vague prompts like "review this code for issues" waste the subagent's entire exploration phase on context gathering rather than analysis.

Concrete improvement for your `/review` command's analyzer prompt:

```markdown
## Task: Analyze $FILE for code quality issues

### Objective
Identify concrete bugs, logic errors, and maintainability issues in the specified file.

### Context
- Project uses TypeScript 5.7 strict mode with ESM imports
- Read @.claude/context-tree/architecture.md for system patterns
- This file belongs to the $MODULE module (see @.claude/context-tree/$MODULE.md)

### Output Format
Return a JSON array of findings, each with:
- `severity`: critical | warning | info
- `line`: line number or range
- `issue`: one-sentence description
- `fix`: concrete code suggestion
- `confidence`: high | medium | low

### Constraints
- Do NOT flag style issues (handled by linters)
- Do NOT suggest refactors unless they fix a bug
- Verify all imports exist in the actual project before flagging missing ones
- Check function signatures against real codebase, not assumptions

### Success Criteria
Zero false positives on import/type checking (verify by reading actual files)
```

### Multi-dimensional parallel verification catches what single verifiers miss

Your current pattern runs one Verifier after a Builder. Research shows **fan-out verification across specialized dimensions** dramatically improves catch rates. An LLM code reviewer detects 89-96% of vulnerabilities at baseline, but different review focuses surface different issue classes.

For your `/security` command, replace the single synthesizer with parallel specialized verifiers:

```
Phase 1 (existing): scanner + analyzer + hunter → findings
Phase 2 (new): parallel verification fan-out
  ├── Correctness Verifier: Are the findings real? (read actual code, verify line numbers)
  ├── Completeness Verifier: What did Phase 1 miss? (check OWASP top 10 coverage)
  └── Priority Verifier: Are severities accurately assigned? (check exploitability)
Phase 3: Synthesizer merges verified findings with confidence scores
```

This pattern applies to `/review`, `/test`, and `/solid` as well — each benefits from **at least two orthogonal verification dimensions** running in parallel.

### The Evaluator-Optimizer loop adds iterative refinement

Anthropic explicitly recommends this pattern "when clear evaluation criteria exist and iterative refinement provides measurable value." Add a bounded feedback loop (2-3 iterations maximum) to your Builder-Verifier pattern:

```
Builder generates output
  → Evaluator scores against rubric (0-10 on correctness, completeness, style)
  → If score < 7: specific feedback → Builder revises → re-evaluate
  → If score ≥ 7 OR max iterations reached: pass to Verifier for concrete checks
  → Verifier runs deterministic tests (lint, typecheck, test execution)
```

The key insight from academic research: **cap iterations at 2-3 rounds and track improvement per iteration**. If the score doesn't improve between rounds, stop early — the agent has plateaued. The DebateCoder framework achieved **70.12% Pass@1** using this approach while reducing API overhead by 35%.

### Test-first verification grounds implementation in concrete criteria

Builder.io's Micro Agent pattern demonstrates that **LLMs are much more reliable at generating tests than generating implementation code**. For your `/test` command, invert the current flow:

```
Current:  analyzer → generator (code) → verifier
Improved: analyzer → test-generator (tests first) → implementer (code to pass tests) → verifier
```

Having concrete test cases *before* implementation provides the Builder agent with unambiguous success criteria. This approach showed the most consistent quality improvements across all surveyed frameworks.

### Extended thinking mode improves planning quality

Enable extended thinking during Plan Mode phases across all 8 commands. Anthropic's research found this improved **instruction-following, reasoning, and efficiency** simultaneously. Set in your settings.json:

```json
{
  "env": {
    "MAX_THINKING_TOKENS": "16000"
  }
}
```

For commands that use Plan Mode with approval gates (your standard pattern), extended thinking acts as a controllable scratchpad where the agent can reason about approach before committing to a plan. The `alwaysThinkingEnabled` setting can also be set to `true` globally.

### Filesystem-based context passing eliminates the telephone game

Anthropic's multi-agent research system discovered that passing context between agents through prompt strings creates a "game of telephone" where information degrades at each handoff. Their solution: **subagents write outputs to the filesystem and pass lightweight references back** to the orchestrator.

For your DAG pipelines, implement this pattern:

```markdown
# In your /security command's scanner agent prompt:
Write your findings to .claude/pipeline-output/security-scan.json
Use this exact schema: { findings: [{ file, line, type, severity, description }] }

# In your synthesizer agent prompt:
Read scanner results from .claude/pipeline-output/security-scan.json
Read analyzer results from .claude/pipeline-output/security-analysis.json
Read hunter results from .claude/pipeline-output/security-hunt.json
Synthesize into a unified report at .claude/pipeline-output/security-report.md
```

This approach avoids context degradation, enables larger data transfer between agents (not limited by prompt size), and creates an auditable trail of pipeline execution.

### Anti-hallucination checklist for every Verifier agent

Research shows ~20% of AI-recommended packages don't exist and LLM agents trust their own generated identifiers absolutely. Every Verifier agent in your pipeline should execute these concrete checks:

- Verify all imports exist in the actual project (read `package.json` or equivalent)
- Check function signatures against real codebase files (not assumptions)
- Validate file paths mentioned in output (use `ls` or `glob`)
- Run syntax checking or compilation on generated code
- Execute the test suite against generated code
- Cross-reference API calls with actual library documentation (leverage your Context7 MCP)
- Flag any package names not found in the lockfile

Embed this checklist directly in Verifier prompts as mandatory steps, not optional suggestions.

---

## Priority 2: Better context tree and agent grounding

Your B-tree-inspired context tree is architecturally sound. Research from the Codified Context paper (283 development sessions on a 108,000-line codebase), MemTree, RAPTOR, and production deployments at scale all validate hierarchical context as superior to flat files. The improvements below sharpen the implementation.

### Three-tier progressive disclosure is the proven architecture

Multiple independent sources converge on exactly three tiers. The optimal structure for your `/docs` command to bootstrap:

**Tier 1 — Root (always loaded, ~500-1,500 tokens).** This is your project's "constitution" — loaded at every session start, survives compaction, cached by the API. It should contain the tech stack, core architecture, directory structure overview as a navigational map, a trigger table mapping keywords to which Tier 2 nodes to load, and critical constraints ("never do X"). Research shows files under **200 lines achieve >92% rule application rate** versus 71% beyond 400 lines. Keep this brutally concise.

**Tier 2 — Branch nodes (path-scoped, auto-loaded, ~500-2,000 tokens each).** These correspond to modules or subsystems. Claude Code's path-scoped rules (`.claude/rules/` with `paths:` frontmatter) already implement this pattern natively — when the agent touches files in a directory, matching rules auto-load. Each branch node should describe the module's purpose, key patterns, dependencies, and pointers to Tier 3 leaf nodes.

**Tier 3 — Leaf nodes (on-demand, lazy-loaded, up to 5,000 tokens).** Detailed specifications, API contracts, implementation patterns. Loaded only when the agent explicitly needs them for a task. Use Claude Code's Skills system for LLM-decided lazy loading — the agent reads descriptions and loads full content only when relevant.

```
.claude/
├── context-tree/
│   ├── ROOT.md                    # Tier 1: always loaded (~150 lines)
│   ├── architecture/
│   │   ├── BRANCH.md              # Tier 2: system architecture overview
│   │   ├── api-contracts.md       # Tier 3: detailed API specs
│   │   └── data-model.md          # Tier 3: schema documentation
│   ├── auth/
│   │   ├── BRANCH.md              # Tier 2: auth module patterns
│   │   ├── oauth-flow.md          # Tier 3: OAuth implementation details
│   │   └── permissions.md         # Tier 3: RBAC model
│   └── testing/
│       ├── BRANCH.md              # Tier 2: testing conventions
│       └── fixtures.md            # Tier 3: test data patterns
├── rules/
│   ├── typescript.md              # Path-scoped: loads for *.ts files
│   └── api-routes.md              # Path-scoped: loads for routes/**
└── skills/
    └── context-loader/
        └── SKILL.md               # Agent-decided: loads context tree nodes
```

### Write context files for agents, not humans

The Codified Context paper found this to be a critical distinction. Agent-optimized context files include **file paths, function names, explicit do/don't instructions, and concrete code examples** — not narrative prose, not architectural philosophy. Compare:

**Human-optimized (bad for agents):**
> "Our authentication system follows industry best practices with a layered approach to security. We use JWT tokens for stateless session management, which provides scalability benefits..."

**Agent-optimized (good):**
```markdown
# Auth Module — src/auth/
## Key Files
- src/auth/jwt.ts — token creation/validation, uses jose library
- src/auth/middleware.ts — Express middleware, attaches user to req
- src/auth/guards.ts — role-based access control decorators

## Patterns
- Token expiry: 15min access, 7d refresh (set in src/config/auth.ts)
- Always use `verifyToken()` from jwt.ts, never raw jose calls
- Guards use decorator pattern: @RequireRole('admin')

## Do NOT
- Store tokens in localStorage (use httpOnly cookies)
- Import jose directly (use wrapper in jwt.ts)
- Modify token payload schema without migration
```

### Staleness detection prevents silent failures

Agents trust documentation absolutely. When a context file describes an API that changed three months ago, the agent generates code against the old API and the error manifests as a subtle runtime bug — not an obvious compilation failure. Implement these detection strategies:

**Git-based freshness tracking** via a hook or the `/docs` command: compare when context files were last modified versus when their associated code files changed. If `src/auth/` has 15 commits since `context-tree/auth/BRANCH.md` was updated, flag it.

**30-day staleness flag**: HAM (Hierarchical Agent Memory) auto-flags any context file not updated in 30 days for review. Implement this as a SessionStart hook:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "find .claude/context-tree -name '*.md' -mtime +30 -exec echo 'STALE: {}' \\;"
        }]
      }
    ]
  }
}
```

**Agent confusion as diagnostic signal**: when agents make errors in a subsystem, it often means the corresponding context is missing or stale. Track patterns across sessions using Claude Code's auto-memory.

### Repository map provides codebase awareness at minimal token cost

Aider's repository map concept — a lightweight structural map of function signatures and file structures — provides codebase awareness without full-file token cost. Your `/docs` bootstrap command should generate one:

```markdown
# Repository Map (auto-generated, do not edit manually)
## src/
├── auth/jwt.ts — verifyToken(), createToken(), refreshToken()
├── auth/middleware.ts — authMiddleware(), requireRole()
├── api/routes/users.ts — GET /, POST /, GET /:id, PUT /:id
├── api/routes/orders.ts — GET /, POST /, GET /:id
├── services/email.ts — sendVerification(), sendReset(), sendNotification()
└── db/models/ — User, Order, Product, Session (Prisma models)
```

This map can be auto-generated using tree-sitter or a simple AST parser. Include it in Tier 1 (always loaded) at **~200-500 tokens** — a fraction of what full file reading costs. Every subagent in your pipeline then knows where to look without burning tokens exploring.

### Loading order and prompt caching alignment

Structure your context tree so **the most stable, highest-level context appears first** in the prompt. This maximizes prompt cache hits (cached tokens cost 10% of normal input). The optimal loading sequence:

1. Root context (Tier 1) — most stable, always first → cached
2. Path-scoped rules — stable, loads second → often cached
3. Branch context (Tier 2) — moderately stable → partially cached
4. Task-specific context (Tier 3) — changes per task → rarely cached
5. Current conversation — most dynamic → never cached

### B-tree-specific optimizations for your system

Your B-tree metaphor provides natural structural advantages worth exploiting:

- **Balanced depth of 3-4 levels maximum** (Root → Domain → Module → Detail). Deeper trees increase traversal cost for both the agent and tokens.
- **Node splitting**: when a context file exceeds its ~2,000 token budget, split it into child nodes — exactly like B-tree node splitting on overflow. Your `/docs` command should detect and recommend splits.
- **Minimum fill**: ensure each node has sufficient content to justify loading overhead. Near-empty context files waste the fixed cost of a file read.
- **Ordered naming conventions**: consistent prefixes (e.g., `BRANCH.md` for branch nodes, `ROOT.md` for root) enable agents to predict where context lives without searching.

---

## Priority 3: General improvements across the system

### Migrate from raw slash commands to the Skills system

Claude Code's Skills (`.claude/skills/` with `SKILL.md`) supersede raw `.claude/commands/` files with three key advantages: supporting files directories for templates and examples, auto-loading when Claude detects relevance based on the description, and progressive disclosure where metadata loads at startup but full content loads on-demand. Your 8 commands should be restructured:

```yaml
# .claude/skills/security-scan/SKILL.md
---
name: security-scan
description: Run comprehensive security vulnerability analysis across the codebase
context: fork
agent: general-purpose
allowed-tools: Bash, Read, Grep, Glob, Write
model: claude-opus-4-6
---
# Security Scanner Pipeline
...pipeline prompt here...
```

The `context: fork` setting runs the skill in a subagent context, preventing pipeline state from polluting the main conversation. The `agent:` field lets you specify custom subagent types from `.claude/agents/`.

### Create custom subagent types for your pipeline roles

Define reusable agent types in `.claude/agents/` that your commands reference:

```yaml
# .claude/agents/verifier.yaml
---
name: verifier
description: Runs concrete verification checks on code output
tools: Bash, Read, Grep, Glob
model: sonnet
color: red
memory: project
---
# Verification Agent
You are a strict code verifier. You ONLY check concrete, verifiable properties.
You NEVER approve based on "looks good" — you run actual checks.

## Mandatory Verification Steps
1. Read every file mentioned in the output
2. Verify all imports resolve to real packages
3. Run syntax/type checking if available
4. Execute test suites against changed code
5. Check for security anti-patterns

## Output Format
Return JSON: { "passed": boolean, "checks": [...], "failures": [...] }
```

This creates a `verifier` agent type that all 8 commands can reference, ensuring consistent verification quality.

### Hook architecture for pipeline automation

Your hooks configuration should enforce deterministic quality gates that don't rely on LLM compliance. Key hooks to implement:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [{
          "type": "command",
          "command": "jq -r '.tool_input.file_path' | xargs -I{} sh -c 'if echo \"{}\" | grep -qE \"\\.(ts|tsx)$\"; then npx prettier --write \"{}\" && npx tsc --noEmit \"{}\"; fi'"
        }]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "echo '{\"hookSpecificOutput\":{\"additionalContext\":\"Pipeline stage complete. Check .claude/pipeline-output/ for results.\"}}'"
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "jq -r '.tool_input.command' | grep -qE '(rm -rf /|DROP TABLE|DELETE FROM.*WHERE 1)' && echo '{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Dangerous destructive command blocked\"}}' || true"
        }]
      }
    ]
  }
}
```

The **SubagentStop hook** is particularly valuable for your DAG pipelines — it fires when any subagent finishes, enabling automatic pipeline progression without polling. PubNub's production system uses this pattern for multi-stage agent workflows.

### Settings.json optimization for the full kit

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run lint)", "Bash(npm run test *)", "Bash(npm run build)",
      "Bash(npx prettier *)", "Bash(npx tsc *)",
      "Read(.claude/**)", "Read(src/**)"
    ],
    "deny": [
      "Read(.env)", "Read(.env.*)", "Read(secrets/**)",
      "Bash(curl *)", "Bash(wget *)"
    ],
    "defaultMode": "default"
  },
  "env": {
    "MAX_THINKING_TOKENS": "16000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "60",
    "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": "1"
  },
  "hooks": { }
}
```

Key settings rationale: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` at 60 triggers compaction earlier, preserving more useful context for long pipeline runs. `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` prevents agents from getting lost in directory navigation. Pre-allowing lint, test, and build commands eliminates permission prompt interruptions during verification phases.

### Leverage MCP Tool Search for context efficiency

With 6 plugins enabled (agent-sdk-dev, commit-commands, code-review, n8n-mcp-skills, context7, frontend-design), each MCP server's tool definitions consume context window space. Claude Code's **MCP Tool Search** feature enables lazy loading — tools are discovered on-demand rather than loaded upfront, reducing context usage by up to **95%** for MCP definitions. Enable this in settings and configure `tool-search-threshold` to control when lazy loading activates.

For your Context7 integration specifically, add a rule that automatically invokes it on library questions:

```markdown
# In CLAUDE.md
When encountering code questions about external libraries, use context7's
resolve-library-id and query-docs tools to get current documentation
before generating code. Never rely on training data for API signatures.
```

### Patterns worth borrowing from competing frameworks

Three patterns from other frameworks would significantly improve your system:

**Aider's repository map** (described in Priority 2) provides structural awareness at ~200 tokens instead of thousands. Generate and maintain one automatically.

**SWE-agent's reproduction-first pattern**: for your `/fix` command, always reproduce the bug before attempting fixes. Add a reproduction step before the scanner phase:

```
reproducer → scanner + dependency → planner → implementer → verifier
```

**OpenHands' condenser system**: between pipeline phases, automatically summarize completed phase outputs before passing to the next phase. This prevents context from ballooning in long pipelines. Implement as a utility agent that compresses Phase 1 results into a structured summary before Phase 2 begins.

### Agent Teams for complex parallel workflows

Claude Code's experimental Agent Teams feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) enables peer-to-peer communication between agents — workers claim tasks from a shared TaskList and communicate via inbox messages. For your `/security` command's parallel scanner+analyzer+hunter phase, this could replace the current fan-out/fan-in with dynamic work distribution where agents share findings in real-time rather than waiting for synthesis. Note this is experimental and uses approximately **7x more tokens** than standard sessions.

---

## Priority 4: Reducing token consumption per run

### RTK integration is the single biggest token saver

RTK (Rust Token Killer) achieves **60-90% reduction** on CLI output — your pipeline's heaviest token consumer. Real-world measurements show `cargo test` output dropping from 155 lines to 3 lines (98% reduction), and cumulative savings of ~89% over two weeks of use.

Installation and integration:

```bash
cargo install --git https://github.com/rtk-ai/rtk
rtk init --global
```

RTK registers as a PreToolUse hook that transparently rewrites bash commands (e.g., `git status` → `rtk git status`). Claude never sees the rewrite. Overhead is under **10ms per command** (single-threaded Rust). This is the highest-ROI token optimization available.

### Model selection strategy saves 60% on routine tasks

Not every agent in your pipeline needs Opus. Implement a tiered model strategy:

| Agent Role | Recommended Model | Rationale |
|---|---|---|
| Planning agents | `opus` | Complex reasoning, architecture decisions |
| Builder agents | `opus` | Code generation quality matters most |
| Explore/scan agents | `sonnet` | Reading and categorizing, not creating |
| Verifier agents | `sonnet` | Running concrete checks, not reasoning |
| Synthesizer agents | `sonnet` | Summarizing findings, structured output |
| Quick lookups | `haiku` | File finding, simple grep patterns |

Set per-command via frontmatter `model:` field, or per-subagent in Task tool invocations. The global default should be `sonnet` with Opus reserved for the agents where quality matters most. Use the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable to set a default subagent model.

### Tiered CLAUDE.md loading achieves 62% context reduction

The Codified Context paper measured this directly: moving from a monolithic CLAUDE.md to a three-tier system reduced per-session context loading from **2,100 tokens (14-28% relevant)** to **800 tokens (~85% relevant)**. The structure from Priority 2's context tree recommendation directly enables this.

Anthropic's own guidance: files under **200 lines** achieve >92% rule application rate. Beyond 400 lines, application drops to 71%. Your root CLAUDE.md should be under 150 lines.

### Autocompaction tuning for pipeline workloads

Pipeline commands consume context faster than interactive sessions because multiple agent responses accumulate. Configure aggressive compaction:

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  }
}
```

Setting this to 50% triggers compaction at half capacity rather than the default 64-75%. For pipeline commands specifically, add `/compact` instructions between phases in your command prompts: "After Phase 1 completes and results are written to files, compact context before proceeding to Phase 2."

Manual compaction with custom instructions is powerful: `/compact only keep the names of files modified and the current pipeline state` preserves what matters while aggressively pruning exploration artifacts.

### Subagent delegation isolates verbose output

Each subagent runs in its own **separate 200K context window**. Only the final summary returns to the parent. This means a subagent that reads 50 files and processes 100K tokens of code returns only its ~2K token summary. Exploit this by delegating all verbose operations to subagents:

```markdown
# In CLAUDE.md
## Token Efficiency Rules
- Delegate exploration of 3+ files to Explore subagents
- Run test suites via subagents, return only pass/fail + failure details
- For code reviews, launch parallel subagents per module
- Never read large files (>500 lines) in the main context — use subagents
```

### Disable unused MCP servers and use .claudeignore

Run `/context` to see exactly how many tokens each component consumes. Each enabled MCP server adds tool definitions to the context window. Disable servers you're not actively using with `@server-name disable` or via `/mcp`.

Maintain a thorough `.claudeignore`:

```
node_modules/
dist/
build/
*.lock
*.min.js
*.min.css
target/
__pycache__/
.next/
coverage/
*.map
```

This prevents Claude from reading build artifacts, lockfiles, and generated code — files that can easily consume tens of thousands of tokens with zero analytical value.

### Observation masking via hooks compresses tool output

JetBrains research (NeurIPS 2025) found observation masking — selectively hiding parts of tool outputs — achieves a **2.6% solve rate boost** while being **52% cheaper**. Implement via PostToolUse hooks that filter verbose output:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "jq -r '.tool_result.stdout' | head -100 | jq -Rs '{hookSpecificOutput: {additionalContext: (\"Truncated output (first 100 lines):\\n\" + .)}}'  2>/dev/null || true"
        }]
      }
    ]
  }
}
```

This truncates bash output to 100 lines, preventing a single `npm test` or `cargo build` from consuming 10K+ tokens of raw output. RTK handles this more elegantly for common commands, but custom hooks catch edge cases.

---

## Conclusion: a prioritized implementation roadmap

The improvements above compound. Structured delegation prompts (Priority 1) improve output quality immediately with zero infrastructure changes. The three-tier context tree (Priority 2) provides the grounding foundation that makes every other improvement more effective. Skills migration and hook automation (Priority 3) reduce friction and enforce consistency. RTK plus model tiering (Priority 4) cut costs by 40-60% without sacrificing quality.

**Start with these three changes for maximum immediate impact**: First, rewrite your Task tool prompts to include the five-element structure (objective, format, context, constraints, success criteria) — this alone addresses the most common cause of agent quality issues. Second, install RTK globally — 10 minutes of setup for 60-90% token savings on CLI output. Third, add a PostToolUse hook for automatic formatting after edits — this eliminates an entire class of style issues from your Verifier's workload.

The deeper architectural changes — context tree restructuring, Skills migration, multi-dimensional verification, evaluator-optimizer loops — can be implemented incrementally. Each builds on the previous, and the context tree's progressive disclosure system naturally supports gradual expansion. The key insight from Anthropic's own production system applies directly: **most agent failures are context failures, not model failures**. Getting the right information to the right agent at the right time is the single most impactful investment you can make in pipeline quality.