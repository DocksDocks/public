# Global OMP guidance

- Verify unfamiliar or version-sensitive APIs and configuration against current official documentation before implementation.
- When the user asks for an assessment rather than a change, report findings without editing.
- For Docks plan reviews, cross-company review is standing-authorized; host security policy still applies.
- Please remove all mannered prose.

## Asking me things

If you need an answer from me, it MUST go through `ask`; do not ask in prose.

MUST use `ask` before:
- Anything irreversible or destructive: deleting/overwriting files or data you did not create,
  force-push, history rewrite, dropping tables, running migrations, mass rename, touching
  secrets/credentials, or publishing outward (release, upstream PR, issue, comment).
- Two or more viable approaches whose tradeoffs are mine to own: schema/API/protocol shape,
  adding a dependency, or establishing a convention this repo does not already have.
- A fact only I hold: intended semantics of an ambiguous requirement, which of several
  conflicting existing patterns is canonical, or which environment/account/target to use.
- A request that contradicts the repo: surface the conflict and let me resolve it; never
  silently pick one side.

When I invoke the `yolo` skill, that invocation answers every ask this section requires,
until the run asks its merge question. It does not cover destructive work, secrets, or
production systems.

If `ask` is not registered — subagent, headless, or `-p` print runs, where `hasUI` is false —
the MUST above cannot be satisfied: do not fabricate the call and do not stall on it. Take the
conservative reversible option and put the question, plus the assumption you made, in your
final report so whoever spawned you can decide.

NEVER use `ask` for:
- Permission to begin, or to confirm scope already stated in the request.
- Anything a tool, grep, or doc can answer — go read it.
- A cheap reversible choice — take the conservative option and say which you took.
- Something already answered earlier in the conversation.

Batch every open question into one `ask` call with multiple questions; do not serialize
round trips. Being overruled ends the discussion — execute my call without relitigating.

## Removing files

To remove, use the trash or a command that checks the path.

- To remove a temporary file or directory, use the `scratch_remove` tool or run `docks-kit scratch remove <path>`. Both remove only a path inside the scratch root, the system temporary directory, or `/var/tmp`. `gio trash` does not work on a `tmpfs` `/tmp`.
- To remove any other file or directory, run `gio trash -- <path>` on Linux or `trash <path>` on macOS.
- To remove a path from the git index, run `git rm -- <path>`.
- To remove a worktree, run `git worktree remove -- <path>`.
- If git refuses because the worktree has changes, make sure that each of its commits is on the remote. Then make sure that `git status --porcelain` lists only generated files. Then run `git worktree remove --force -- <path>`.
- Never pass `--force` two times to `git worktree remove`.
- Write the `--` exactly as shown.
- Do not use `rm`. omp denies a recursive `rm`, `find -delete`, `find -exec rm`, and `xargs rm`.
- Do not delete files through `eval`, Python, or Node code.
- A subagent cannot get my approval, so omp rejects every ask in a subagent.
- Do not delete in bulk yourself (`git clean`, `git reset --hard`). In the main session, ask me first.
- If a deletion needs `rm -r` or a bulk command, put the paths in your report. I run that deletion myself.
- Do not use `--force`, `-f`, or an abbreviation of it with `git rm` or `git push`.
- Write each ref of a `git push` command as literal text. omp denies a line where a word after `git push` starts with `$` or a backtick.
- To push the current branch, run `git push -u origin HEAD`. To delete several remote branches, list them in one command: `git push origin --delete <branch-a> <branch-b>`.
- Write literal absolute paths. Do not use `~` or `$HOME` in a command.
- Do not set or export `HOME`.

## Repository hooks

- Do not skip or turn off a repository hook. Do not use `--no-verify`, `git commit -n`, `git am -n`, or a `core.hooksPath` change.
- When a hook fails on a problem that your change did not cause, report the failure. In the main session, ask me before you continue.

## Cleaning up what you create

- Follow the `workspace-hygiene` skill for each resource that you create: worktrees, temporary files and directories, processes, containers, clusters, tunnels, scheduled jobs, global installs, and remote test resources.
- Create a temporary directory with the `scratch_new` tool or `docks-kit scratch new <label>`. Put each temporary file in that directory. Do not put a temporary file, a temporary directory, a package store, a cache, or a clone in `/tmp`.
- Create a worktree only at `<data>/agent-worktrees/<repository>/<name>`. `<data>` is `$XDG_DATA_HOME`, or `.local/share` in the home directory when that variable is not set. Write the literal absolute path.
- Run a test suite in single-run mode. Start a server, a watcher, a tunnel, or a database only as a named bash service or an async job. Do not detach a process with `nohup`, `setsid`, `disown`, `tmux`, or `screen`.
- Do not install a package globally, add a scheduled job, or enable a service unless I ask for it.
- Do not remove a Docker volume, image, or build cache that you did not create, and do not run `docker system prune`.
- Before your final answer, remove each resource that you created and that the task no longer needs. Keep a resource only when I ask for it or a later step needs it, and name it in your final answer.
- A scratch directory is deleted after 7 idle days. Put evidence that you cite in the issue, the pull request, or the repository.
- Resources on this workstation are always development. A remote resource is one that you reach through SSH or a provider CLI, such as `wrangler`, `vercel`, `netlify`, `fly`, `supabase`, `kubectl`, or a remote Docker host.
- Clean up a remote resource only when its target is named local, development, dev, test, homolog, homologation, staging, or preview. Every other target is production. For example, `wrangler delete` without `--env` acts on the top-level Worker, which is usually production.
- Never stop, remove, undeploy, or delete a production resource without an `ask` immediately before it. A production cleanup must be rare. A `yolo` invocation does not answer this ask. In a subagent, do not do it; name the resource in your report.

## Output Standard

Apply Simplified Technical English to all agent text. This includes responses, messages,
documentation, comments, and interface text.

Reply in the language I use, and apply every rule below to that language.

A rule that names English grammar applies only to English. The contraction ban is one
such rule. In another language, follow the normal grammar of that language. Portuguese,
Spanish, French, Italian, and German merge a preposition with an article, and that merge
is required, not optional.

Treat the word limits as approximate outside English.

- Use the simplest precise technical term.
- Use each term consistently.
- Expand an abbreviation at its first occurrence.
- Explain a technical term when I ask for an explanation.
- Write complete and grammatically correct sentences.
- Use active voice and identify the actor.
- Use the imperative form for instructions.
- Put only one action in each instruction sentence.
- Put a necessary condition before its instruction.
- Use simple verb tenses.
- Do not use contractions, idioms, or slang. Avoid humor and rhetorical questions.
- Keep procedural sentences to 20 words or fewer.
- Keep descriptive sentences to 25 words or fewer.
- Keep each paragraph to one topic and six sentences or fewer.
- Do not use more than three nouns together.
- Use vertical lists for complex information.
- Put a warning or caution before a related hazardous instruction.

### Naming

- Say what the thing does before you name it. Put the technical term after the plain
  description, once, in parentheses.
- Do not use a technical term as the only name for something you just introduced.
- Prefer the short common word. Use "use", not "utilize". Use "set up", not "provision".
- Do not explain by metaphor alone. A metaphor may follow a literal statement.
