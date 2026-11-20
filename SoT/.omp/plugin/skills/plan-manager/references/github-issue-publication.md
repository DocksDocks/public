# GitHub issue publication

Read [the canonical contract](plan-contract.md) for commands, review trust,
linked-branch setup, and landing policy. This reference covers publication
preflight only.

## Preflight

Before creating a plan issue:

1. Confirm `gh auth status` succeeds.
2. Confirm the checkout has a GitHub remote.
3. Resolve the target with
   `gh repo view --json nameWithOwner,visibility,defaultBranchRef`.

A failed preflight creates no issue. The settled plan mode authorizes routine
plan creation, updates, and unchanged reviewer-comment publication in the
resolved repository. Do not ask again for an already resolved repository.

## Ask boundaries

Ask before writing when the repository is ambiguous or contradicts the user's
target. Also ask before public disclosure of a vulnerability, credential
location, or other sensitive finding. State what will become public.

If an applicable safeguard cannot be answered, report the blocker and publish
nothing. Never substitute a tracked plan file or disclose sensitive content
speculatively. With no safeguard outstanding, proceed under the settled mode.

## Review publication

The manager posts the whole blocks of one review round unchanged in one issue
comment, in the order that the contract gives for a panel round.
Use fresh review inputs and the review loop in the contract (Phases and review comments). Review comments
are evidence, not authorization to merge. Follow the canonical contract for
trusted verdict selection and the separate fresh merge ask.

## BAD / GOOD

```text
BAD: Ask for a repository picker after preflight resolved the target.
GOOD: Publish to the resolved repository under the settled mode.

BAD: Publish a sensitive public issue because planning was authorized.
GOOD: Ask explicitly about the sensitive disclosure before writing.
```
