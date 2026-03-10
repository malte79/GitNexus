# MCP HTTP Runtime Contract

## Purpose

This document defines the v1 repo-local MCP-over-HTTP service contract for one CodeNexus repo boundary.

## Runtime Scope

- one running service corresponds to one repo boundary
- the repo boundary is the nearest enclosing git root
- worktrees are separate runtime boundaries
- the service serves only the repo in which it was started

## Config Discovery

`codenexus serve` resolves the active repo boundary and then reads:

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

On successful startup, `codenexus serve` writes `.codenexus/runtime.json` with the required runtime fields defined in [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md).

Only `codenexus serve` owns `runtime.json` writes in v1.

`codenexus status` may read and compare runtime metadata, but it must not rewrite it.

On graceful shutdown, `codenexus serve` removes `.codenexus/runtime.json`.

If the process crashes or is killed before cleanup runs, `runtime.json` may remain behind as stale advisory state until the next live probe or serve attempt corrects it.

V1 does not define live service hot-reload behavior when `codenexus index` rewrites on-disk index state. A refreshed on-disk index does not by itself imply that an already-running service has re-opened or adopted that index without restart.

## Health Model

The service health contract is:

- live service response is authoritative
- `runtime.json` is advisory only
- stale or missing `runtime.json` must not outweigh a successful live probe
- failed live probes with stale `runtime.json` must be reported as runtime metadata stale

The live probe is a service-specific HTTP endpoint:

- `GET /api/health`

The health payload must prove service identity for the current repo boundary by returning:

- service name
- PID
- configured port
- repo root
- worktree root
- service start time

Raw port reachability is never enough to claim a live CodeNexus service.

## Startup Contract

### Missing Index

`codenexus serve` must refuse to start if no usable local index exists.

### Current Index

If the index is current, the service starts in a non-degraded state.

### Stale Index

If the index is stale, the service may still start, but it must report degraded or stale status explicitly. It must not silently auto-refresh.

## Shutdown And Crash Recovery

### Graceful Shutdown

When the service exits through its normal shutdown path:

- the HTTP listener is closed
- MCP session state is torn down
- the bound backend disconnects
- `.codenexus/runtime.json` is removed

### Crash Or Forced Termination

If the process dies before graceful shutdown completes:

- `.codenexus/runtime.json` may remain
- later `codenexus status` calls must prefer live `/api/health` results over the stale file
- if no live matching service answers, status must report `runtime_metadata_stale`
- a later `codenexus serve` attempt may recover by overwriting stale runtime metadata only after it proves no live matching service exists

## Duplicate Serve Behavior

### Same Repo Boundary

If a healthy service already exists for the same repo boundary:

- the new `codenexus serve` attempt fails loudly
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
- a repo-identity health endpoint at `/api/health`

Clients must not rely on:

- runtime metadata being current without a live probe
- silent recovery, silent rebind, or silent auto-refresh behavior
