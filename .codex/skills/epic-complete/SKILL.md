---
name: epic-complete
description: Mark an epic complete by moving it from planning/epics/doing to planning/epics/done and setting Status: done.
---

# epic-complete

Use this only when the repo is using `planning/epics/`.

Move a doing epic to done.

## Hard Rules

- Only complete epics that are currently in `planning/epics/doing`.
- Preserve epic content unless the user requested specific edits.
- Unless the user explicitly overrides, do not move an epic to `done` while unchecked units remain.

## Steps

1) Locate epic file in `planning/epics/doing`.
2) Check for remaining unchecked units; if any exist, stop and report them unless the user explicitly requested completion anyway.
3) Move it to `planning/epics/done` (`git mv` preferred when tracked).
4) Set `Status: done`.
5) Preserve all other content unless user asks for explicit edits.

## Constraints

- Do not alter checkbox states by default.
- If the epic is missing required header fields or is not in `doing`, stop and report rather than guessing.
