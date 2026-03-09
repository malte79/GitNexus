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

## Remaining Epic Sequence

### 04. CLI Reshape

Turn the now-correct architecture into the actual CodeNexus CLI product surface.

Primary goals:

- add the `codenexus` executable as the canonical command
- implement `codenexus init`
- rename the indexing surface to `codenexus index`
- align `codenexus status` with the already-locked repo-state model
- establish the `codenexus serve` command surface that Epic 05 will complete

What this brings:

- closes the intentional usability gap left after Epic 03
- makes CodeNexus operable without relying on transitional `gitnexus` commands
- makes activation explicit and repo-owned

Important note:

- Epic 04 should fully own `codenexus init`, `codenexus index`, and `codenexus status`
- it should establish the `codenexus serve` command shape
- but the actual repo-local HTTP service lifecycle still belongs to Epic 05

### 05. Repo-Local MCP HTTP Service

Build the real repo-local MCP-over-HTTP service on top of the single-repo architecture from Epic 03 and the CLI surface from Epic 04.

Primary goals:

- make `codenexus serve` real
- bind one repo to one configured port
- own `.codenexus/runtime.json` through the actual service lifecycle
- expose the MCP tool surface over HTTP as the primary agent interface

What this brings:

- the repo-local agent service model becomes real, not just specified
- agents can target one long-lived repo service directly
- the temporary stdio-focused transition can stop being the main story

### 06. Index Freshness And Manual Refresh Semantics

Tighten the operational behavior around current versus stale indexes now that the repo-local service and CLI exist.

Primary goals:

- make manual refresh behavior explicit and durable
- tighten stale/current reporting across CLI and service
- define what happens operationally when code changes under an existing index

What this brings:

- clearer operator and agent behavior
- fewer ambiguous stale-state edge cases
- a stable base before more advanced update logic is added

Important note:

- this is still the manual/explicit freshness epic
- smarter delta refresh remains later work unless pulled forward deliberately

### 07. Luau Core Support

Add Luau to the language engine itself.

Primary goals:

- parser integration
- symbol extraction
- graph extraction
- baseline search/query/index support for Luau code

What this brings:

- CodeNexus can index Luau repos at the language level
- Roblox-specific support has a real foundation instead of special cases on top of unsupported code

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

Important note:

- Rojo-first remains the intended initial scope
- broad Roblox support beyond Rojo is still out of scope for the early product

### 09. Branch And Repo State Intelligence

Teach the repo-local system to reason about branch changes and longer-lived repo state.

Primary goals:

- detect branch changes cleanly
- refine stale-state behavior across branches
- decide whether separate per-branch indexes are required
- make repo-state reporting less naive over time

What this brings:

- fewer surprises when switching branches
- a path toward branch-aware index management
- a more durable repo-local operating model for real day-to-day use

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
- differentiating intelligence features without destabilizing the core roadmap too early

## Why The Remaining Order Looks Like This

The next two epics finish making CodeNexus a usable product:

- Epic 04: CLI Reshape
- Epic 05: Repo-Local MCP HTTP Service

Then the next epic stabilizes operation:

- Epic 06: Index Freshness And Manual Refresh Semantics

Then the next two epics make the product useful for the target Roblox/Luau domain:

- Epic 07: Luau Core Support
- Epic 08: Roblox And Rojo Resolution

Then the final two deepen robustness and intelligence:

- Epic 09: Branch And Repo State Intelligence
- Epic 10: Deferred Intelligence Upgrades

## Planning Notes

The roadmap is now past the foundational and architectural pivot work. Remaining epics should avoid reopening settled decisions from Epics 00-03 unless implementation reveals a real contradiction.

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
