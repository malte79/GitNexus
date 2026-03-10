# Epics Todo

This document is a planning list only. It does not create actual epics by itself.

The purpose is to keep the remaining roadmap current as the project changes. Completed epics stay here as context, but the main value of this file is to describe the next epics in the order they should be built.

## Completed Foundations

### 00. Docs Discipline And Gates

Completed.

This established the docs policy, governed-doc surfaces, docs lint, docs-contract checks, and required docs gates before merge.

### 01. Product And Runtime Boundary

Completed.

This locked the product contract for CodeNexus:

- `.codenexus` as the repo-local state boundary
- config versus runtime separation
- repo-local HTTP MCP as the intended service model
- command contracts for `codenexus init`, `codenexus index`, `codenexus status`, and `codenexus serve`

### 02. Core Surface Reduction

Completed.

This removed the non-core platform layers and reduced the repo to a headless code-intelligence core with only the seams needed for the next architecture epics.

### 03. Repo-Local State And Single-Repo Architecture

Completed.

This was the real pivot:

- no active global registry
- no active multi-repo routing
- `.codenexus` as the active state boundary
- single-repo backend binding
- retained `gitnexus` shims now run on the repo-local model

### 04. CLI Reshape

Completed.

This turned the architecture into the actual CodeNexus CLI product surface:

- `codenexus` is now the only user-facing executable
- `codenexus init`, `codenexus index`, `codenexus status`, and `codenexus serve` are the active command surface
- repo activation is explicit and repo-owned
- the inherited `gitnexus` CLI surface is no longer the product face

### 05. Repo-Local HTTP Service

Completed.

This made the runtime real:

- `codenexus serve` now starts a real repo-local HTTP service
- `.codenexus/runtime.json` is now owned by the live service lifecycle
- `/api/health` provides repo-identity-aware service health
- `codenexus status` now reflects the real live runtime model instead of placeholder heuristics
- duplicate serve and stale runtime handling are now part of the real runtime path

### 06. Index Freshness And Manual Refresh Semantics

Completed.

This tightened the post-Epic-05 operating model:

- `codenexus index` is now explicitly the manual refresh path
- the live service exposes loaded-index identity
- `codenexus status` can distinguish on-disk freshness from what the live service has actually loaded
- restart-required behavior after reindex while serving is now explicit
- the freshness model has been proven against a real installed package and live service run

## Remaining Epic Sequence

### 07. Luau Core Support

Add Luau to the language engine itself, on top of the now-working installable CLI and live repo-local service.

Primary goals:

- parser integration
- symbol extraction
- graph extraction
- baseline search/query/index support for Luau code

What this brings:

- CodeNexus can index Luau repos at the language level instead of only the currently supported languages
- Roblox-specific support gets a real language-engine foundation instead of heuristics layered on unsupported code
- because the CLI, repo-local index, and live service already work, new Luau support becomes usable through the existing product immediately

Important note:

- this is language support first
- Roblox semantics and Rojo resolution still belong to Epic 08

### 08. Roblox And Rojo Resolution

Make Luau support actually useful for real Roblox projects, specifically Rojo-based ones.

Primary goals:

- read Rojo project structure
- resolve Roblox module paths and instance-tree patterns
- understand common static patterns like:
  - `game:GetService(...)`
  - `script.Parent`
  - `WaitForChild(...)`
- model client/shared/server boundaries correctly

What this brings:

- CodeNexus becomes genuinely useful on Rojo Roblox game repos
- agents stop paying the manual “Roblox tax” of reconstructing module and instance relationships by grep
- the value compounds on top of the already-real local service and freshness model, so agents can use the new Roblox-aware capabilities immediately through the existing runtime

Important note:

- Rojo-first remains the intended initial scope
- broad Roblox support beyond Rojo is still out of scope for the early product

### 09. Branch And Repo State Intelligence

Teach the repo-local system to reason about branch changes and longer-lived repo state.

Primary goals:

- detect branch changes cleanly
- refine stale-state behavior across branches
- decide whether separate per-branch indexes are required
- make repo-state and runtime reporting less naive over time

What this brings:

- fewer surprises when switching branches
- a path toward branch-aware index management
- a more durable repo-local operating model for real day-to-day use now that service state, CLI state, and freshness semantics are all already established

### 10. Deferred Intelligence Upgrades

This remains the intentionally late bucket for higher-end capabilities once the core product is stable.

Likely contents:

- embeddings
- world projection ingestion
- richer semantic retrieval
- smarter delta refresh
- other advanced retrieval or runtime intelligence layers

What this brings:

- deeper agent leverage after the product is already solid
- differentiating intelligence features without destabilizing the now-working core product too early
- a place for future world-projection ingestion once Luau and Rojo support exist

## Why The Remaining Order Looks Like This

The product and runtime core now exist and have been proven in a real installed run against a live repo-local service.

The next two epics make the existing product useful for the target Roblox/Luau domain:

- Epic 07: Luau Core Support
- Epic 08: Roblox And Rojo Resolution

Then the final two deepen robustness and intelligence:

- Epic 09: Branch And Repo State Intelligence
- Epic 10: Deferred Intelligence Upgrades

## Planning Notes

The roadmap is now past the foundational, architectural, CLI, runtime, and freshness work. Remaining epics should avoid reopening settled decisions from Epics 00-06 unless implementation reveals a real contradiction.

When actual epics are created, each one should answer:

- What user-visible outcome exists when this epic is done?
- What existing behavior is intentionally removed or changed?
- What future epics does this unlock?
- What is explicitly not solved yet?

## Things Not To Treat As Early Standalone Epics

The following still should not become early standalone epics:

- full rename epic
- storage engine migration epic
- rewrite in Go or Rust epic
- embeddings epic
- world projection epic

These are either deferred, optional, or too destabilizing relative to current priorities.
