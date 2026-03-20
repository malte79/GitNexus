---
name: plan
description: Use when the user requests a plan. Produce a deterministic, reuse-first implementation plan with exact file edits, validation steps, and open questions last. No code changes.
---

# plan

Execution mode is skill-driven only. This is not a shell command entrypoint.

## Hard Rules

- No code changes in `plan`.
- Plan scope must match the approved objective exactly.
- Plan must be reuse-first. Parallel re-implementation is blocking.
- If the plan introduces a new subsystem or major product surface, it must define the ownership skeleton before proposing file edits.
- A new subsystem ownership skeleton must include:
  - one thin public seam,
  - focused internal owners by concern family,
  - explicit state and lifecycle ownership,
  - docs lockstep,
  - at least one structural guard that would fail if the subsystem regresses into a monolith, dual path, or ownerless state sink.
- Use gnexus as the first structural discovery lens when the task touches product code, but do not treat it as a substitute for direct file inspection.
- Plan must identify the existing seam to reuse before proposing any new abstraction.
- Plan must not rely on temporary compatibility shims, migration toggles, or deferred cleanup production paths unless explicitly required.
- Plan must not widen public behavior or contracts beyond the objective.
- If the plan adds mutable runtime state, caches, or registries, it must name the owner, invalidation or reset path, and tests that prove lifecycle correctness.
- If behavior changes, the plan must name companion docs, tests, schema, config, or version updates explicitly.
- For heuristic, ranking, scoring, or planner-shaping work, the plan must state:
  - the exact trigger condition,
  - the exact non-trigger condition,
  - the nearby negative case that must not regress,
  - any request-path performance constraint.
- Every item in `Open Questions` must include a clear `Recommended answer`.
- If there are no true open questions, output `Open Questions` as `None.`

## Required Pre-Read

- `AGENTS.md`
- branch and workspace state:
  - `git rev-parse --abbrev-ref HEAD`
  - `git status --short`
- when planning code changes in this repo:
  - `gnexus manage status`
  - `gnexus summary --subsystems`
  - `gnexus query "<task concept>" --owners`
  - `gnexus context <primary-symbol>` for the most likely owning seam when a clear symbol emerges
- relevant ownership files in scope
- `planning/master-intent.md` when product direction matters
- when a new subsystem or major surface is proposed:
  - `.codex/skills/subsystem-hygiene/SKILL.md`

If gnexus is stale or unavailable, say so explicitly and continue with direct file inspection.

## Required Output Sections (Strict Order)

1. `Purpose`
2. `Primary Lane`
3. `Non-goals / Out of Scope`
4. `Code Surface Recon`
5. `Reuse Inventory`
6. `Insertion Map`
7. `Boundary Checks`
8. `Exact Coding Instructions`
9. `Validation Plan`
10. `Documentation Lockstep`
11. `Rollback Strategy`
12. `Open Questions`

## Heuristic Planning Rule

When the objective changes ranking, planning, search scoring, impact shaping, or other heuristics:
- write the trigger and non-trigger predicates explicitly in `Boundary Checks` or `Exact Coding Instructions`,
- require one positive regression and one adjacent negative regression in `Validation Plan`,
- reject solutions that depend on unbounded synchronous filesystem scans or full-repo corpus walks on the request path unless the plan explicitly justifies them as unavoidable,
- prefer the narrowest predicate that matches the real bug over a broad proxy such as file size, concentration, or token overlap alone.

## Validation Plan (Minimum)

Use targeted checks first:
- `npm test`
- when core behavior changes materially, include:
  - `npm run test:integration`
- when confidence across the main package is needed, include:
  - `npm run test:all`

## gnexus Planning Expectations

- Use `summary --subsystems` to locate the likely ownership area before proposing edits.
- Use `query --owners` to identify likely files and symbols to inspect directly.
- Use `context` to confirm the primary seam before writing the `Reuse Inventory`.
- If the plan creates a new subsystem or major surface, name the ownership skeleton explicitly in `Boundary Checks` and `Exact Coding Instructions`.
- If gnexus output and direct file reads disagree, the plan must call that out explicitly instead of picking one silently.
- If the task is a repro-driven heuristic bug, the plan should preserve the exact repro command and state whether the failure starts in search ranking, planner shaping, impact shaping, or another upstream layer.

## Open Questions Output Rule

For each open question, include:
- `Question: ...`
- `Recommended answer: ...`
