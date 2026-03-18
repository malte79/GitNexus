---
name: merge
description: Integration and publish workflow that assumes staged review and validation are already completed separately.
---

# merge

Use this workflow for merging to the default branch (`main` preferred, fallback `master`).

## Hard Rule

This skill is integration and publish only.
Required pre-merge gates run separately:
- `codereview` or alias `cr`
- `mech`
- `npm run lint:docs`
- `npm run check:docs-contracts`

`merge` must not auto-run those gates.
The docs gates remain standalone named requirements even if `$mech` executes them as sub-gates.

Every git command in this workflow is stateful and order-dependent.
Run merge commands strictly sequentially.
Do not use parallel tool execution for any dependent git step in this skill.

## Workflow

1. Preconditions
- current branch is not detached HEAD
- branch matches `^codex/.+`
- working tree is clean

2. Resolve default branch
- use `main` if present on origin, otherwise `master`

3. Integrate latest default into working branch
- `git fetch origin <default-branch> --prune`
- `git merge origin/<default-branch>`
- verify current branch is still the working branch
- verify working tree is still clean before continuing

4. Merge to local default branch
- `git switch <default-branch>`
- verify `git branch --show-current` now equals `<default-branch>`
- `git pull --ff-only origin <default-branch>`
- if this fails because local `<default-branch>` is behind or dirty, stop and report it; do not continue with merge or push
- `git merge --no-ff <working-branch>`
- capture the resulting merge commit SHA after the merge completes
- verify working tree is clean before publish

5. Publish
- `git push origin <default-branch>`
- after push, verify the remote default branch SHA matches local `HEAD`

## Execution Discipline

Use this exact sequencing:

1. read branch and status
2. fetch
3. merge latest default into the working branch
4. switch to default branch
5. fast-forward pull default branch
6. merge working branch into default branch
7. push default branch
8. verify local and remote SHAs

Never start `switch`, `pull`, `merge`, or `push` in parallel with each other.
Never report push success from a stale pre-merge process result.

## Output Requirements

Always report:
- selected default branch
- clean-tree precondition result
- whether the working-branch sync step changed anything
- merge commit SHA
- push status
- final local and remote default-branch state
