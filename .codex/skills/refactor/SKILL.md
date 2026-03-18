---
name: refactor
description: Use when the user requests a targeted maximum-heavy refactor strike on one named component (for example the local backend or repo manager) to remove it from the repo's worst-offender tier while preserving public behavior unless explicitly approved.
---

# refactor

Use this when the user wants a leaderboard-exit refactor strike on one component, not a lowest-hanging-fruit cleanup pass.

This skill must use the same explicit weighted scoring model as `$refactor-list`.
Do not declare success from narrative improvement alone.

This skill expects the user to point at a specific component, for example:
- `gitnexus/src/mcp/local/local-backend.ts`
- `Local Backend`
- `gitnexus/src/storage/repo-manager.ts`

Its job is:

- target one component only
- preserve public behavior unless explicitly approved otherwise
- perform a deep structural rewrite, not cosmetic cleanup
- remove the component from the repo's worst-offender tier by measurable before/after criteria
- add guardrails so the same structural problems do not come back

## Hard Rules

- Refactor one named component only.
- Start every refactor strike on a dedicated `codex/` branch for that refactor. If the current branch is not already the active refactor lane for the requested component, create and switch to a new branch immediately before planning or editing. Prefer `codex/refactor-<component-slug>`.
- Preserve public behavior/contracts unless explicitly approved otherwise.
- No temporary compatibility shims, fallback paths, or "cleanup later" production branches.
- Reuse-first, but extraction is mandatory when current seams are insufficient.
- A leaderboard-exit refactor must target authority removal, not helper extraction alone.
- The old center of gravity must stop acting as the practical routing or orchestration sink by closeout; moving helpers without changing authority does not count as success.
- Delete dead/duplicate paths rather than preserving them behind flags.
- Generated outputs do not count as cleaned up unless their source surfaces are cleaned up.
- Do not stop at cosmetic decomposition; stop only at structural ownership improvement.
- Do not silently widen public behavior, result shapes, or caller obligations while refactoring.
- If the component cannot reach leaderboard-exit quality without expanding scope, stop and report the blocker instead of smuggling in extra work.

## Required Pre-Read

- `AGENTS.md`
- `planning/master-intent.md`
- current branch/worktree state:
  - `git rev-parse --abbrev-ref HEAD`
  - `git status --short`
- owning runtime/docs/tests/config files for the target component
- current guard scripts relevant to the component
- relevant repo-local skills:
  - `$plan`
  - `$implement`
  - `$cr`
  - `$mech` when mechanical validation is needed

Before proposing the refactor shape:
- if the current branch is not already a dedicated `codex/` branch for this refactor, create one first and report its name
- do not continue a refactor strike directly on `main`, `master`, or an unrelated task branch when a fresh dedicated lane can be created
- if existing uncommitted changes are carried onto the new branch, call that out explicitly before continuing

- run `codenexus manage status`
- if the target component is stale in the index and structural certainty matters, run `codenexus manage index`
- use the top-level structural CLI:
  - `summary --subsystems` for an initial centrality/subsystem overview
  - `query "<component concept>" --owners` for subsystem discovery
  - `context <symbol>` for the main anchor symbols
  - `impact <symbol> --direction upstream` for blast-radius estimation before extraction or moves
  - `detect-changes` after edits when the strike touches shared seams
- use CodeNexus first for cross-file dependency tracing, ownership mapping, and blast-radius estimation
- treat CodeNexus as mandatory for non-trivial refactor strikes; use `rg` only as a supplement
- baseline and closeout must both use the shared weighted scoring families:
  - `Subsystem Pressure`
  - `Dominant Owner Pressure`
  - `Blast Radius`
  - `Boundary Confusion`
  - `Guardrail Weakness`

## Required Inputs

The refactor request must identify:

- `Target Component`: exact path/surface, for example `gitnexus/src/mcp/local/local-backend.ts`
- `Behavior Contract`: what must remain stable
- `Refactor Objective`: leaderboard-exit, not general cleanup

If the user does not provide all three, infer them conservatively from the named component and state the assumptions.

## Baseline Contract

Before proposing edits, capture the current component state:

- largest files
- largest functions
- current ownership seams
- current dominant owner and why it acts as the center of gravity
- duplicate/parallel execution paths
- mutable global state / caches / registries
- docs/tests/schema/config companion surfaces
- current hygiene score for the component

The baseline must also capture:

- `Baseline Component Score`
- `Baseline Dominant Owner Score`
- which weighted factors are keeping the component in the worst-offender tier

The baseline must identify why the component is currently a bad offender, not merely that it is large.

## Refactor Objectives

Produce a target architecture that:

- reduces central file ownership concentration
- removes parallel production paths
- consolidates duplicated logic behind shared seams
- makes engine/MCP/CLI/storage boundaries explicit where relevant
- tightens lifecycle/state ownership
- adds or updates guardrails so drift is mechanically caught

## Planning Contract

Use `$plan` discipline, but optimize for structural end-state, not easiest wins.

The plan must include:

- before/after component map
- `Primary Dominant Owner` for the post-strike shape
- `Concern Transfer Map` that names which concern families move from the old owner to which new owner
- exact extraction passes
- deletion/rehome list
- invariants that must remain true
- companion docs/tests/schema/config/version updates
- post-strike reranking target
- expected outcome class:
  - `Leaderboard Exit`
  - `Major Slice Win`
  - `Structural Prep Only`

The important phrase is this:

"Do not optimize for easiest wins. Optimize for removing the component from the repo's worst-offender category by structural end-state."

## Implementation Contract

Use `$implement` discipline, but with maximum-heavy refactor expectations.

- Execute in bounded passes.
- Each pass must materially improve ownership shape and rehome real concern families, not just move code.
- Run targeted validation after each pass.
- Add or strengthen static gates when architecture hardening is part of the strike.
- Prefer deleting or collapsing old paths over preserving them in parallel.
- If a blocker prevents leaderboard-exit quality, stop and report the blocker explicitly.

## Completion Gate

Do not declare success unless all are true:

- component reranked materially lower than baseline
- dominant-owner pressure reranked materially lower than baseline
- no major duplicate production paths remain
- main god-module pressure is reduced to acceptable thresholds
- ownership boundaries are cleaner and easier to explain
- the post-strike `Primary Dominant Owner` is explicit and defensible
- the `Concern Transfer Map` is reflected in the code rather than only in moved helper files
- the old dominant owner no longer acts as the practical routing/orchestration sink
- tests/docs/schema/config/version surfaces are in lockstep
- new guardrails exist where regression risk was previously structural

If the component score does not move enough for a leaderboard exit but the dominant owner score drops materially and real concern families moved, report that as `Major Slice Win`, not as failure and not as full success.

## Reporting Contract

- `Baseline Score`
- `Baseline Dominant Owner Score`
- `Target Score`
- `Target Dominant Owner Score`
- `Primary Dominant Owner`
- `Outcome Class`
- `Concern Transfer Map`
- `Before/After Architecture`
- `Deleted Paths`
- `Reuse Decisions`
- `New Abstractions`
- `Authority Removed`
- `Guardrails Added`
- `Validation Evidence`
- `Residual Risks`
- `Final Rerank`

`Final Rerank` must state both:

- component rerank
- dominant-owner rerank

and must say explicitly whether the strike achieved:

- `Leaderboard Exit`
- `Major Slice Win`
- `Structural Prep Only`
