# CLI Command Contracts

## Purpose

This document defines the v1 user-facing contract for:

- `codenexus init`
- `codenexus index`
- `codenexus status`
- `codenexus serve`
- `codenexus start`
- `codenexus stop`
- `codenexus restart`
- `codenexus info`

All commands resolve the nearest enclosing git root as the active repo boundary.

## Epic 05 Posture

Epic 05 makes `codenexus serve` real as the repo-local HTTP service command.

## `codenexus init`

Activate CodeNexus for the current repo boundary.

Preconditions:

- current directory must resolve to a git repo boundary

Side effects:

- create `.codenexus/` if missing
- create `.codenexus/config.toml` if missing
- initial v1 config uses port `4747`
- initial v1 config enables background auto-index with a `300` second interval

Contract:

- `codenexus init` is idempotent
- if config already exists, it succeeds without silently changing existing values
- it must not create index or runtime files
- it must not mutate files outside `.codenexus/`

Failure cases:

- fail outside a git repo
- fail if `.codenexus/config.toml` exists but is invalid and cannot be safely interpreted as v1 config; the repo state is `invalid_config`

State transitions:

- `uninitialized -> initialized_unindexed`
- `initialized_unindexed -> initialized_unindexed`
- any indexed or serving state remains unchanged except for no-op confirmation

## `codenexus index`

Build or refresh the local repo index.

Preconditions:

- repo boundary must exist
- `.codenexus/config.toml` must exist

Side effects:

- create or replace `.codenexus/kuzu/`
- create or replace `.codenexus/meta.json`

Contract:

- `codenexus index` is both the initial build and the manual refresh command in v1
- it must not rewrite `config.toml`
- it must not mutate files outside `.codenexus/`
- it owns `.codenexus/index.lock` while an index run is active so overlapping manual and background index attempts do not race
- it may run on a dirty working tree; the resulting index is current only while HEAD, branch, worktree root, and dirty-state still match the indexed snapshot
- if a service is already running, `codenexus index` refreshes on-disk state and the live service adopts the rebuilt index automatically in the normal path
- if live reload fails, `codenexus index` must tell the operator how to recover the affected service

Failure cases:

- fail outside a git repo
- fail when the repo is uninitialized
- fail when required config is invalid

State transitions:

- `initialized_unindexed -> indexed_current` when freshness is current
- `initialized_unindexed -> indexed_stale` when freshness is stale
- `indexed_stale -> indexed_current` when refresh clears stale conditions
- `indexed_current -> indexed_stale` when refreshed while stale conditions remain
- when a service is already running, `codenexus index` refreshes on-disk index state and the live service should adopt the rebuilt index automatically
- when a service is already running on an older loaded index, `codenexus index` must tell the operator whether adoption is still in progress or whether reload failed and recovery is required

## `codenexus status`

Report repo configuration, index freshness, and service state.

Preconditions:

- repo boundary must exist

Side effects:

- none

Contract:

- `codenexus status` is read-only
- it may read `.codenexus/config.toml`, `.codenexus/meta.json`, and `.codenexus/runtime.json`
- it may probe the local MCP HTTP service if present
- live service checks are bounded and must not hang indefinitely
- v1 bounded probe expectation: one short timeout window, approximately one second
- it must not rewrite config, runtime, or index state as part of probing

Failure cases:

- fail outside a git repo
- if config is invalid, report the canonical base state `invalid_config`

Reporting expectations:

`codenexus status` must report:

- the canonical base state
- applicable detail flags
- current configured port when available
- background auto-index config when available
- whether live service information overrode stale runtime metadata
- whether a running service is foreground or background
- whether live service information shows adoption in progress or a reload failure
- background auto-index attempt, success, failure, and backoff details when available

## `codenexus serve`

Start the repo-local MCP HTTP service for the active repo boundary.

Preconditions:

- repo boundary must exist
- `.codenexus/config.toml` must exist
- a usable index must exist

Side effects:

- bind the configured port
- write `.codenexus/runtime.json` on successful startup
- remove `.codenexus/runtime.json` on graceful shutdown

Contract:

- same-repo duplicate serve attempts fail loudly and report the existing service
- different worktrees using the same configured port fail loudly
- no silent port reassignment is allowed
- stale indexes may be served only with explicit degraded reporting
- a running service may adopt a rebuilt on-disk index automatically in the normal path
- foreground `codenexus serve` must not run background auto-index polling
- `codenexus serve` must not rewrite `config.toml`
- live service identity is proven through a repo-specific HTTP health endpoint, not raw port reachability
- the live service health endpoint must expose the loaded index identity the service is actually serving

Failure cases:

- fail outside a git repo
- fail when the repo is uninitialized
- fail when no usable index exists
- fail when config is invalid
- fail when port binding conflicts cannot be resolved explicitly
- fail duplicate same-repo serve attempts while reporting the existing PID and port

State transitions:

- `indexed_current -> serving_current`
- `indexed_stale -> serving_stale`
- `serving_current -> indexed_current` when the live service stops cleanly
- `serving_current -> serving_stale` when loaded-index adoption falls behind or reload fails
- `serving_stale -> indexed_stale` when the live service stops cleanly
- `serving_stale -> serving_current` when live adoption catches up to the refreshed on-disk index
- no transition on failed duplicate-serve attempts or port conflicts

## `codenexus start`

Start the repo-local MCP HTTP service in detached background mode.

Preconditions:

- same as `codenexus serve`

Side effects:

- starts the same repo-local service implementation as `codenexus serve`
- writes `.codenexus/runtime.json` on successful startup

Contract:

- `codenexus start` is the background lifecycle command
- it must fail loudly if the repo-local service is already running
- it must use the same runtime implementation and health contract as foreground `serve`
- when `auto_index = true`, it polls for repo divergence every `auto_index_interval_seconds`
- branch switches and dirty-state flips are treated as ordinary repo divergence, not as a separate branch-index mode
- it must not trigger auto-index while another `codenexus index` run or live reload is already in flight
- repeated auto-index failures must back off and remain visible through `codenexus status`

## `codenexus stop`

Stop the repo-local background service for the active repo boundary.

Preconditions:

- repo boundary must exist

Side effects:

- stops the matching background service when one exists
- removes `.codenexus/runtime.json` on graceful shutdown

Contract:

- `codenexus stop` targets only the matching repo-local service
- it must not stop unrelated processes or services for other repos

## `codenexus restart`

Restart the repo-local background service for the active repo boundary.

Preconditions:

- same as `codenexus start`

Side effects:

- stops the matching background service when present
- starts the same detached runtime as `codenexus start`

## Wrong-Context Behavior

If a command is run:

- from inside a nested repo, the nested repo boundary applies
- from inside a worktree, that worktree boundary applies

No command may silently target a parent repo when a nearer git root exists.

## `codenexus info`

Print Markdown guidance for installing and using CodeNexus.

Preconditions:

- none

Side effects:

- none

Contract:

- `codenexus info` is read-only
- it prints Markdown only
- it presents CodeNexus as expected operational guidance for agents working in repos that use it
- it explains the full CodeNexus lifecycle:
  - install
  - `codenexus init`
  - `codenexus index`
  - `codenexus status`
  - `codenexus serve`
  - `codenexus start`
- `codenexus stop`
- `codenexus restart`
- it explains automatic live index adoption in the normal path and recovery guidance when live reload fails
- it explains that detached background mode usually keeps the repo fresh automatically while manual `codenexus index` remains the immediate certainty path
- it documents how to use the repo-local HTTP service after `serve` or `start`, including:
  - the health endpoint at `/api/health`
  - the MCP endpoint at `/api/mcp`
  - that `/api/mcp` is the richer structural query surface
  - a minimal MCP client example
  - brief use cases and example calls for each supported tool type
- it includes a suggested `AGENTS.md` snippet
- it includes workflow guidance for planning, implementing, and refactoring

Failure cases:

- none beyond ordinary CLI process failures
