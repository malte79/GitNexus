# MCP HTTP Runtime Contract

## Purpose

This document defines the v1 repo-local MCP-over-HTTP service contract for one CodeNexus repo boundary.

## Runtime Scope

- one running service corresponds to one repo boundary
- the repo boundary is the nearest enclosing git root
- worktrees are separate runtime boundaries
- the service serves only the repo in which it was started

## Config Discovery

`cn mcp serve` resolves the active repo boundary and then reads:

- `.codenexus/config.toml`

The service must fail if:

- no repo boundary is found
- `.codenexus/config.toml` is missing
- required config fields are invalid

## Port Binding

- the service binds the configured `port`
- the configured port is part of repo-local config ownership
- the service must not choose a replacement port silently

## Runtime Metadata

On successful startup, `cn mcp serve` writes `.codenexus/runtime.json` with the required runtime fields defined in [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md).

Only `cn mcp serve` owns `runtime.json` writes in v1.

`cn status` may read and compare runtime metadata, but it must not rewrite it.

V1 does not define live service hot-reload behavior when `cn index` rewrites on-disk index state. A refreshed on-disk index does not by itself imply that an already-running service has re-opened or adopted that index without restart.

## Health Model

The service health contract is:

- live service response is authoritative
- `runtime.json` is advisory only
- stale or missing `runtime.json` must not outweigh a successful live probe
- failed live probes with stale `runtime.json` must be reported as runtime metadata stale

Epic 03 limitation:

- until the repo-local HTTP service exists, `cn status` only has a bounded TCP probe rather than a service-specific health endpoint
- because that probe cannot prove repo identity on its own, a reachable configured port with missing `runtime.json` is reported as indexed state plus `runtime_metadata_stale`, not as a confirmed serving state
- confirmed `serving_current` or `serving_stale` requires both a live probe and matching runtime metadata in Epic 03

## Startup Contract

### Missing Index

`cn mcp serve` must refuse to start if no usable local index exists.

### Current Index

If the index is current, the service starts in a non-degraded state.

### Stale Index

If the index is stale, the service may still start, but it must report degraded or stale status explicitly. It must not silently auto-refresh.

## Duplicate Serve Behavior

### Same Repo Boundary

If a healthy service already exists for the same repo boundary:

- the new `cn mcp serve` attempt fails loudly
- it reports the existing service PID and port
- it must not rewrite `runtime.json` unnecessarily

### Different Worktree, Same Port

If a different worktree tries to serve on the same configured port:

- startup fails loudly
- no silent port reassignment occurs
- the operator must resolve the conflict by changing config explicitly

### Different Repo, Different Port

Different repos may serve simultaneously when their configured ports do not conflict.

## Client Expectations

Clients may rely on:

- one configured port per repo boundary
- explicit degraded reporting for stale service state
- one service speaking only for the repo boundary in which it was started

Clients must not rely on:

- runtime metadata being current without a live probe
- silent recovery, silent rebind, or silent auto-refresh behavior
