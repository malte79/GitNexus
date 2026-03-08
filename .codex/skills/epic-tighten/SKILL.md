---
name: epic-tighten
description: Deeply review an epic for reliability/soundness hardening (without feature creep), report findings, and update the epic accordingly.
---

# epic-tighten

Use this when asked to harden an epic before implementation.

Core instruction:
"Deeply consider and analyze this epic. Is there anything in it that we can tighten before we begin work on it? We are looking for reliability and soundness, not new feature creep. Report what you find and update the epic accordingly."

## Input Resolution

Target epic resolution order:

1) If user provides a specific epic path or id, use it.
2) Otherwise, default to the most recently assigned epic:
- search `planning/epics/doing/*.md` (exclude `.gitkeep` and `.keepme`)
- pick most recently modified file
- require `Status: doing` in header
3) If no eligible epic exists, stop and ask user for explicit target epic.

## Hard Rules

- Reliability/soundness only. Do not add net-new product feature scope.
- No checkbox completion changes unless explicitly requested.
- Preserve assignment and status semantics used in this repo (`Assigned to: Agent <n>`, `Status: doing`) unless user explicitly asks to change them.
- Preserve epic header fields and unit checkbox format:
  - `### [ ] <unit-id> <unit-title>`
- Keep milestone numbering valid and ordered.
- If new hardening work units are necessary, insert with correct renumbering in the same milestone.
- Prefer tightening existing unit language over adding new units when the problem can be fixed by clarifying scope, invariants, tests, or docs.
- Do not leave vague hardening text such as `improve reliability`, `handle edge cases`, or `add tests` without explicit done-when detail.

## Tightening Checklist

Review the epic for:

1) Ambiguity and determinism gaps
- vague work language without enforceable outcome
- missing done-when specificity in unit `Work`

2) Reliability and failure handling
- missing retry/backoff, rollback, or safe-failure behavior
- missing edge-case handling for critical paths

3) Contract and invariant coverage
- missing references to lifecycle/protocol/schema invariants where relevant
- unit wording that can conflict with existing spec constraints

4) Validation sufficiency
- tests too shallow for risk profile
- missing negative-path, race/concurrency, idempotency, or recovery tests where relevant

5) Dependency correctness
- ordering risks across units/milestones
- implicit prerequisites not called out in `Dependencies`

6) Scope control
- hidden feature creep inside hardening language
- broad or open-ended work statements that can expand scope unintentionally

7) Execution readiness
- units that mix multiple implementation slices and should be split
- closeout units that are missing evidence, validation, rollout, or rollback verification work
- missing companion docs/schema/config/version updates where behavior/contracts are implied

## Update Procedure

1) Produce findings first (severity-ordered).
2) Apply edits directly to the epic:
- tighten `Work`, `Tests`, and `Docs` lines
- tighten top-level `Risks`, `Dependencies`, `Rollback strategy` as needed
- insert minimal hardening-only units when required for soundness
- split overly broad units only when necessary to make execution deterministic
3) Re-check numbering and formatting.
4) Keep epic intent and user-facing behavior unchanged.

## Output Contract

Report:

- target epic selected
- findings (ordered by severity)
- exact updates made
- residual risks (if any)
- note any unchecked assumptions that remain inside the epic after tightening
