# Correctness lens

This lens reports Bug and Performance findings in changed production code.
In a `panel` round, report no other bucket and write `None.` under `## Spec`.
In a `full` round, this checklist runs next to the other two lens references.

The lists below direct your attention. They do not limit it.
A defect that meets the finding bar and fits this lens counts even when no list names it.

## How to read

- Start from your focus diff. Read each changed function whole, not only its hunk.
- Trace each changed function to its callers and callees. A changed return
  value, error, default, or side effect can break a caller that the diff does not touch.
- Read deleted lines as closely as added lines. A removed check often breaks a
  caller two calls away.
- When the change rejects, drops, reclassifies, or rewrites an input that the
  base accepted, list the forms of that input that the base supports. Compare
  the base and the head for each form.
- Ask what happens on a second run, on an empty input, and when a dependency fails.

## Look for

### Conditions and limits

- Wrong or inverted conditions, wrong operators, and missing cases in a branch or switch.
- Boundary errors: off by one, inclusive against exclusive ranges, zero,
  negative values, and maximum sizes.
- Comparisons across types, units, or letter case, and parsed input with
  trailing whitespace or newlines.
- A limit that the code checks in one path and not in a sibling path.

### Error paths

- An error that the code catches and drops, or turns into success.
- A wrong exit code, or an error message that names the wrong operation or subject.
- Cleanup that the error path skips, and partial output that stays after a failure.
- A retry of an operation that is not idempotent, a retry without a bound, and
  success reported after the last attempt failed.
- Partial failure in a batch: some items apply, the rest are lost, and nothing
  reports the loss.

### State and ordering

- A race between a check and the use of its result, and read-modify-write without a lock.
- A missing `await`, an unhandled rejection, and work that continues after the
  process should stop.
- Code that assumes an order that the API or the event source does not promise.
- Stale state: a cache, a copy, or a variable that a write does not update.
- A state transition that the code allows from a wrong state, and a rerun that
  is not idempotent.

### Empty, null, and timeout states

- A lookup that can return null, undefined, or an empty list, and a caller that
  does not handle that result.
- A missing optional field, environment variable, file, or configuration key.
- A network call, child process, or prompt without a timeout, or a prompt that
  waits forever when no terminal is attached.

### Parsers and formats

- A parser or a regex that reads a format that another tool also reads, such
  as Markdown, YAML, shell or `env` lines, Git or GitHub references, or API
  responses. Name an input that the other tool reads differently: a code
  block, a quote or list marker, emphasis, letter case, a repeated key, or a
  line break inside a match.
- A value that starts with `-` reads as an option. An option can take the
  next word as its value. `--` ends the options only for some tools.
- A rewrite that runs again on its own output must give the same result.
- A compatibility surface that the change renames, changes, or removes: a
  command, flag, exit code, output field, configuration key, environment
  variable, label, or record format that another program, a later run, or an
  old record reads. Also a hint or a message that names a replaced runner or
  setup step.

### Resource bounds (Performance, at most HIGH)

- Unbounded loops, recursion, retries, output, or memory growth.
- Repeated calls or queries inside a loop (N+1), and work that grows faster than the input.
- Synchronous I/O or whole-file reads on a hot path.
- Handles, processes, timers, or listeners that the code does not release.

### Messages and refusals

- A refusal or error that tells the caller to do something that fails again,
  which sends the caller into a loop.
- A refusal that names no next step, which leaves the caller at a dead end.
- A message that does not match the condition that triggers it, or that names a
  flag, command, or file that does not exist.

## With docks installed

When the docks plugin is installed, also read
`skill://code-review/references/perf.md` of the `code-review` skill. Use its
patterns and its severity questions. Keep the output format and the severity
caps of this skill.
