# Repo State Model

## Purpose

This document defines the v1 `.codenexus/` layout, config and runtime ownership, canonical repo states, and freshness semantics.

## `.codenexus/` Layout

| Path | Type | Created by | Purpose | Safe to delete |
|---|---|---|---|---|
| `.codenexus/` | container | `codenexus init` | Repo-local CodeNexus state root | No |
| `.codenexus/config.toml` | config | `codenexus init` | User-owned repo config | No |
| `.codenexus/meta.json` | derived index metadata | `codenexus index` | Index metadata used for status and freshness checks | Yes, but index becomes unavailable |
| `.codenexus/kuzu/` | derived index state | `codenexus index` | Kuzu graph store for this repo boundary | Yes, but index becomes unavailable |
| `.codenexus/runtime.json` | advisory runtime state | `codenexus serve` | Last known local HTTP service facts | Yes, but service discovery falls back to live checks only |
| `.codenexus/index.lock` | advisory index lock | `codenexus index` | Serialize manual and background index runs for one repo boundary | Yes, but only when no index is active |

V1 creates no placeholder directories or reserved future paths beyond the paths above.

## Init-Time Layout

`codenexus init` creates:

- `.codenexus/`
- `.codenexus/config.toml`

It does not pre-create:

- `.codenexus/kuzu/`
- `.codenexus/meta.json`
- `.codenexus/runtime.json`

## Config Contract

Config format is TOML.

Canonical path:

- `.codenexus/config.toml`

Required fields:

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | Config schema version. V1 value: `1` |
| `port` | integer | Repo-local MCP HTTP port for this repo boundary |
| `auto_index` | boolean | Whether detached background mode should auto-index when the repo diverges. Default: `true` |
| `auto_index_interval_seconds` | integer | Poll interval for detached background auto-index. Default: `300` |

Example:

```toml
version = 1
port = 4747
auto_index = true
auto_index_interval_seconds = 300
```

### Config Rewrite Rules

- `codenexus init` creates `config.toml` if absent.
- `codenexus init` is idempotent if `config.toml` already exists.
- `codenexus init` must not silently replace an existing configured port or other user-owned config.
- `codenexus index`, `codenexus status`, and `codenexus serve` must never rewrite `config.toml`.
- A config change requires explicit user action in a later command or manual edit path; v1 does not define such a command yet.

## Index Metadata Contract

Canonical path:

- `.codenexus/meta.json`

Required fields:

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | Metadata schema version. V1 value: `1` |
| `indexed_head` | string | Git commit at which the last index completed |
| `indexed_branch` | string | Branch name observed at index time |
| `indexed_at` | string | ISO-8601 timestamp of the completed index |
| `indexed_dirty` | boolean | Whether the worktree was dirty when the index completed |
| `worktree_root` | string | Absolute path of the worktree used for indexing |
| `index_generation` | string | Deterministic identity for the built on-disk index generation |

## Runtime Metadata Contract

Runtime metadata is advisory only.

Canonical path:

- `.codenexus/runtime.json`

Required fields:

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | Runtime metadata schema version. V1 value: `1` |
| `pid` | integer | Last known MCP service process ID |
| `port` | integer | Port the service attempted to bind |
| `started_at` | string | ISO-8601 timestamp for service start |
| `mode` | string | Service mode: `foreground` or `background` |
| `repo_root` | string | Absolute repo root for the service boundary |
| `worktree_root` | string | Absolute worktree path for the service boundary |
| `loaded_index` | object | Identity of the index metadata the live service loaded at startup |
| `reload_error` | string? | Last live-reload failure message when the service stayed on the previous loaded index |
| `auto_index` | object? | Background auto-index status when the service is running |

When present, `auto_index` contains:

| Field | Type | Meaning |
|---|---|---|
| `enabled` | boolean | Whether background auto-index is enabled for this service |
| `interval_seconds` | integer | Configured background polling interval |
| `last_attempt_at` | string? | ISO-8601 timestamp of the last background auto-index attempt |
| `last_succeeded_at` | string? | ISO-8601 timestamp of the last successful background auto-index |
| `last_failed_at` | string? | ISO-8601 timestamp of the last failed background auto-index |
| `last_error` | string? | Last background auto-index failure message |
| `backoff_until` | string? | ISO-8601 timestamp before which background auto-index must not retry |

### Runtime Precedence

- Live service checks are authoritative.
- `runtime.json` is advisory and may be stale.
- If `runtime.json` claims a service exists but no live service answers, the runtime metadata is stale.
- If a live service answers but `runtime.json` is missing or stale, the live service wins and status must report the runtime metadata mismatch.

The live probe is a bounded HTTP health request to the repo-local service.

Serving states require:

- a successful service-identity response from `/api/health`
- matching repo root, worktree root, and configured port
- matching or intentionally stale loaded-index identity evaluation against current on-disk metadata

An unrelated process listening on the configured port must not produce `serving_current` or `serving_stale`.

## Canonical Base States

Every repo/runtime outcome maps to one base state.

| State | Meaning |
|---|---|
| `uninitialized` | `.codenexus/config.toml` is missing |
| `invalid_config` | `.codenexus/config.toml` exists but is invalid for the v1 config contract |
| `initialized_unindexed` | config exists, but no usable index exists |
| `indexed_current` | index exists and is current for the repo boundary |
| `indexed_stale` | index exists, but freshness checks mark it stale |
| `serving_current` | live MCP service exists and the index is current |
| `serving_stale` | live MCP service exists and the index is stale |

## Detail Flags

Detail flags refine a base state without replacing it.

| Flag | Meaning |
|---|---|
| `runtime_metadata_stale` | `runtime.json` disagrees with live service checks |
| `working_tree_dirty` | working tree is dirty at status time |
| `head_changed` | current HEAD differs from `meta.json.indexed_head` |
| `branch_changed` | current branch differs from `meta.json.indexed_branch` |
| `wrong_worktree` | metadata was produced in a different worktree root |
| `service_restart_required` | live service is still serving an older loaded index than the current on-disk index |

## Freshness Rules

### Current

An index is `current` only when all of the following are true:

- `.codenexus/kuzu/` exists
- `.codenexus/meta.json` exists with required fields
- current HEAD equals `indexed_head`
- current branch equals `indexed_branch`
- current worktree root equals `worktree_root`
- current working-tree dirty state matches `indexed_dirty`

### Stale

An index is `stale` when any of the following are true:

- HEAD changed
- branch changed
- worktree root changed
- current working-tree dirty state differs from `indexed_dirty`
- required index files are present but internally inconsistent

V1 freshness is intentionally deterministic. A dirty worktree can still be current when the on-disk index was built from that same dirty snapshot, but any later dirty-state flip makes the index stale again.

If required index artifacts are missing entirely, the repo falls back to `initialized_unindexed` rather than `indexed_stale`.

## Manual Refresh

`codenexus index` is both:

- the initial build command
- the manual refresh command

V1 does not define a separate `codenexus refresh`.

When a service is already running:

- `codenexus index` refreshes on-disk index state
- the running service should adopt the rebuilt index automatically in the normal path
- while live adoption is still in progress, status may report `serving_stale` with `service_restart_required`
- if live reload fails, the service continues serving the previous loaded index until the operator recovers it

In detached background mode:

- background auto-index is controlled by `config.toml`
- only background mode may trigger automatic reindex attempts
- background auto-index uses the same freshness inputs as the canonical repo-state evaluation
- background auto-index skips while another index is already running or a live reload is still in progress
- successful background auto-index still relies on the normal live-reload path for adoption
- repeated failures enter temporary backoff and must be surfaced through `runtime.json`, live health, and `codenexus status`

## State Transition Matrix

| From | Trigger | To |
|---|---|---|
| `uninitialized` | `codenexus init` succeeds | `initialized_unindexed` |
| `invalid_config` | config is repaired into a valid v1 config | `initialized_unindexed` |
| `initialized_unindexed` | `codenexus index` completes and freshness is current | `indexed_current` |
| `initialized_unindexed` | `codenexus index` completes but freshness is stale | `indexed_stale` |
| `indexed_current` | required index artifacts are removed entirely | `initialized_unindexed` |
| `indexed_stale` | required index artifacts are removed entirely | `initialized_unindexed` |
| `indexed_current` | worktree becomes dirty, HEAD changes, branch changes, or worktree changes | `indexed_stale` |
| `indexed_stale` | `codenexus index` completes and freshness is current | `indexed_current` |
| `indexed_current` | `codenexus serve` starts successfully | `serving_current` |
| `indexed_stale` | `codenexus serve` starts successfully | `serving_stale` |
| `serving_stale` | detached background auto-index completes and live adoption catches up | `serving_current` |
| `serving_current` | live service stops | `indexed_current` |
| `serving_current` | freshness becomes stale while service remains live | `serving_stale` |
| `serving_stale` | live service stops | `indexed_stale` |
| `serving_stale` | `codenexus index` completes and freshness becomes current while service remains live | `serving_stale` plus `service_restart_required` until live adoption completes or reload failure is recovered |

## Status Precedence

`codenexus status` reports:

1. the canonical base state
2. any applicable detail flags
3. whether live service information overrode advisory runtime metadata

Live service truth always wins over `runtime.json`.

Runtime metadata disagreement affects degraded reporting and flags, but it does not by itself redefine whether the local index is current or stale.

When both live health and advisory runtime metadata are available:

- live health is authoritative for loaded-index identity
- `runtime.json` is used only for stale-runtime detection and operator inspection
- if the two disagree about loaded-index identity, `runtime_metadata_stale` must be reported
