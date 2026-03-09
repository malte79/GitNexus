# Codex Workflow

## Scope

This agent works only in this repository checkout:
- `/Users/alex/Projects/GitNexusFork-agent-1`

Do not modify sibling repos or other agent lanes from this checkout.

## Development Tenets (Mandatory)

- **KISS first** - Favor simplification over adding new systems. Ask whether the problem can be solved by removing or streamlining behavior before introducing new machinery.
- **Own uncertainty** - Never imply certainty when guessing. Call out assumptions explicitly when they cannot be avoided.
- **Debug before fixing** - If root cause is unclear, instrument and inspect before shipping a speculative fix.
- **Prefer battle-tested solutions** - Use simple, proven patterns before niche or experimental ones.
- **Brainstorm boundaries** - During ideation, propose options but do not write agent-origin product ideas into planning docs without explicit user sign-off.
- **No unauthorized workarounds** - Do not introduce compatibility shims, fallback behavior, or silent behavior changes for fixes unless the user approves.
- **No deferred-cleanup production paths** - Avoid "temporary" parallel runtime paths, migration branches, or TODO follow-ups that preserve bad structure in production.
- **Keep the product headless-first** - Prioritize the repo-local indexing engine, Kuzu-backed graph, and agent-facing MCP surface over human-facing extras.
- **Preserve repo-local ownership** - New repo state should live under `.codenexus/` only unless the user explicitly approves another location.

## Skill Bootstrapping (Mandatory)

At startup, load repository-local skills before planning or implementation:

- inspect repo-level `.codex` (especially `.codex/skills`)
- enumerate all skill folders under `.codex/skills`
- read each `SKILL.md` listed there
- apply matching skill workflows whenever a request maps to that skill

Do not assume global/default skills are sufficient when repo-local skills exist.

Current repo-local skills are cataloged in `.codex/skills/INVENTORY.md`.
When a request maps cleanly to a repo-local workflow, use the matching skill explicitly.

## Repo Context (Mandatory)

- Product intent: `planning/master-intent.md`
- Main package: `gitnexus/`
- Core engine: `gitnexus/src/core/`
- MCP layer: `gitnexus/src/mcp/`
- CLI layer: `gitnexus/src/cli/`
- Storage layer: `gitnexus/src/storage/`

## Branch Naming (Mandatory)

- Working branches should use the form: `codex/<task-slug>`

## Build And Validation (Mandatory)

Use validation commands from repository root unless a task requires otherwise.

- Docs markdown lint:
  - `npm run lint:docs --prefix gitnexus`
- Docs contract lint:
  - `npm run check:docs-contracts --prefix gitnexus`
- Main package unit tests:
  - `npm test --prefix gitnexus`
- Main package integration tests:
  - `npm run test:integration --prefix gitnexus`
- Full main package test suite:
  - `npm run test:all --prefix gitnexus`

If changed surfaces make a command inapplicable or blocked, report that explicitly.

## Long-Run Command Observability (Mandatory)

When running potentially long commands:

- use timeouts or bounded runs when practical
- emit heartbeat updates at least every 20 seconds with elapsed time and process state
- if output is idle for about 40 seconds, inspect process state and report whether it is active or stuck
- if a command appears stuck, stop that process and retry in smaller steps rather than waiting indefinitely

## Merge Workflow (Mandatory)

Use local repo skills for integration and publish steps.
Required quality gates before merge:

- `$cr`
- `$mech`
- `npm run lint:docs --prefix gitnexus`
- `npm run check:docs-contracts --prefix gitnexus`

`$cr` is the AI code-review gate.
`$mech` is the mechanical validation gate.
The docs gates remain named required checks even if `$mech` runs them internally.

Do not bypass this workflow with ad hoc merge commands unless explicitly requested.
