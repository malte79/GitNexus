# CodeNexus Documentation Policy

## Scope

This repository does not aim to document the inherited GitNexus system wholesale.

The documentation contract applies only to CodeNexus-owned changes:

- new or changed product contracts
- new or changed CLI behavior
- new or changed runtime-state behavior
- new or changed repo-local filesystem/state ownership
- new or changed workflow rules that CodeNexus relies on

Inherited upstream behavior remains out of scope unless a CodeNexus-owned change modifies it or depends on it as an explicit contract.

## Required Documentation Rule

Every CodeNexus-owned contract or behavior change must update matching governed docs in the same change.

This includes:

- architecture and contract docs under `docs/`
- governed planning docs that lock product/runtime direction
- workflow docs when merge or validation behavior changes

Required workflow surfaces include the repo-owned workflow contracts in `AGENTS.md` and the required workflow skills used for review, validation, prep, and merge.

In this repo, workflow-skill contract changes also include meaningful shifts in how those skills are expected to use CodeNexus itself. For example:

- planning skills that now require CodeNexus-first structural discovery before direct file inspection
- implementation skills that now require CodeNexus seam and blast-radius checks around edits
- review and ranking skills that now rely on CodeNexus structural outputs as part of their required procedure
- new subsystem workflow rules that require an ownership skeleton up front: one thin public seam, focused internal owners, explicit state/lifecycle ownership, docs lockstep, and at least one structural guard
- leaderboard-exit refactor rules that judge success by authority removal rather than helper extraction alone
- refactor workflow rules that now require a dedicated `codex/` branch to be created and selected before a refactor strike proceeds, unless the current branch is already the active refactor lane for that target
- refactor ranking rules that now use an explicit weighted scoring model instead of narrative-only ordering
- refactor closeout rules that now report both component score and dominant-owner score, plus an explicit outcome class such as `Leaderboard Exit`, `Major Slice Win`, or `Structural Prep Only`

When a CodeNexus-owned contract surface changes, the matching durable update must include a document under `docs/`. Planning-doc-only changes are not sufficient.

Epics must name exact documentation surfaces in their `Docs:` lines. Placeholder instructions such as `update docs`, `TBD`, `later`, or `if needed` are not acceptable.

## Pure Refactors

Pure refactors with no CodeNexus-owned contract or behavior change do not require docs updates.

They are allowed to pass without governed docs changes only when the docs-contract gate can conclude that no governed docs update is required.

## Canonical Ownership

Durable CodeNexus documentation lives under `docs/`.

Planning docs remain governed because they lock active direction and epic execution, but they are not the long-term home for durable product documentation.

## Required Documentation Surfaces

The initial CodeNexus documentation categories are:

- architecture and contract docs
- CLI docs
- decision records
- feature docs for new CodeNexus-owned systems

The initial stable paths for those categories are defined in [docs/README.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/README.md).

## Governed Surfaces

The governed documentation surface set is defined by the machine-readable manifest in [docs/governed-paths.toml](/Users/alex/Projects/GitNexusFork-agent-1/docs/governed-paths.toml).

That manifest is the source of truth for:

- markdown lint scope
- docs-contract lint scope
- contract-surface rules that require docs

## Merge Gates

CodeNexus-owned changes are not merge-ready until the required docs gates pass.

The named docs gates are:

- `npm run lint:docs --prefix gitnexus`
- `npm run check:docs-contracts --prefix gitnexus`

Those gates remain explicit required checks even if another workflow such as `$mech` runs them internally.
