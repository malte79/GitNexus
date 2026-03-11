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

If the process crashes or is killed before cleanup runs, `runtime.json` may remain behind as stale advisory state until the next live probe or lifecycle command corrects it.

The runtime owns automatic live adoption of rebuilt on-disk indexes. When `codenexus index` rewrites `.codenexus/meta.json`:

- the running service detects a changed loaded-index generation
- it prepares a fresh backend against the rebuilt index
- it atomically swaps only after the new backend is ready
- it keeps serving the previous loaded index if reload fails

Reload attempts are serialized. Overlapping rebuild or reload events must not race into double-swap behavior.

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
- loaded index identity captured at service startup

Raw port reachability is never enough to claim a live CodeNexus service.

The live health payload is authoritative for loaded-index identity. Advisory `runtime.json` should persist the same loaded-index identity for stale-runtime recovery and operator inspection, but it must never outweigh a successful health probe.

The health payload must also expose:

- service mode (`foreground` or `background`)
- current loaded-index generation
- optional reload failure information when the service is still serving an older loaded index
- background auto-index status when running in detached mode:
  - whether auto-index is enabled
  - configured interval in seconds
  - last attempt, success, failure, and active backoff when present

## Startup Contract

### Missing Index

`codenexus serve` must refuse to start if no usable local index exists.

### Current Index

If the index is current, the service starts in a non-degraded state.

### Stale Index

If the index is stale, the service may still start, but it must report degraded or stale status explicitly. It must not silently auto-refresh.

## Detached Lifecycle

`codenexus serve` remains the foreground and debugging path.

`codenexus start`, `codenexus stop`, and `codenexus restart` manage the same repo-local service implementation in detached background mode.

- `start` launches the repo-local service in background mode
- `stop` terminates only the matching repo-local service
- `restart` performs a deterministic stop/start cycle

Detached mode is per-repo only. There is no global service registry.

Only detached background mode owns automatic freshness polling in v1.

- `codenexus serve` does not start background auto-index behavior
- `codenexus start` and `codenexus restart` run the same service with background auto-index enabled when config allows it
- auto-index checks use the same repo-state freshness inputs as `codenexus status`
- branch switches are just normal repo divergence; there is no branch-specific index mode
- auto-index attempts are serialized with live reload and must not overlap another `codenexus index` run
- repeated auto-index failures back off rather than retrying aggressively

When detached background auto-index is enabled and the repo diverges from the indexed state:

- the running service records an auto-index attempt
- it triggers the normal `codenexus index` command path in a child process
- on success, the existing live-reload path adopts the rebuilt index
- on failure, the service keeps serving the previous loaded index and reports failure details through health and status

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
- if live health and `runtime.json` disagree about loaded-index identity, live health wins and runtime metadata is stale
- a later `codenexus serve` attempt may recover by overwriting stale runtime metadata only after it proves no live matching service exists

## Live Reload Failure

If a running service detects rebuilt on-disk index state but cannot prepare or swap to the new backend:

- the previous loaded index remains active
- the service reports stale or degraded serving state
- health includes reload failure details
- background service recovery uses `codenexus restart`
- foreground service recovery uses stop and rerun of `codenexus serve`

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
