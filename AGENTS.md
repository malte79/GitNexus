<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **GitNexus** (1573 symbols, 4146 relationships, 120 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/GitNexus/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/GitNexus/context` | Codebase overview, check index freshness |
| `gitnexus://repo/GitNexus/clusters` | All functional areas |
| `gitnexus://repo/GitNexus/processes` | All execution flows |
| `gitnexus://repo/GitNexus/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->

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
