---
name: workspace-hygiene
description: Use when a task creates or ends with worktrees, temporary files or directories, servers, watchers, test runners, containers, clusters, tunnels, scheduled jobs, global installs, or remote test resources, or when disk or memory fills up. Says where to create each resource and how to remove it. Not for git history cleanup or dead-code removal.
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-11-20"
  content_hash: "472135bb8c45b61019e7446cde09b564a55fe64745790d677c6bce350981c224"
---

# Workspace hygiene

<constraint>
Remove only what this task created. Never delete user data, named Docker volumes, or anything outside the classes in this skill. In the main session, ask the user first; in a subagent, list the item in your final report. Every local workstation resource is a development resource. Stop or delete a production resource only after an `ask` in the main session; see Production resources.
</constraint>

## Track what you create

While you work, keep a list of each resource that you create.
For each resource, write its path, id, port, or remote name.

## Resource classes

| Class | Create | Remove | Keep when |
|---|---|---|---|
| Git worktree | `<data>/agent-worktrees/<repo>/<name>`; reuse a worktree of the same branch | `git worktree remove -- <path>`, then `git worktree prune`; one `--force` only after the commits are on the remote and the changes are generated files | its pull request is open |
| Temporary file or directory | a directory from `scratch_new` or `docks-kit scratch new <label>`; each temporary file inside it; never `/tmp` | `scratch_remove`, or `docks-kit scratch remove <path>`; `gio trash` does not work on a `tmpfs` `/tmp` | a later step reads it |
| Test artifacts (coverage, test results, traces, screenshots, videos) | inside the worktree, git-ignored | removed with the worktree; in the user's checkout, `gio trash -- <path>` | the user asked for them |
| Server, watcher, test runner, browser | named bash service or async job; single-run tests | `write proc://<id>/kill`; outside omp, `kill <pid>` | the user asked for it |
| Container or compose stack | `docker run --rm`; `docker compose up` in the worktree; no restart policy | `docker compose down`; `docker stop <id>`; on a remote Docker host, only for a development target; ask first for production | its worktree is kept |
| Docker volume, network, or buildx builder that the task created | only for the task | `docker volume rm`, `docker network rm`, `docker buildx rm` | never |
| Cluster or virtual machine | only on request | the tool's stop or delete command; for a remote cluster, only for a development target; ask first for production | the user asked for it |
| Tunnel or port forward | named bash service | stop the local service; delete a remote tunnel only for a development target; ask first for production | the user asked for it |
| Detached terminal session | do not create | `tmux kill-session -t <name>`, `screen -S <name> -X quit` | never |
| Scheduled job or service | only on request | remove the entry or unit | the user asked for it |
| Global install | only on request | the matching uninstall command | the user asked for it |
| Git stash or local branch | avoid stash; if you must stash, give a unique message with `-m`; one branch per plan | find the short ID that the reminder names with `git stash list --format='%h %gd %gs'`; pop that entry by its `stash@{n}` name, in the worktree where you made it, only when its message is a unique message that you gave with `-m`; otherwise do not pop or drop it, and name it in your final answer; when that worktree is removed, do not pop the entry in another worktree, and name it in your final answer; never apply, pop, or drop a stash entry that you did not create; `git branch -d <branch>` after the merge | the branch has an open pull request |
| Remote test resource (database branch, preview deployment, fork, cloud instance) | only for the task | the provider's delete command, only for a development or preview target; ask first for production | the user asked for it |
| Package or tool cache | never in `/tmp` | do not prune; report the size | always |

## Production resources

- A local workstation resource is always a development resource. This includes worktrees, local compose stacks, local servers and processes, scratch directories, and temporary files and directories. Remove it as this skill says, without an additional question.
- A remote resource is a resource that you reach through SSH or a provider CLI, for example `wrangler`, `vercel`, `netlify`, `fly`, `supabase`, `neonctl`, `pscale`, `kubectl`, or `gh`. A Docker host that `DOCKER_HOST`, `DOCKER_CONTEXT`, or `docker --context` selects is also remote.
- A remote target is a development target only when its name is `local`, `development`, `dev`, `test`, `homolog`, `homologation`, `staging`, or `preview`. Every other target is production.
- Clean up a remote resource with a development target as this skill says.
- Stop, remove, undeploy, or delete a production resource only after an `ask` in the main session immediately before the action. Do this rarely. A yolo run does not answer this ask.
- In a subagent, never clean up a production resource. Name it in your final report.
- Example: `wrangler delete` without `--env` acts on the top-level Worker. That Worker is usually production, so ask first.

## Before your final answer

1. Find each resource of your list in the table.
2. Remove each resource that the task no longer needs. Use the command in the `Remove` column.
3. Name each resource that you keep, and give the reason from the `Keep when` column.

## Find what you cannot see

Run the `tidy_report` tool, or run the report from a shell:

```bash
docks-kit tidy --report
```

Act only on the items that this task created.
Report the other items to the user.

## Plan runs

- For a plan run, follow the Teardown rule in the plan contract of the docks-kit kit plugin (`plan-manager/references/plan-contract.md`). That rule decides when the run stops stacks and processes, removes the linked worktree, deletes the branch, and keeps a resource.

## Automatic sweep

One time in 12 hours, a main session starts `docks-kit tidy --apply`.
The sweep removes merged idle worktrees and their containers.
It stops orphaned processes in agent directories.
It removes scratch directories that are idle for 7 days.
Do not rely on the sweep for a resource that the task can remove itself.

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/public repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
