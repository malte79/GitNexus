---
name: epic-create
description: Create a new epic file in planning/epics/backlog from an agreed plan.
---

# epic-create

Use this only when the repo is using `planning/epics/`.

Create a new epic file in `planning/epics/backlog` with lowercase kebab-case filename.

## Hard Rules

- Create the file from the agreed epic plan only; do not add new scope while materializing it.
- Preserve filesystem epic conventions exactly.
- Do not introduce placeholder text (`TBD`, `later`, `as needed`, `if needed`) in header or unit content.
- Every created unit must remain implementation-ready: bounded scope, concrete tests/docs, and one closeout unit per milestone.

## Steps

1) Create `planning/epics/backlog` if missing.
2) Create epic file and fill required header.
3) Set first line exactly to `Title: <epic name>`.
4) Add milestone units in `100`-series blocks.
5) Include one closeout unit per milestone.
6) Leave epic unassigned and unchecked unless user asks otherwise.
7) Unit headings MUST use markdown task-checkbox syntax:
   - `### [ ] 101 Unit title`
8) Validate filename, required header fields, unit numbering, and closeout placement before finishing.

## Required Structure

Header:
- `Title: <epic name>`
- `Assigned to: unassigned`
- `Lane: <Bridge|Plugin|Automation|Workflow>`
- `Status: backlog`
- `Objective: ...`
- `In scope: ...`
- `Out of scope: ...`
- `Dependencies: ...`
- `Risks: ...`
- `Rollback strategy: ...`

Each work unit includes:
- `Surface: ...`
- `Work: ...`
- `Tests: ...`
- `Docs: ...`

Quality expectations:
- `Surface` must point at exact files/modules/contracts
- `Work` must be concrete enough for implementation, not a theme or placeholder
- `Tests` must name the validation/evidence surface that proves the unit
- `Docs` must name exact companion docs or `None` only when docs truly should not change

Unit heading format:
- `### [ ] <unit-id> <unit-title>`
- Example: `### [ ] 101 Select and lock baseline template`

## Constraints

- Do not mark anything done by default.
- Use `[ ]` for all new unit headings by default.
- Keep `Assigned to: unassigned` and `Status: backlog` unless the user explicitly requests otherwise.
