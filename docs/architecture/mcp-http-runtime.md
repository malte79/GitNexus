# MCP HTTP Runtime Contract

## Purpose

This document defines the v1 repo-local MCP-over-HTTP service contract for one CodeNexus repo boundary.

## Runtime Scope

- one running service corresponds to one repo boundary
- the repo boundary is the nearest enclosing git root
- worktrees are separate runtime boundaries
- the service serves only the repo in which it was started

## CLI Relationship

The HTTP runtime is the primary execution path for:

- top-level `codenexus query`
- top-level `codenexus context`
- top-level `codenexus impact`
- top-level `codenexus detect-changes`
- top-level `codenexus cypher`
- top-level `codenexus rename`
- top-level `codenexus summary`

Those commands are thin clients over the repo-local MCP HTTP service. They do not bypass it and do not auto-start it. When the service is unavailable, they fail clearly and point users to `codenexus manage start`.

The same HTTP-served tool contracts also own:

- symbol disambiguation inputs such as `uid` and `file_path`
- bounded read-only Cypher recovery resources:
  - `gitnexus://schema`
  - `gitnexus://properties`
  - `gitnexus://properties/{nodeType}`

## Config Discovery

`codenexus manage serve` and `codenexus manage start` resolve the active repo boundary and then read:

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

On successful startup, foreground and detached service modes write `.codenexus/runtime.json` with the required runtime fields defined in [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md).

`codenexus manage status` may read and compare runtime metadata, but it must not rewrite it.

On graceful shutdown, the service removes `.codenexus/runtime.json`.

If the process crashes or is killed before cleanup runs, `runtime.json` may remain behind as stale advisory state until the next live probe or lifecycle command corrects it.

When `codenexus manage index` rewrites `.codenexus/meta.json`:

- the running service detects a changed loaded-index generation
- it prepares a fresh backend against the rebuilt index
- it atomically swaps only after the new backend is ready
- it keeps serving the previous loaded index if reload fails

Reload attempts are serialized. Overlapping rebuild or reload events must not race into double-swap behavior.

## Health Model

The live probe is:

- `GET /api/health`

The runtime also exposes MCP-over-HTTP at:

- `POST /api/mcp`

The health payload must prove service identity for the current repo boundary by returning:

- service name
- PID
- configured port
- repo root
- worktree root
- service start time
- loaded index identity captured at service startup

Raw port reachability is never enough to claim a live CodeNexus service.

The health payload must also expose:

- service mode (`foreground` or `background`)
- optional reload failure information when the service is still serving an older loaded index
- background auto-index status when running in detached mode

## Foreground And Detached Lifecycle

`codenexus manage serve` is the foreground and debugging path.

`codenexus manage start`, `codenexus manage stop`, and `codenexus manage restart` manage the same repo-local service implementation in detached background mode.

- `manage start` launches the repo-local service in background mode
- `manage stop` terminates only the matching repo-local service
- `manage restart` performs a deterministic stop/start cycle

Detached mode is per-repo only. There is no global service registry.

Only detached background mode owns automatic freshness polling in v1.

- `codenexus manage serve` does not start background auto-index behavior
- `codenexus manage start` and `codenexus manage restart` run the same service with background auto-index enabled when config allows it
- auto-index checks use the same repo-state freshness inputs as `codenexus manage status`
- branch switches are just normal repo divergence
- auto-index attempts are serialized with live reload and must not overlap another `codenexus manage index` run
- repeated auto-index failures back off rather than retrying aggressively

When detached background auto-index is enabled and the repo diverges from the indexed state:

- the running service records an auto-index attempt
- it triggers the normal `codenexus manage index` command path in a child process
- on success, the existing live-reload path adopts the rebuilt index
- on failure, the service keeps serving the previous loaded index and reports failure details through health and status

## Live Reload Failure

If a running service detects rebuilt on-disk index state but cannot prepare or swap to the new backend:

- the previous loaded index remains active
- the service reports stale or degraded serving state
- health includes reload failure details
- detached background recovery uses `codenexus manage restart`
- foreground recovery uses stop and rerun of `codenexus manage serve`

## Client Expectations

Clients may rely on:

- one configured port per repo boundary
- explicit degraded reporting for stale service state
- one service speaking only for the repo boundary in which it was started
- a repo-identity health endpoint at `/api/health`

Clients must not rely on:

- runtime metadata being current without a live probe
- silent recovery, silent rebind, or silent auto-refresh behavior
