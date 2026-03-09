---
name: epic-insert
description: Insert new work unit(s) into an epic after a specified unit and renumber subsequent units in the same milestone.
---

# epic-insert

Insert new work unit(s) after a specified unit in an epic file and shift following unit numbers in the same milestone.

## Hard Rules

- Insert only the requested scope; do not rewrite unrelated milestones.
- New units must match the epic's existing structure and remain implementation-ready.
- Preserve assignment, lane, status, and unrelated checkbox states.
- Keep the milestone closeout unit last after renumbering.

## Steps

1) Open target epic under `planning/epics/backlog`, `planning/epics/doing`, or `planning/epics/done`.
2) Locate insertion unit (for example `105`) and milestone block.
3) Insert new unit(s) immediately after target unit.
4) Renumber following non-closeout units in the same milestone by `+N`.
5) Keep closeout as milestone-final unit and update its number if needed.
6) Validate numbering has no duplicates and remains ordered.
7) Validate inserted units contain `Surface`, `Work`, `Tests`, and `Docs` lines with concrete content.

## Constraints

- Renumber only within target milestone.
- Preserve unrelated content and checkbox states.
- Do not convert closeout units into feature units or move them out of milestone-final position.
