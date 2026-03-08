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

## Execution Contract

1. Lock scope before edits.
2. Assimilate owning surfaces before edits.
3. Bind to existing seams first.
4. Implement in bounded passes.
5. Run targeted validation after meaningful passes.
6. Stop if scope creep or unresolved blockers appear.

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
