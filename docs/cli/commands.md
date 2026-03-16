# CLI Command Contracts

## Purpose

This document defines the v1 user-facing CLI contract for CodeNexus.

The CLI is split into two planes:

- use plane:
  - `codenexus help`
  - `codenexus query`
  - `codenexus context`
  - `codenexus impact`
  - `codenexus detect-changes`
  - `codenexus cypher`
  - `codenexus rename`
  - `codenexus summary`
- manage plane:
  - `codenexus manage init`
  - `codenexus manage index`
  - `codenexus manage status`
  - `codenexus manage serve`
  - `codenexus manage start`
  - `codenexus manage stop`
  - `codenexus manage restart`

All commands resolve the nearest enclosing git root as the active repo boundary.

## Command-Surface Rules

- top-level structural commands are for daily analysis work
- `codenexus manage ...` is for repo activation, indexing, status, and service lifecycle
- top-level structural commands still use the repo-local MCP HTTP service
- top-level structural commands must not bypass the service or auto-start it
- when the service is unavailable, top-level structural commands fail clearly and point to `codenexus manage start`
- old top-level admin commands and `codenexus info` are removed from the active CLI surface

## `codenexus help`

Print Markdown guidance for installing and using CodeNexus.

Contract:

- read-only
- prints Markdown only
- explains what CodeNexus is and the split between everyday analysis commands and `manage` lifecycle commands
- documents the normal remediation path when the service is unavailable or stale:
  - `codenexus manage start`
  - `codenexus manage index`
  - `codenexus manage restart`
- includes a short example workflow for normal CLI use
- includes brief use cases and example calls for each supported structural command type
- documents owner-biased discovery with `codenexus query --owners`, concise subsystem summary with `codenexus summary --subsystems`, and the explicit detailed alternate `codenexus summary --subsystems-detailed`
- does not mention GitNexus naming, `gitnexus://` resources, API endpoints, MCP, or transport internals in the default help output

## Top-Level Structural Commands

The top-level structural commands are:

- `codenexus query`
- `codenexus context`
- `codenexus impact`
- `codenexus detect-changes`
- `codenexus cypher`
- `codenexus rename`
- `codenexus summary`

Shared contract:

- they are thin clients over the repo-local MCP HTTP service
- they reuse the same tool contracts surfaced by the bound MCP server
- they must connect only to a matching repo-local service for the current repo boundary
- they must fail clearly when:
  - the repo is not initialized
  - the index does not exist yet
  - the repo-local service is not running
  - the configured port is serving a different repo
- they must not silently fall back to direct backend calls, stdio, or another transport
- they must not invent a second semantic result schema beyond thin CLI rendering
- `context`, `impact`, and `rename` use the same disambiguation model:
  - symbol name or `--uid`
  - optional `--file-path` when the symbol name is ambiguous
- `codenexus context` also accepts `--file` as a shorthand alias for `--file-path`
- `codenexus context` and `codenexus impact` may also resolve an obvious engineer-facing module name through the same general lookup stack when it is unambiguous:
  - exact symbol name
  - exported module symbol
  - file basename
  - safe shorthand derived from indexed facts
- `codenexus context` may explain when a Luau module is a weak returned-table wrapper and therefore only exposes grounded delegate members from the returned table
- `codenexus context` may also surface grounded backing-container members for weak returned-table wrappers when the wrapper explicitly delegates into a named local table; those backing members are structural context, not exported module members
- `codenexus impact` may return `affected_areas` when direct blast radius is grounded at the file level but the graph does not attach process or community memberships strongly enough to populate `affected_processes` or `affected_modules`
- `codenexus impact` exposes machine-readable `risk_dimensions` for centrality, coupling breadth, internal concentration, lifecycle complexity, and boundary ambiguity
- `codenexus impact` also exposes `risk_split` so operators can distinguish change risk from local refactor pressure without inferring it manually from raw shape details
- `codenexus impact` exposes `shape.file` for overload analysis, including line count, function count, largest members, hotspot share, and grounded extraction seams when available
- `codenexus summary --subsystems` is the concise subsystem view for daily use
- concise subsystem rows prefer architecturally representative owners and hotspots, and may omit weakly grounded or helper-level labels rather than forcing them into an unrelated subsystem
- `codenexus summary --subsystems-detailed` is the explicit detailed subsystem breakdown
- `codenexus cypher` must surface first-party recovery guidance for both relationship near misses such as `type(r)` and property misses such as `File.lineCount`
- the primary Cypher recovery resources are:
  - `gitnexus://schema`
  - `gitnexus://properties`
  - `gitnexus://properties/{nodeType}`

## `codenexus manage init`

Activate CodeNexus for the current repo boundary.

Contract:

- creates `.codenexus/` if missing
- creates `.codenexus/config.toml` if missing
- initial v1 config uses port `4747`
- initial v1 config enables background auto-index with a `300` second interval
- idempotent when config already exists
- must not create index or runtime files
- must not mutate files outside `.codenexus/`

## `codenexus manage index`

Build or refresh the local repo index.

Contract:

- initial build and manual refresh path
- creates or replaces `.codenexus/kuzu/`
- creates or replaces `.codenexus/meta.json`
- must not rewrite `config.toml`
- must not mutate files outside `.codenexus/`
- owns `.codenexus/index.lock` while an index run is active
- may run on a dirty working tree
- if a service is already running, the live service adopts the rebuilt index automatically in the normal path
- if live reload fails, it must tell the operator how to recover the affected service

## `codenexus manage status`

Report repo configuration, index freshness, and service state.

Contract:

- read-only
- may read `.codenexus/config.toml`, `.codenexus/meta.json`, and `.codenexus/runtime.json`
- may probe the local MCP HTTP service
- live probes are bounded and must not hang indefinitely
- reports:
  - canonical base state
  - applicable detail flags
  - configured port
  - background auto-index config and runtime facts when available
  - whether stale serving is caused primarily by dirty state, divergence, pending live adoption, reload failure, or auto-index backoff

## `codenexus manage serve`

Start the repo-local MCP HTTP service for the active repo boundary in the foreground.

Contract:

- fails if the repo is uninitialized
- fails if no usable index exists
- binds the configured port only
- writes `.codenexus/runtime.json` on successful startup
- removes `.codenexus/runtime.json` on graceful shutdown
- may serve a stale index only with explicit degraded reporting
- must not run background auto-index polling

## `codenexus manage start`

Start the same repo-local MCP HTTP service in detached background mode.

Contract:

- uses the same runtime implementation and health contract as `codenexus manage serve`
- fails loudly if the matching repo-local service is already running
- only detached background mode may run automatic freshness polling
- when `auto_index = true`, polls for repo divergence every `auto_index_interval_seconds`
- branch switches and dirty-state flips are treated as ordinary repo divergence
- must not trigger auto-index while another `codenexus manage index` run or live reload is already in flight
- repeated auto-index failures must back off and remain visible through `codenexus manage status`

## `codenexus manage stop`

Stop the repo-local background service for the active repo boundary.

Contract:

- targets only the matching repo-local service
- must not stop unrelated processes or services for other repos

## `codenexus manage restart`

Restart the repo-local background service for the active repo boundary.

Contract:

- deterministic stop/start cycle
- uses the same detached runtime as `codenexus manage start`

## Wrong-Context Behavior

If a command is run:

- from inside a nested repo, the nested repo boundary applies
- from inside a worktree, that worktree boundary applies

No command may silently target a parent repo when a nearer git root exists.
