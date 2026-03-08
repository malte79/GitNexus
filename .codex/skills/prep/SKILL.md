---
name: prep
description: Prepare the current branch by creating a high-quality commit message that reflects local work, committing all local changes, then fetching and merging origin default branch.
---

# prep

Use this when asked to prepare or sync the current branch.

## Hard Rules

- Do only this sequence:
  - stage and commit all local changes with a clear message that reflects the work performed
  - fetch latest origin default branch (`main` preferred, fallback `master`)
  - merge origin default branch into current branch
- Do not run unrelated workflows or git operations.
- Do not treat `prep` as a substitute for required validation gates documented elsewhere in the repo workflow.

## Workflow

1. Confirm branch and local status.
2. `git add -A`
3. If staged diff is non-empty, create one commit with a specific message that summarizes the actual implementation and tests or docs touched.
4. If there are no staged changes after `git add -A`, report "no local changes to commit" and continue.
5. Resolve default branch (`main` then `master`).
6. `git fetch origin <default-branch> --prune`
7. `git merge origin/<default-branch>`
8. Report commit result, merge result, and final status.

## Conflict Handling

- If merge conflicts occur, stop and report conflicted files.
