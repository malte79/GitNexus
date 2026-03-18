---
name: epic-assign
description: Assign an epic by moving it from planning/epics/backlog to planning/epics/doing, setting ownership, and setting Status: doing.
---

# epic-assign

Use this only when the repo is using `planning/epics/`.

Move a backlog epic to doing and assign ownership.

## Hard Rules

- Only assign epics that are currently in `planning/epics/backlog`.
- Preserve epic content and checkbox states.
- Do not silently repair unrelated epic content while assigning.
- Default owner remains lane-derived unless the user explicitly provides another owner.
- When the epic is assigned to the current agent, create and switch to a dedicated `codex/` branch for that epic unless the current branch is already the active branch for it.
- Prefer `codex/epic-<epic-slug>` for the branch name.
- If local uncommitted changes carry onto the new branch, report that explicitly.

## Steps

1) Locate epic in `planning/epics/backlog`.
2) Move it to `planning/epics/doing` (`git mv` preferred when tracked).
3) Derive the lane id `<n>` from repo directory `rsproxy-agent-<n>` and set `Assigned to: Agent <n>` unless user provides a different owner.
4) Set `Status: doing`.
5) If the final assignee is the current agent, create and switch to a dedicated `codex/epic-<epic-slug>` branch unless already on that epic's active branch.
6) Verify required header fields still exist after the move.
7) Preserve all other content and checkbox states.

Example:
- repo path: `/Users/alex/Projects/roblox/rsproxy-agent-1`
- default assignee: `Agent 1`

## Constraints

- Do not modify milestone/unit content.
- Do not mark items done.
- Do not create a new branch when the epic is assigned to someone else.
- If the epic is missing required header fields or is already in `doing`/`done`, stop and report rather than guessing.
