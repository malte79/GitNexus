---
name: refactor-list
description: Use when the user wants a repo-wide structural ranking of components by how much they need refactoring, ignoring git churn and scoring components from 0-10 with a table, rationale, and likely refactor file list.
---

# refactor-list

Use this when the user wants a broad component leaderboard based on code hygiene and structural refactor need, not change frequency.

This skill is for repo-wide component analysis.
It is not a diff review and it must not use git churn as a scoring signal.

This skill must use an explicit weighted scoring model.
Do not sort components by narrative intuition alone.

## Hard Rules

- Do not use commit count, churn, blame, or recent activity as a ranking factor.
- Rank components by current structural condition, not by who has been worked on most recently.
- Prefer real components/subsystems over arbitrary directories when those better reflect ownership.
- Exclude generated caches, logs, artifacts, and other runtime byproducts unless the user explicitly asks to include them.
- Keep scores comparative within this repo:
  - `0` = essentially no refactor pressure
  - `10` = severe structural offender that should be prioritized
- Explanations must be based on code shape, ownership, duplication, lifecycle/state complexity, boundary clarity, and validation/guardrail coverage.
- Rank by current component condition plus current dominant-owner pressure.
- Every high-scoring component must name its current `Primary Dominant Owner`.
- Use the same scoring families that `$refactor` will use later so a later rerank is comparable.

## Required Pre-Read

- `AGENTS.md`
- `planning/master-intent.md`
- repo structure under the current checkout
- major owning surfaces for core engine, MCP, CLI, storage, tests, planning, and docs/process guardrails
- repo-local skills and guard scripts that affect structural quality

Before ranking:
- run `gnexus manage status`
- if freshness matters for a large ranking pass and the index is stale, run `gnexus manage index`
- use GNexus to map subsystem boundaries and dependency shape before relying on broad grep/manual impressions
- prefer:
  - `summary --subsystems` for the first broad subsystem/centrality pass
  - `query "<subsystem concept>" --owners` for subsystem discovery
  - `impact <symbol> --direction upstream` for shared-surface dependency pressure
  - `context <symbol>` for understanding dominant seams
- for the top candidate(s), identify the current dominant owner explicitly and inspect it with both `context` and `impact`
- use `detect-changes` only if the user explicitly wants local-diff impact included; otherwise rank current structure only

## Required Scoring Model

Score each component from `0.0` to `10.0` using the weighted model below.

- `Subsystem Pressure` (`30%`)
  - GNexus subsystem pressure from `summary --subsystems`
  - production file count
  - visible hotspots
  - visible lifecycle chokepoints
- `Dominant Owner Pressure` (`30%`)
  - current dominant owner file size
  - dominant owner function/member concentration
  - `impact` risk split and blast radius on the dominant owner
  - whether the dominant owner still acts as the routing/orchestration sink
- `Blast Radius` (`20%`)
  - affected modules/processes from `impact`
  - cross-boundary fan-in/fan-out pressure
- `Boundary Confusion` (`10%`)
  - duplicate production paths
  - mixed engine/MCP/CLI/storage concerns in one owner
  - unclear state/lifecycle ownership
- `Guardrail Weakness` (`10%`)
  - missing structure tests
  - weak docs lockstep on owned contract surfaces
  - weak enforcement against regression of the current bad shape

The score should be computed comparatively, but the explanation must still name which factors drove it most.

## Dominant Owner Contract

For every component row, identify:

- `Primary Dominant Owner`
- why it is the current center of gravity
- whether it is a true public seam or the practical production sink

If the component has no clear dominant owner, say so explicitly and explain why the pressure is more distributed.

## Required Analysis Method

Build the ranking from current code only. Use signals such as:

- file concentration and god-modules
- function concentration and oversized units of behavior
- duplicated or parallel production paths
- boundary/ownership confusion across modules
- mutable global state, caches, registries, and lifecycle complexity
- clarity of engine/MCP/CLI/storage separation
- testability and guardrail coverage
- dependency fan-in / fan-out and cross-boundary reachability as seen through GNexus `impact`
- how hard it is to explain the component cleanly after reading it
- whether the current dominant owner still owns multiple concern families that should live elsewhere

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
   - `Primary Dominant Owner`
   - `Why It Needs Work`
   - `Refactor Surface`

2. Sort the table worst first.

3. After the table, provide:
   - `Scoring Notes`
   - `Top Targets`

## Table Content Rules

- `Component`: short, stable subsystem name
- `Refactor Score (0-10)`: one decimal place allowed when useful
- `Primary Dominant Owner`: one concrete file/symbol or a concise note that the pressure is distributed
- `Why It Needs Work`: one compact explanation of the main structural problems and what kind of fix would improve it
- `Refactor Surface`: a concise list of the main files/directories the refactor would work on

## Scoring Notes

Briefly explain:

- what weighted factors drove the ranking most
- any excluded surfaces
- any assumptions used for grouping
- how dominant-owner pressure affected the final order

## Top Targets

Call out the top 1-3 components with:

- why they are at the top
- what a successful refactor strike would need to accomplish
- what dominant owner must stop being the practical sink
- what kind of skill to use next, usually `$refactor`

Also state whether each target looks like:

- `leaderboard-exit candidate`
- `major slice win candidate`
- `needs more than one strike`

## Output Quality Bar

- Be concrete, not generic.
- Do not produce a file inventory disguised as analysis.
- Do not let the table become a changelog.
- Keep the explanations structural and actionable.
- If a component scores high, the explanation must identify what architectural change would materially lower the score.
