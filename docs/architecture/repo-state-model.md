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
| `.codenexus/runtime.json` | advisory runtime state | `codenexus serve` | Last known local MCP service facts | Yes, but service discovery falls back to live checks only |

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

Example:

```toml
version = 1
port = 4747
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
| `repo_root` | string | Absolute repo root for the service boundary |
| `worktree_root` | string | Absolute worktree path for the service boundary |

### Runtime Precedence

- Live service checks are authoritative.
- `runtime.json` is advisory and may be stale.
- If `runtime.json` claims a service exists but no live service answers, the runtime metadata is stale.
- If a live service answers but `runtime.json` is missing or stale, the live service wins and status must report the runtime metadata mismatch.

Epic 03 limitation:

- until the repo-local HTTP service exists, `codenexus status` only has a bounded TCP port probe
- because that probe cannot prove repo identity on its own, a live configured port with missing `runtime.json` is reported as indexed state plus `runtime_metadata_stale`
- Epic 03 only reports `serving_current` or `serving_stale` when the live probe and runtime metadata agree on the same repo-local service boundary

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

## Freshness Rules

### Current

An index is `current` only when all of the following are true:

- `.codenexus/kuzu/` exists
- `.codenexus/meta.json` exists with required fields
- current HEAD equals `indexed_head`
- current branch equals `indexed_branch`
- current worktree root equals `worktree_root`
- working tree is clean

### Stale

An index is `stale` when any of the following are true:

- HEAD changed
- branch changed
- worktree root changed
- working tree is dirty
- required index files are present but internally inconsistent

V1 freshness is intentionally conservative. Dirty working trees are stale even if `codenexus index` was just run.

If required index artifacts are missing entirely, the repo falls back to `initialized_unindexed` rather than `indexed_stale`.

## Manual Refresh

`codenexus index` is both:

- the initial build command
- the manual refresh command

V1 does not define a separate `codenexus refresh`.

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
| `serving_current` | live service stops | `indexed_current` |
| `serving_current` | freshness becomes stale while service remains live | `serving_stale` |
| `serving_stale` | live service stops | `indexed_stale` |
| `serving_stale` | `codenexus index` completes and freshness becomes current while service remains live | `serving_stale` plus refreshed on-disk index state |

## Status Precedence

`codenexus status` reports:

1. the canonical base state
2. any applicable detail flags
3. whether live service information overrode advisory runtime metadata

Live service truth always wins over `runtime.json`.

Runtime metadata disagreement affects degraded reporting and flags, but it does not by itself redefine whether the local index is current or stale.
