# Repo State Model

## Purpose

This document defines the v1 `.gnexus/` layout, config and runtime ownership, canonical repo states, and freshness semantics.

## `.gnexus/` Layout

| Path | Type | Created by | Purpose | Safe to delete |
|---|---|---|---|---|
| `.gnexus/` | container | `gnexus manage init` | Repo-local GNexus state root | No |
| `.gnexus/config.toml` | config | `gnexus manage init` | User-owned repo config | No |
| `.gnexus/meta.json` | derived index metadata | `gnexus manage index` | Index metadata used for status and freshness checks | Yes, but index becomes unavailable |
| `.gnexus/kuzu/` | derived index state | `gnexus manage index` | Kuzu graph store for this repo boundary | Yes, but index becomes unavailable |
| `.gnexus/runtime.json` | advisory runtime state | `gnexus manage serve` or `gnexus manage start` | Last known local HTTP service facts | Yes, but service discovery falls back to live checks only |
| `.gnexus/index.lock` | advisory index lock | `gnexus manage index` | Serialize manual and background index runs for one repo boundary | Yes, but only when no index is active |

## Config Contract

Canonical path:

- `.gnexus/config.toml`

Required fields:

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | Config schema version. V1 value: `1` |
| `port` | integer | Repo-local MCP HTTP port for this repo boundary |
| `auto_index` | boolean | Whether detached background mode should auto-index when the repo diverges. Default: `true` |
| `auto_index_interval_seconds` | integer | Poll interval for detached background auto-index. Default: `300` |

Rewrite rules:

- `gnexus manage init` creates `config.toml` if absent
- `gnexus manage init` is idempotent if `config.toml` already exists
- `gnexus manage init` must not silently replace an existing configured port or other user-owned config
- `gnexus manage index`, `gnexus manage status`, and the service runtime must never rewrite `config.toml`

## Runtime Metadata Contract

Runtime metadata is advisory only.

Canonical path:

- `.gnexus/runtime.json`

Required fields:

- service PID
- configured port
- start time
- service mode (`foreground` or `background`)
- repo root
- worktree root
- loaded-index identity
- optional reload failure details
- optional background auto-index status

Runtime precedence:

- live service checks are authoritative
- `runtime.json` is advisory and may be stale
- if `runtime.json` claims a service exists but no live service answers, the runtime metadata is stale
- if a live service answers but `runtime.json` is missing or stale, live health wins and status must report the mismatch

## Canonical Base States

| State | Meaning |
|---|---|
| `uninitialized` | `.gnexus/config.toml` is missing |
| `invalid_config` | `.gnexus/config.toml` exists but is invalid for the v1 config contract |
| `initialized_unindexed` | config exists, but no usable index exists |
| `indexed_current` | index exists and is current for the repo boundary |
| `indexed_stale` | index exists, but freshness checks mark it stale |
| `serving_current` | live MCP service exists and the loaded index is current |
| `serving_stale` | live MCP service exists and the loaded index is stale or behind on-disk state |

## Detail Flags

| Flag | Meaning |
|---|---|
| `runtime_metadata_stale` | `runtime.json` disagrees with live service checks |
| `working_tree_dirty` | working tree is dirty at status time |
| `head_changed` | current HEAD differs from `meta.json.indexed_head` |
| `branch_changed` | current branch differs from `meta.json.indexed_branch` |
| `wrong_worktree` | metadata was produced in a different worktree root |
| `service_restart_required` | live service is still serving an older loaded index than the current on-disk index |

## Freshness Rules

An index is current only when all of the following are true:

- `.gnexus/kuzu/` exists
- `.gnexus/meta.json` exists with required fields
- current HEAD equals `indexed_head`
- current branch equals `indexed_branch`
- current worktree root equals `worktree_root`
- current dirty state matches `indexed_dirty`

An index is stale when any of those checks fail.

Serving states require:

- a successful service-identity response from `/api/health`
- matching repo root, worktree root, and configured port
- loaded-index identity evaluated against current on-disk metadata

## Manual And Background Refresh

`gnexus manage index` is both:

- the initial build command
- the manual refresh command

When a service is already running:

- `gnexus manage index` refreshes on-disk index state
- the running service should adopt the rebuilt index automatically in the normal path
- while live adoption is still in progress, status may report `serving_stale` with `service_restart_required`
- if live reload fails, the service continues serving the previous loaded index until the operator recovers it

In detached background mode:

- background auto-index is controlled by `config.toml`
- only `gnexus manage start` or `gnexus manage restart` may trigger automatic reindex attempts
- background auto-index uses the same freshness inputs as canonical repo-state evaluation
- background auto-index skips while another index is already running or a live reload is still in progress
- successful background auto-index still relies on the normal live-reload path for adoption
- repeated failures enter temporary backoff and must be surfaced through `runtime.json`, live health, and `gnexus manage status`

## Status Reporting

`gnexus manage status` reports:

1. the canonical base state
2. any applicable detail flags
3. whether live service information overrode advisory runtime metadata

`gnexus summary --subsystems` reuses that same freshness source for `state`, `indexed_commit`, and `current_commit` so operators do not have to reconcile a second commit identity surface.

When stale serving is reported, status should make the dominant cause legible without changing the underlying state model. Common causes include:

- dirty working tree divergence
- HEAD or branch divergence
- pending live adoption of refreshed on-disk state
- live-reload failure
- auto-index failure backoff
