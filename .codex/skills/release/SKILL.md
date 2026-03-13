---
name: release
description: Publish the current CodeNexus checkout to the server-wide codenexus command by building and globally linking it, but only when the current branch is main and the worktree is clean.
---

# release

Use this when the user asks to release CodeNexus globally from this checkout.

## Hard Rules

- Run only from branch `main`.
- Run only when the working tree is clean.
- If either precondition fails, stop and report the blocking state. Do not build or link anyway.
- This skill releases to the current machine by updating the global `codenexus` command with `npm link --prefix gitnexus`.
- Do not publish to npm or perform any git workflow as part of `release`.

## Workflow

1. Check branch and cleanliness:
   - `git branch --show-current`
   - `git status --short`
2. If branch is not `main`, stop and report that `release` only runs from `main`.
3. If the worktree is dirty, stop and report that `release` requires a clean tree.
4. Build the package:
   - `npm run build --prefix gitnexus`
5. Install the current checkout globally on the machine:
   - `npm link --prefix gitnexus`
6. Verify the installed command:
   - `which codenexus`
   - `codenexus --version`

## Output Requirements

Always report:
- branch precondition result
- clean-tree precondition result
- build result
- global install result
- final `codenexus` path
- final `codenexus` version
