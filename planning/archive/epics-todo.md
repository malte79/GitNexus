# Epics Todo Archive

This document is an archived planning snapshot. It is no longer the authoritative source for active epic state.

Active epic execution now lives in the filesystem workflow under `planning/epics/`. Historical completed epic files remain under `planning/epics/done/`.

The purpose of keeping this archived list is to preserve the original roadmap context without implying that every remaining item should still become a real epic.

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

### 07. Luau Core Support

Completed.

This added real language-level Luau support on top of the working local product:

- `.lua` and `.luau` are now recognized and parsed
- Luau definitions, calls, and basic string-based `require(...)` edges are now indexed
- end-to-end Luau indexing/query support has been proven through the real `codenexus` product surface
- Roblox and Rojo semantics remain deferred to Epic 08

## Archived Remaining Sequence

### 08. Roblox And Rojo Resolution

Completed.

This made the existing Luau support materially useful for real Rojo-based Roblox repos:

- `default.project.json` is now parsed into a deterministic filesystem-to-DataModel mapping
- Roblox-rooted static path forms such as `game:GetService(...)`, `script.Parent`, and chained `WaitForChild(...)` now resolve conservatively
- shallow syntax-local alias handling now supports common Rojo module access patterns
- client/shared/server runtime areas are now reflected in the graph and surfaced through query results
- the real `codenexus` product has been manually validated against `/Users/alex/Projects/roblox/dancegame-agent-1`

### 09. Roblox Query Ergonomics

Completed in the filesystem epic workflow. Retained here only as historical roadmap context.

### 10. Background Service And Live Reload

Completed in the filesystem epic workflow. Retained here only as historical roadmap context.

### 11. Branch And Repo State Intelligence

Completed in the filesystem epic workflow under the Epic 11 background freshness work. Retained here only as historical roadmap context.

### 12. Future Ideas Bucket

This is not an active epic anymore.

Treat it as a future-ideas bucket for intentionally late, optional intelligence work once the core product is stable.

Likely contents:

- embeddings
- world projection ingestion
- richer semantic retrieval
- smarter delta refresh
- other advanced retrieval or runtime intelligence layers

What this would bring:

- deeper agent leverage after the product is already solid
- differentiating intelligence features without destabilizing the now-working core product too early
- a place for future world-projection ingestion once Luau and Rojo support exist

## Why The Archived Order Looked Like This

The product and runtime core now exist and have been proven in a real installed run against a live repo-local service.

The next completed epics made the existing product useful for the target Roblox/Luau domain:

- Epic 07: Luau Core Support
- Epic 08: Roblox And Rojo Resolution

The late roadmap then aimed to deepen ergonomics, service lifecycle, robustness, and intelligence:

- Epic 09: Roblox Query Ergonomics
- Epic 10: Background Service And Live Reload
- Epic 11: Branch And Repo State Intelligence
- Epic 12: Future Ideas Bucket

## Planning Notes

The roadmap is now past the foundational, architectural, CLI, runtime, and freshness work. Future ideas should avoid reopening settled decisions from Epics 00-06 unless implementation reveals a real contradiction.

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
