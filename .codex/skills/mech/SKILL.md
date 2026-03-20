---
name: mech
description: Mechanical validation gate. Run required build and test commands and report explicit pass or fail evidence.
---

# mech

Use this skill to run mechanical checks only.
Do not perform intelligent code-review judgments here; use `codereview` or `cr` for that.

## Purpose

Provide deterministic validation evidence before `prep` or `merge`.

## Required Pre-Read

1. `AGENTS.md`
2. current branch state:
- `git rev-parse --abbrev-ref HEAD`
- `git status --short`

## Mechanical Gate Selection

Choose checks from changed surfaces:

1) Always consider:
- `npm test`

2) If core ingestion, MCP, CLI, storage, or search behavior changed materially:
- `npm run test:integration`

3) If broad behavior changed across the main package or release confidence is required:
- `npm run test:all`

4) If only documentation or planning files changed:
- report that no mechanical gates were required

5) If planner, ranking, search, or impact hot paths changed and a real repro exists:
- include one focused live-repro or runtime-facing command when practical, and report the observed outcome separately from unit tests

## Execution Rules

- Use bounded runs for long commands when practical.
- If an environment-dependent check cannot run, report it explicitly as blocked with a reason.
- Do not hide failures; report non-zero exits plainly.
- Do not treat green unit tests as sufficient evidence for heuristic hot-path changes when a known live repro is available.

## Output Contract

Return a concise mechanical report with selected gates, per-command results, and overall `PASS`, `FAIL`, or `BLOCKED`.
