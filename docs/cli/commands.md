# CLI Command Contracts

## Purpose

This document defines the v1 user-facing contract for:

- `codenexus init`
- `codenexus index`
- `codenexus status`
- `codenexus serve`

All commands resolve the nearest enclosing git root as the active repo boundary.

## Epic 04 Posture

Epic 04 makes `codenexus` the only user-facing CLI.

`codenexus serve` exists in this epic as the final command shape, but it fails clearly until Epic 05 delivers the real repo-local HTTP service lifecycle.

## `codenexus init`

Activate CodeNexus for the current repo boundary.

Preconditions:

- current directory must resolve to a git repo boundary

Side effects:

- create `.codenexus/` if missing
- create `.codenexus/config.toml` if missing
- initial v1 config uses port `4747`

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
- it may run on a dirty working tree, but v1 freshness remains conservative and may still classify the resulting index as stale

Failure cases:

- fail outside a git repo
- fail when the repo is uninitialized
- fail when required config is invalid

State transitions:

- `initialized_unindexed -> indexed_current` when freshness is current
- `initialized_unindexed -> indexed_stale` when freshness is stale
- `indexed_stale -> indexed_current` when refresh clears stale conditions
- `indexed_current -> indexed_stale` when refreshed while stale conditions remain
- when a service is already running, `codenexus index` refreshes on-disk index state only; v1 does not promise live service reload semantics

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
- whether live service information overrode stale runtime metadata

## `codenexus serve`

Start the repo-local MCP HTTP service for the active repo boundary.

Current Epic 04 behavior:

- the command exists
- it fails clearly and explicitly until Epic 05 implements the actual service lifecycle
- it must not silently fall back to inherited stdio MCP behavior

Preconditions:

- repo boundary must exist
- `.codenexus/config.toml` must exist
- a usable index must exist

Side effects:

- bind the configured port
- write `.codenexus/runtime.json` on successful startup

Contract:

- same-repo duplicate serve attempts fail loudly and report the existing service
- different worktrees using the same configured port fail loudly
- no silent port reassignment is allowed
- stale indexes may be served only with explicit degraded reporting
- no silent auto-refresh is allowed on serve
- `codenexus serve` must not rewrite `config.toml`

Failure cases:

- fail outside a git repo
- fail when the repo is uninitialized
- fail when no usable index exists
- fail when config is invalid
- fail when port binding conflicts cannot be resolved explicitly

State transitions:

- `indexed_current -> serving_current`
- `indexed_stale -> serving_stale`
- no transition on failed duplicate-serve attempts or port conflicts

## Wrong-Context Behavior

If a command is run:

- from inside a nested repo, the nested repo boundary applies
- from inside a worktree, that worktree boundary applies

No command may silently target a parent repo when a nearer git root exists.
