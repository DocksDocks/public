# Blind Comparison: Is the Rewrite Better?

## Contents

- [When to Run It](#when-to-run-it)
- [Roles and Blindness](#roles-and-blindness)
- [Steps](#steps)
- [Judge Prompt](#judge-prompt)
- [Analyzer Prompt](#analyzer-prompt)
- [Deciding](#deciding)
- [Source](#source)

Pointers here name concepts, not coordinates — if a path or symbol moved, trust
the stated purpose and re-locate it (grep the symbol) before acting.

## When to Run It

Run this check when a maintenance edit rewrites instructions (not only paths,
counts, or frontmatter) and someone asks whether the new version works better
than the old one. It is optional. A plain diff answers "what changed"; this
check answers "does an agent do better work with it".

Skip it for mechanical fixes. It costs several fresh agent runs per prompt.

## Roles and Blindness

Every role is a separate agent step. Spawn one omp task subagent per role; a
task subagent gets no conversation history. Each role gets only the
inputs listed below, because a judge that knows which output came from the new
skill tends to favor it.

| Role | Receives | Does not receive |
|---|---|---|
| Runner (one per prompt per version) | One skill version, one prompt | The other version |
| Judge | The prompt, output A, output B, optional expectations | Skill text, transcripts, the A/B mapping |
| Analyzer | Judge result, both skill versions, both transcripts, the A/B mapping | Nothing is hidden; this step is unblinded |

## Steps

1. **Snapshot the baseline.** Copy the pre-edit skill folder (for example from
   the last commit) to a scratch directory outside every skill root. A copy
   inside a skill root loads as a second skill and pollutes both runs.
2. **Pick 2-3 prompts.** Use realistic user requests: the request that exposed
   the problem, plus one ordinary request the skill must still handle. The same
   prompts go to both versions. This is the "baseline check" defined in
   write-skill, with the old version as the baseline.
3. **Run both versions.** For each prompt, run one fresh runner with the old
   skill and one with the new skill. Tell each runner to read the given
   `SKILL.md` path and follow it, then do the task. Keep each output and its
   transcript. Runners do not share a session, so one run cannot leak into the
   other.
4. **Assign labels at random.** Per prompt, decide by coin flip which output is
   A and which is B. Record the mapping in a file the judge does not read. A
   fixed order ("A is always new") lets position bias pass as a result.
5. **Judge blind.** Give the judge the prompt, both outputs, and optional
   expectations (see [Judge Prompt](#judge-prompt)). Keep its result per prompt.
6. **Analyze unblinded.** Give the analyzer the judge result, both skill
   versions, both transcripts, and the mapping (see
   [Analyzer Prompt](#analyzer-prompt)).
7. **Decide** (see [Deciding](#deciding)) and report the per-prompt winners, the
   analyzer's reasons, and the suggestions you applied or rejected.

## Judge Prompt

Adapt this text. It asks for a rubric, scores, and one winner.

```text
You compare two outputs for the same task. You do not know what produced them.
Do not guess; judge only the outputs.

Task prompt: <prompt>
Output A: <path or text>
Output B: <path or text>
Expectations (optional, secondary evidence): <list or "none">

1. Read the task and state what a good output must contain.
2. Build a short rubric with two parts and adapt the criteria names to the task:
   - Content: correctness, completeness, accuracy.
   - Structure: organization, formatting, usability.
3. Score A and B on each criterion from 1 (poor) to 5 (excellent). Cite a
   concrete example from the output for each low score.
4. If expectations are given, mark each pass or fail for A and B. A pass needs
   evidence in the output; the right file name with empty content fails.
5. Pick a winner: rubric first, expectations second. Answer TIE only when the
   outputs are equal in substance. If both fail, pick the one that fails less.

Return: winner (A, B, or TIE), one-paragraph reasoning, the rubric scores, and
the top strengths and weaknesses of each output.
```

The judge must be decisive because a TIE gives the maintainer no signal. Most
pairs differ, even if only a little.

## Analyzer Prompt

```text
A blind judge compared two outputs. Winner: <A|B>. Mapping: <A = old|new>.
Judge result: <path>
Winner skill: <path>   Winner transcript: <path>
Loser skill: <path>    Loser transcript: <path>

1. Summarize what the judge valued in the winning output.
2. Compare the two skill texts: instruction clarity, scripts or tools, examples,
   edge cases.
3. Compare the transcripts: where each agent followed or ignored its skill,
   where the loser went wrong, errors and recoveries.
4. Score instruction following for each transcript from 1 to 10 and list the
   specific misses.
5. Explain why the winner won. Quote the skill line or transcript step that
   caused the difference. Separate causes from incidental differences.
6. List suggestions for the losing skill, ranked high (would likely change the
   outcome), medium (better quality, same outcome), or low. Tag each with one
   category: instructions, tools, examples, error_handling, structure,
   references. Prefer suggestions that help beyond these prompts.
```

## Deciding

| Result across prompts | Action |
|---|---|
| New version wins most prompts | Keep the rewrite; apply high-ranked suggestions that generalize |
| Old version wins most prompts | Revert, or apply the high-ranked suggestions and run the comparison again |
| Mixed or TIE | Read the analyzer causes; keep only the changes that caused a win |

Do not fit the skill to the test prompts. A suggestion that only helps one
prompt adds text that every later session pays for. Two or three prompts show
direction, not statistics; for repeated runs with variance, use a full
benchmark (https://agentskills.io/skill-creation/evaluating-skills).

## Source

Adapted from the blind comparator and post-hoc analyzer agents of Anthropic's
skill-creator (Apache-2.0):

- https://github.com/anthropics/skills/blob/main/skills/skill-creator/agents/comparator.md
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/agents/analyzer.md
- License: https://github.com/anthropics/skills/blob/main/skills/skill-creator/LICENSE.txt

Changes: rewritten in docks wording; JSON output schemas and file layout
removed; random label assignment, baseline snapshot, and omp task subagent
steps added.
