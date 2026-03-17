---
name: codereview
description: Intelligent AI code-review gate for branch diffs focused on structural, correctness, reliability, security, and performance risks.
---

# codereview

Use this as the single required AI review gate before merge.

This is an intelligent code-analysis gate only.
Do not run mechanical tests from this skill.

## Hard Rule

New or changed code must not ship with:

Structural and ownership risks:
- concern mixing,
- duplicated logic,
- abstraction bypass where an existing seam should be reused,
- a newly introduced subsystem or major surface that lacks a thin public seam, focused internal owners, explicit state/lifecycle ownership, docs lockstep, or at least one structural guard,
- newly introduced god-modules or monoliths that concentrate new authority without a defensible boundary reason,
- compatibility shims, temporary adapters, or TODO-cleanup follow-ups added to avoid integrating with the canonical path now,
- public boundary expansion that adds ambiguous dual semantics, flag-driven behavior forks, or optional-path behavior instead of one clear contract,
- hidden fallback or fail-open behavior,
- multiple production orchestration paths for the same runtime flow,
- test-only seams exposed to production callers,
- repo-local state leaking outside `.codenexus/` without explicit approval,
- CodeNexus product drift toward non-core surfaces without explicit approval.

Advanced reliability and operational risks:
- threading or lifecycle hazards,
- performance regressions in hot paths,
- security vulnerabilities,
- semantic drift without contract or test updates,
- broad exception swallowing or log-and-continue behavior that hides changed-path failures,
- new global mutable state, cache state, or lifecycle state added without clear ownership and invalidation semantics,
- flaky or non-deterministic tests,
- tests that only snapshot output shape without asserting the changed invariant,
- non-deterministic or fail-open timeout or retry behavior,
- observability contract gaps,
- resource lifecycle leaks.

Any `P0`/`P1`/`P2` finding is blocking.

Use CodeNexus for structural review in this repo when it is available and current, but do not let it replace direct diff reading.

Duplicate-code rule for this skill:
- review new duplication introduced by the branch diff only,
- if changed code duplicates an existing abstraction, helper, or workflow closely enough that reuse was practical, emit a blocking finding,
- unchanged pre-existing duplication is not itself a finding unless the diff expands it, copies it again, or bypasses an obvious reuse seam.

## Required Pre-Read

1. `AGENTS.md`
2. current branch state:
- `git status --short`
- `git rev-parse --abbrev-ref HEAD`

## Scope

Primary review scope:
- committed branch delta: `origin/<default-branch>...HEAD`

Default branch resolution:
- prefer `origin/main`, fallback to `origin/master`

Optional extended scope:
- staged or unstaged local changes when requested

## Procedure

1. Refresh baseline:
- fetch remote default branch
- enumerate changed files in `origin/<default-branch>...HEAD`

2. Run CodeNexus structural review on the diff when the changed files touch product code:
- `codenexus manage status`
- `codenexus detect-changes`
- `codenexus impact <changed-symbol> --direction upstream` for the highest-risk changed seams
- `codenexus context <changed-symbol>` when ownership or blast radius is unclear
- if CodeNexus is stale or unavailable, say so and continue with direct review

3. Run changed-code reuse scan before judging style:
- for each changed production file, identify the nearest existing ownership seam, helper, module, or abstraction that should have been reused,
- inspect adjacent files in the same subsystem and obvious counterpart modules for copied logic, copied orchestration, copied serialization, or copied command routing,
- distinguish required local adaptation from unnecessary duplication.

4. Run change-set bad-practice scan:
- look for new dual paths, compatibility branches, temporary adapters, migration toggles, or "cleanup later" markers that let the diff avoid proper integration now,
- look for new catch-all exception handling, silent retries, or degraded-success responses that weaken fail-closed behavior on the changed path,
- look for public contract widening in changed code,
- look for changes that add mutable global or module state, caches, or registries without a clearly changed owner, reset path, and test coverage,
- look for tests changed in the same diff that were updated only to match output churn rather than to assert the intended invariant,
- look for docs, schema, config, or version surfaces that should change with the behavior change but were left stale.
- when the diff claims or implies a refactor, check whether authority was actually removed from the old center of gravity or merely decorated with extra helpers; if the old module still acts as the practical routing/orchestration sink, emit a blocking structural finding.

5. Evaluate unified rubric:
- structural and ownership checks
- advanced reliability, security, performance, and observability checks

6. Emit severity-scored findings with exact `file:line`.

## Output Contract

Return findings first, ordered by severity, then gate status.
If no blocking findings exist, state that explicitly.
