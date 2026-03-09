---
name: refactor
description: Use when the user requests a targeted maximum-heavy refactor strike on one named component while preserving public behavior unless explicitly approved.
---

# refactor

Use this when the user wants a leaderboard-exit refactor strike on one component, not a lowest-hanging-fruit cleanup pass.

## Hard Rules

- Refactor one named component only.
- Preserve public behavior or contracts unless explicitly approved otherwise.
- No temporary compatibility shims, fallback paths, or "cleanup later" production branches.
- Reuse-first, but extraction is mandatory when current seams are insufficient.
- Delete dead or duplicate paths rather than preserving them behind flags.
- Do not stop at cosmetic decomposition; stop only at structural ownership improvement.
- If the component cannot reach materially better quality without expanding scope, stop and report the blocker instead of smuggling in extra work.

## Required Pre-Read

- `AGENTS.md`
- current branch and worktree state
- owning runtime, docs, tests, config files for the target component
- relevant repo-local skills:
  - `plan`
  - `implement`
  - `cr`
  - `mech`

## Reporting Contract

- `Baseline Score`
- `Target Score`
- `Before/After Architecture`
- `Deleted Paths`
- `Reuse Decisions`
- `New Abstractions`
- `Guardrails Added`
- `Validation Evidence`
- `Residual Risks`
- `Final Rerank`
