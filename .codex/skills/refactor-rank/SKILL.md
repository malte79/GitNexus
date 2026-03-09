---
name: refactor-rank
description: Use when the user wants a repo-wide structural ranking of components by how much they need refactoring, ignoring git churn.
---

# refactor-rank

Use this when the user wants a broad component leaderboard based on code hygiene and structural refactor need, not change frequency.

## Hard Rules

- Do not use commit count, churn, blame, or recent activity as a ranking factor.
- Rank components by current structural condition, not by who has been worked on most recently.
- Prefer real components or subsystems over arbitrary directories when those better reflect ownership.
- Exclude generated caches, logs, artifacts, and runtime byproducts unless the user explicitly asks to include them.
- Keep scores comparative within this repo:
  - `0` = essentially no refactor pressure
  - `10` = severe structural offender that should be prioritized

## Required Pre-Read

- `AGENTS.md`
- repo structure under the current checkout
- major owning surfaces for core engine, MCP, CLI, storage, planning, and tests

## Output Contract

Produce:

1. a markdown table with columns:
   - `Component`
   - `Refactor Score (0-10)`
   - `Why It Needs Work`
   - `Refactor Surface`
2. `Scoring Notes`
3. `Top Targets`
