# Epics Todo

This document is a planning list only. It does not create actual epics yet.

The intent is to define the major epics in the best implementation order, with enough context to guide later epic creation. Each actual epic should be written and specified separately when work is ready to begin.

## Proposed Epic Sequence

### 1. Product And Runtime Boundary

Define the target shape of CodeNexus before implementation work starts.

- lock down `.codenexus` layout
- separate config from runtime state
- define the command surface
- define the repo-local MCP-over-HTTP model
- define core invariants

This is the foundation epic.

### 2. Core Surface Reduction

Strip away non-core product surfaces and decide what is kept, deferred, or removed.

- reduce the system toward a headless core
- identify what stays
- identify what is deferred
- identify what is removed

Goal is reducing noise and risk before major architectural edits. This should happen immediately after Epic 1 so the rest of the work proceeds in a codebase with less non-core surface area and less cognitive drag.

### 3. Repo-Local State And Single-Repo Architecture

Replace global registry and multi-repo assumptions with repo-owned state under `.codenexus`.

- redesign storage ownership around one repo
- redesign runtime ownership around one repo
- remove shared global control-plane assumptions

This is the real architectural pivot.

### 4. CLI Reshape

Evolve the CLI toward:

- `cn init`
- `cn index`
- `cn status`
- `cn mcp serve`

This epic makes the new product shape visible and operable. It should also enforce the principle of no repo mutations outside `.codenexus` by default.

### 5. Repo-Local MCP HTTP Service

Build the repo-scoped HTTP MCP server as the primary agent interface.

- adapt or replace current MCP/backend plumbing
- serve exactly one repo cleanly
- make the repo-local runtime model real

### 6. Index Freshness And Manual Refresh Semantics

Define and implement the first durable freshness contract.

- manual refresh is acceptable initially
- stale versus current behavior must be explicit
- reporting and operational behavior must be concrete

### 7. Luau Core Support

Add Luau parsing and graph extraction at the language level.

- syntax support
- code graph extraction
- language-level indexing support

This is language support first, not full Roblox semantics yet.

### 8. Roblox And Rojo Resolution

Add Rojo-aware repo understanding and Roblox-specific module and path resolution.

- Rojo project structure
- Roblox-aware module resolution
- `game:GetService(...)`
- `script.Parent`
- `WaitForChild(...)`
- client/shared/server boundaries

This is what makes Luau support actually useful for Roblox game repos.

### 9. Branch And Repo State Intelligence

Handle branch switching, staleness on branch changes, and possibly separate per-branch index management.

This should come after the repo-local core is stable.

### 10. Deferred Intelligence Upgrades

This bucket is intentionally late and should include things like:

- embeddings
- world projection ingestion
- richer semantic retrieval
- smarter delta refresh
- other advanced capabilities

These are important, but not part of the earliest useful CodeNexus product.

## Why This Split

The first five epics establish the product.

- Product And Runtime Boundary
- Core Surface Reduction
- Repo-Local State And Single-Repo Architecture
- CLI Reshape
- Repo-Local MCP HTTP Service

The next three make it useful in the target domain.

- Index Freshness And Manual Refresh Semantics
- Luau Core Support
- Roblox And Rojo Resolution

The final items deepen intelligence and ergonomics after the core is stable.

- Branch And Repo State Intelligence
- Deferred Intelligence Upgrades

## Planning Notes

Several decisions depend on earlier ones. For example, Luau or Roblox support should not land before the repo-local state and runtime shape is clear.

This should not become a rolling refactor effort with vague direction. The first epic should be a boundary-definition epic, not a code-change epic.

When actual epics are created, each one should answer:

- What user-visible outcome exists when this epic is done?
- What existing behavior is intentionally removed or changed?
- What future epics does this unlock?
- What is explicitly not solved yet?

## Things Not To Treat As Early Standalone Epics

The following should not become early standalone epics:

- full rename epic
- storage engine migration epic
- rewrite in Go or Rust epic
- embeddings epic
- world projection epic

These are either deferred, optional, or too destabilizing relative to current priorities.
