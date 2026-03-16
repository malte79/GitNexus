---
name: refactor-list
description: Use when the user wants a repo-wide structural ranking of components by how much they need refactoring, ignoring git churn and scoring components from 0-10 with a table, rationale, and likely refactor file list.
---

# refactor-list

Use this when the user wants a broad component leaderboard based on code hygiene and structural refactor need, not change frequency.

This skill is for repo-wide component analysis.
It is not a diff review and it must not use git churn as a scoring signal.

## Hard Rules

- Do not use commit count, churn, blame, or recent activity as a ranking factor.
- Rank components by current structural condition, not by who has been worked on most recently.
- Prefer real components/subsystems over arbitrary directories when those better reflect ownership.
- Exclude generated caches, logs, artifacts, and other runtime byproducts unless the user explicitly asks to include them.
- Keep scores comparative within this repo:
  - `0` = essentially no refactor pressure
  - `10` = severe structural offender that should be prioritized
- Explanations must be based on code shape, ownership, duplication, lifecycle/state complexity, boundary clarity, and validation/guardrail coverage.

## Required Pre-Read

- `AGENTS.md`
- `planning/master-intent.md`
- repo structure under the current checkout
- major owning surfaces for core engine, MCP, CLI, storage, tests, planning, and docs/process guardrails
- repo-local skills and guard scripts that affect structural quality

Before ranking:
- run `codenexus manage status`
- if freshness matters for a large ranking pass and the index is stale, run `codenexus manage index`
- use CodeNexus to map subsystem boundaries and dependency shape before relying on broad grep/manual impressions
- prefer:
  - `summary --subsystems` for the first broad subsystem/centrality pass
  - `query "<subsystem concept>" --owners` for subsystem discovery
  - `impact <symbol> --direction upstream` for shared-surface dependency pressure
  - `context <symbol>` for understanding dominant seams
- use `detect-changes` only if the user explicitly wants local-diff impact included; otherwise rank current structure only

## Required Analysis Method

Build the ranking from current code only. Use signals such as:

- file concentration and god-modules
- function concentration and oversized units of behavior
- duplicated or parallel production paths
- boundary/ownership confusion across modules
- mutable global state, caches, registries, and lifecycle complexity
- clarity of engine/MCP/CLI/storage separation
- testability and guardrail coverage
- dependency fan-in / fan-out and cross-boundary reachability as seen through CodeNexus `impact`
- how hard it is to explain the component cleanly after reading it

Do not use signals such as:

- git churn
- author count
- age of files
- open PR/issue volume

## Component Selection Rules

- Group files into meaningful components, for example:
  - `Local Backend`
  - `Repo Manager`
  - `CLI Command Surface`
  - `Kuzu Storage/Core Graph`
  - `Docs Contracts and Guardrails`
- Prefer one row per meaningful subsystem.
- If two areas are tightly coupled but still have distinct ownership and refactor shapes, keep them separate.
- Keep the component list stable and explain any grouping choices briefly.

## Output Contract

Produce:

1. A markdown table with columns:
   - `Component`
   - `Refactor Score (0-10)`
   - `Why It Needs Work`
   - `Refactor Surface`

2. Sort the table worst first.

3. After the table, provide:
   - `Scoring Notes`
   - `Top Targets`

## Table Content Rules

- `Component`: short, stable subsystem name
- `Refactor Score (0-10)`: one decimal place allowed when useful
- `Why It Needs Work`: one compact explanation of the main structural problems and what kind of fix would improve it
- `Refactor Surface`: a concise list of the main files/directories the refactor would work on

## Scoring Notes

Briefly explain:

- what factors drove the ranking
- any excluded surfaces
- any assumptions used for grouping

## Top Targets

Call out the top 1-3 components with:

- why they are at the top
- what a successful refactor strike would need to accomplish
- what kind of skill to use next, usually `$refactor`

## Output Quality Bar

- Be concrete, not generic.
- Do not produce a file inventory disguised as analysis.
- Do not let the table become a changelog.
- Keep the explanations structural and actionable.
- If a component scores high, the explanation must identify what architectural change would materially lower the score.
