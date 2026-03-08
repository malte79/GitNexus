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
- `npm run lint:docs --prefix gitnexus`
- `npm run check:docs-contracts --prefix gitnexus`

`merge` must not auto-run those gates.
The docs gates remain standalone named requirements even if `$mech` executes them as sub-gates.

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

4. Merge to local default branch
- `git switch <default-branch>`
- `git pull --ff-only origin <default-branch>`
- `git merge --no-ff <working-branch>`

5. Publish
- `git push origin <default-branch>`

## Output Requirements

Always report:
- selected default branch
- clean-tree precondition result
- merge commit SHA
- push status
- final local and remote default-branch state
