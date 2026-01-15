# Documentation Generator

Generate and fix documentation: API docs, README, CLAUDE.md, and environment files. Uses Devil's Advocate committee to ensure accuracy and completeness.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

## Phase 0: Environment Check

```bash
# ALWAYS run this first to get the actual current date
date "+%Y-%m-%d"
```

Use this date for any date-related operations. Do NOT assume the year from training data.

## Phase 1: Exploration

First, understand what documentation exists and what's needed.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Find existing documentation (README.md, CLAUDE.md, docs/, etc.)
- Identify the project stack and API framework
- Find API routes/endpoints if applicable
- Check for OpenAPI/Swagger specs
- Identify environment variables used
- Note the documentation style and conventions
- Use $ARGUMENTS to focus on specific docs if provided
</task>
```

## Phase 2: Analysis

### Analyze Documentation Needs

```xml
<task>
Launch a Task agent with model="opus" to analyze gaps:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

Compare existing documentation against the codebase:

**README.md**
- Is the project description accurate?
- Are setup instructions complete and correct?
- Are all dependencies documented?
- Are usage examples provided?
- Is the API documented (if applicable)?

**CLAUDE.md** (for AI assistants)
- Does it explain the project structure?
- Are coding conventions documented?
- Are important patterns explained?
- Are there warnings about gotchas?

**API Documentation**
- Are all endpoints documented?
- Are request/response schemas correct?
- Are authentication requirements explained?
- Are error codes documented?

**Environment Files**
- Is .env.example complete?
- Are all variables documented with descriptions?
- Are defaults provided where appropriate?

Output a gap analysis with specific items to document.
</task>
```

## Phase 3: Committee Discussion

### Round 1 - Proposer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the PROPOSER. Draft the documentation based on the gap analysis.

**For README.md:**
- Project overview (what it does, why it exists)
- Prerequisites and dependencies
- Installation steps (copy-paste ready)
- Configuration guide
- Usage examples with code
- API reference (if small) or link to full docs
- Contributing guidelines (brief)
- License

**For CLAUDE.md:**
- Project structure overview
- Key patterns and conventions
- Important files and their purposes
- Common tasks and how to do them
- Gotchas and warnings
- Testing approach

**For API Documentation:**
- Endpoint list with methods
- Request parameters and body schemas
- Response formats with examples
- Authentication requirements
- Error codes and handling

**For .env.example:**
- All environment variables
- Descriptions as comments
- Safe default values where appropriate

**Quality Guidelines:**
- Be concise but complete
- Use code examples over prose
- Make commands copy-paste ready
- Avoid jargon and assumptions

Output the drafted documentation.
</task>
```

### Round 2 - Critic Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the CRITIC. Review the proposed documentation for accuracy and quality.

**Accuracy Check:**
- Do setup instructions actually work?
- Are code examples correct and runnable?
- Do API schemas match the actual implementation?
- Are environment variables complete?

**Completeness Check:**
- Is anything important missing?
- Are edge cases documented?
- Are error scenarios explained?
- Is troubleshooting guidance provided?

**Quality Check:**
- Is it clear to a newcomer?
- Are there unnecessary words? (AI slop detection)
- Are instructions specific or vague?
- Is the structure logical?

**AI Slop Detection:**
Remove or flag:
- Filler phrases ("It's important to note that...")
- Hedging language ("might", "could possibly")
- Obvious statements ("This function does what it says")
- Marketing speak ("powerful", "robust", "elegant")
- Unnecessary caveats and disclaimers

Output:
**Accuracy Issues** (things that are wrong)
**Missing Content** (things that should be added)
**AI Slop Found** (phrases to remove/rewrite)
**Structural Improvements** (reordering, reformatting)
</task>
```

### Round 3 - Synthesizer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the SYNTHESIZER. Produce the final documentation.

Given proposer's drafts and critic's feedback:

1. **Correct** factual errors
2. **Add** missing information
3. **Remove** AI slop and filler
4. **Improve** structure based on feedback
5. **Verify** all code examples are correct

Output the FINAL DOCUMENTATION for each file:

---
## README.md
[Complete README content]

---
## CLAUDE.md
[Complete CLAUDE.md content]

---
## API Documentation
[API docs in appropriate format]

---
## .env.example
[Environment file with comments]

---

Also note:
- What was improved
- What couldn't be documented (needs more info)
</task>
```

## Phase 4: Implementation

After the committee produces the final documentation:

1. Write/update documentation files using Write/Edit tools
2. For API docs, generate in the appropriate format:
   - OpenAPI/Swagger YAML if that's the project standard
   - Markdown if simpler
   - JSDoc/TSDoc for inline documentation
3. Update .env.example with all variables

## Phase 5: Post-Implementation Verification

### Verifier Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the VERIFIER. Your job is to verify ALL documentation changes against the ACTUAL codebase. This is CRITICAL - documentation must match reality.

1. Run `git diff` to see exactly what was changed
2. For EACH documentation change, verify against SOURCE CODE:

   **API Endpoints:**
   - Find the ACTUAL route definitions (not constants files)
   - Verify paths match exactly (e.g., /api/auth/google/mobile vs /api/auth/google)
   - Check actual request/response types from the handler code
   - Verify authentication requirements from middleware

   **Environment Variables:**
   - Grep for process.env or os.environ usage
   - Verify every documented variable is actually used
   - Check default values match code defaults

   **Setup Instructions:**
   - Verify commands match package.json scripts
   - Check dependency versions are correct
   - Verify file paths exist

   **Code Examples:**
   - Verify function signatures match actual code
   - Check import paths are correct
   - Ensure examples would actually run

3. NEVER trust constants files or type definitions alone - always verify against actual implementations

4. For any change that modifies existing correct documentation:
   - Was the original actually wrong?
   - Or did the committee incorrectly "fix" something that was right?

**Output:**
## Verified Correct
[Changes confirmed against source code]

## ERRORS FOUND - Must Revert
[Changes that contradict actual code, with file:line evidence]
Example: "Changed /api/auth/google/mobile to /api/auth/google but actual route in src/routes/auth.ts:45 is /api/auth/google/mobile"

## Unable to Verify
[Changes that need manual verification]
</task>
```

After verification:
- IMMEDIATELY revert any incorrect changes
- Show user what was reverted and why (with code evidence)
- Only then present final summary of correct changes

## Allowed Tools

```yaml
- Read
- Glob
- Grep
- Task
- Edit
- Write
- Bash(ls:*)
- Bash(git:*)
```

## Usage

```bash
# Generate/fix all documentation
/docs

# Focus on specific documentation
/docs README
/docs API
/docs CLAUDE.md
/docs env
```
