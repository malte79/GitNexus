---
name: epic-plan
description: Plan an epic collaboratively for the filesystem-based epic workflow before file creation.
---

# epic-plan

Use this only when the repo is using the optional filesystem epic workflow under `planning/epics/`.

Output epic structure only. Do not create or edit files.

## Hard Rules

- Keep scope aligned to the approved objective; do not add speculative feature work.
- Prefer small, execution-ready units over broad milestone bullets.
- Each unit must describe one coherent slice of work with explicit done-when language in `Work`.
- Every unit must name meaningful `Tests` and `Docs`; avoid placeholders such as `TBD`, `if needed`, or `update docs`.
- Closeout units must be evidence/validation/rollout closeout work, not feature implementation disguised as closeout.
- If behavior/contracts change, plan the companion docs/tests/schema/config/version updates in the same milestone where the behavior lands.

## Steps

1) Confirm objective, boundaries, and lane (`Bridge|Plugin|Automation|Workflow`).
2) Propose milestones in `100`-series blocks.
3) Define work units (`101`, `102`, `201`, ...) with `Surface`, `Work`, `Tests`, `Docs`.
4) Add dependencies, risks, rollback strategy, and open questions.
5) For each milestone, include one final closeout unit.
6) Validate that numbering is ordered, unit scope is bounded, and closeout units remain milestone-final.

## Required Structure

Header fields:
- `Assigned to: unassigned`
- `Lane: <Bridge|Plugin|Automation|Workflow>`
- `Status: backlog`
- `Objective: ...`
- `In scope: ...`
- `Out of scope: ...`
- `Dependencies: ...`
- `Risks: ...`
- `Rollback strategy: ...`

Each work unit must include:
- `Surface: ...`
- `Work: ...`
- `Tests: ...`
- `Docs: ...`

Unit quality bar:
- `Surface` names exact files/modules/contracts, not generic areas
- `Work` states the concrete outcome and the main constraints/invariants to preserve
- `Tests` names the validation surface that proves the unit
- `Docs` names exact companion docs or states `None` only if no documentation surface should change

## Constraints

- Do not create/edit files.
- Do not mark anything done.
- Do not leave placeholder or generic unit text.
