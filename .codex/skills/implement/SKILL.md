---
name: implement
description: Use when the user requests implementation work. Execute the approved plan with reuse-first edits, deterministic validation, and concise pass-by-pass reporting.
---

# implement

Execution mode is skill-driven only. This is not a shell command entrypoint.

## Hard Rules

- Implement only approved plan scope.
- If implementation pressure reveals missing scope, stop and report the gap; do not silently expand the plan during coding.
- Reuse-first is mandatory.
- If the approved work introduces a new subsystem or major product surface, do not start edits until the ownership skeleton is explicit.
- New subsystems or major surfaces must land with:
  - one thin public seam,
  - focused internal owners,
  - explicit state and lifecycle ownership,
  - docs lockstep,
  - at least one structural guard that enforces the intended boundary.
- Use GNexus as the first structural lens for subsystem, seam, and blast-radius discovery, but do not replace direct code reading with tool output.
- Do not introduce temporary compatibility shims, migration toggles, or "cleanup later" production paths unless the approved plan explicitly requires them.
- Do not widen public behavior or contracts beyond the approved plan.
- No hidden fallback or fail-open behavior.
- New mutable runtime state, caches, or registries are allowed only when the plan requires them and the implementation also adds clear ownership, reset or invalidation semantics, and focused tests.
- Behavior changes that affect docs, schema, config, or version policy must be updated in the same implementation pass, not deferred.
- If work is tracked in an epic file, completed units must have their checkbox state updated to match delivered work.

## Required Pre-Read

- `AGENTS.md`
- approved plan artifact for this work
- current branch and workspace state:
  - `git rev-parse --abbrev-ref HEAD`
  - `git status --short`
- when product code is in scope:
  - `gnexus manage status`
  - `gnexus query "<task concept>" --owners`
  - `gnexus context <primary-symbol>` for the likely owning seam
  - `gnexus impact <primary-symbol> --direction upstream` when the change touches shared behavior

If GNexus is stale or unavailable, report that before falling back to direct file inspection alone.

## Execution Contract

1. Lock scope before edits.
2. Assimilate owning surfaces before edits with GNexus plus direct file reads.
3. If the work creates a new subsystem or major surface, confirm the ownership skeleton and the structural guard before writing production code.
4. Bind to existing seams first.
5. Implement in bounded passes.
6. Run targeted validation after meaningful passes.
7. Use `gnexus detect-changes` after meaningful edits when it will clarify blast radius or validate the touched seam.
8. Stop if scope creep or unresolved blockers appear.

## Verification Requirements

Run relevant checks and report outcomes:
- `npm test --prefix gitnexus`
- when core behavior changes materially:
  - `npm run test:integration --prefix gitnexus`
- when broad confidence is needed:
  - `npm run test:all --prefix gitnexus`

## Reporting Contract

- `Pass Log`
- `Scope Adherence`
- `Reuse Decisions Applied`
- `New Abstractions Added`
- `Companion Surface Updates`
- `New Tests`
- `Validation Summary`
- `Readiness Gate`
- `Blockers`
- `Touched Surfaces`

## GNexus Implementation Expectations

- Before edits, use:
  - `query --owners` for subsystem discovery
  - `context` for the primary seam
  - `impact` for shared-code blast radius when relevant
- When a new subsystem or major surface is created, use `detect-changes` before closeout if it will confirm the intended public seam and owner split.
- After edits, prefer `detect-changes` as the structural diff summary when it adds signal.
- If GNexus results contradict the implementation reality seen in files or tests, report that mismatch explicitly.
