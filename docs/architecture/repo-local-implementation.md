# Repo-Local Implementation

## Purpose

This document maps the locked CodeNexus runtime contract onto the current repo-local implementation.

## Owning Modules

| Surface | Owning module | Responsibility |
|---|---|---|
| repo boundary resolution | [git.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/git.ts) | nearest git root, current branch, current commit, dirty-worktree checks |
| `.codenexus` paths and file contracts | [repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts) | config, meta, runtime paths; schema validation; repo-state evaluation |
| repo-bound query engine | [local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts) | one bound repo, one Kuzu handle, one active tool surface |
| agent-facing tool schema | [tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts) | single-repo tool contracts with no repo routing |
| agent-facing resources | [resources.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/resources.ts) | single-repo resource URIs with no repo discovery |
| top-level CLI entrypoint | [index.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index.ts) | use-plane versus manage-plane command tree |
| top-level help surface | [info.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/info.ts) | Markdown guidance for the use plane and everyday CLI workflow |
| CLI MCP client wrapper | [mcp-command-client.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/mcp-command-client.ts) | repo-match checks, bounded service connection, and tool passthrough |
| lifecycle shims | [init.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/init.ts), [index-command.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index-command.ts), [status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts), [serve.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/serve.ts), [start.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/start.ts), [stop.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/stop.ts), [restart.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/restart.ts) | repo activation, index lifecycle, status, and service lifecycle |
| service runtime | [service-runtime.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/service-runtime.ts) | bind the HTTP server, own graceful shutdown, maintain runtime metadata, and run background auto-index polling |

## Active State Layout

The active repo-local layout is:

- `.codenexus/config.toml`
- `.codenexus/meta.json`
- `.codenexus/kuzu/`
- `.codenexus/runtime.json`
- `.codenexus/index.lock`

`codenexus manage index` owns `.codenexus/index.lock` while an index run is active so manual and background reindex attempts serialize on one repo boundary.

The live service health contract exposes the loaded index identity the service actually opened at startup. That identity is the source of truth for serving freshness, while `runtime.json` persists the same facts only as advisory recovery state.

## Active CLI Surface

The current CLI surface is intentionally split:

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

The top-level structural commands are thin HTTP clients over the repo-local MCP service. They do not bypass the service and do not auto-start it.

## Runtime Notes

- `codenexus manage serve` starts the repo-local HTTP service directly
- `codenexus manage start` runs the same service in detached background mode
- only detached background mode owns automatic freshness polling
- successful background auto-index still reuses the normal `codenexus manage index` path and the existing live-reload adoption path
- failure and backoff state is surfaced through `runtime.json`, `/api/health`, and `codenexus manage status`

## Query Surface Notes

The bound MCP tool surface is now:

- `summary`
- `query`
- `context`
- `impact`
- `detect_changes`
- `rename`
- `cypher`

Implementation posture:

- `query` remains BM25-plus-graph retrieval with deterministic ranking adjustments
- `summary` is a read-only overview derived from existing graph facts
- `summary --subsystems` is the concise subsystem-oriented architectural view for daily use, including grounded owners, hotspots, lifecycle chokepoints, and production-versus-test split
- `summary --subsystems-detailed` keeps the fuller subsystem breakdown behind an explicit alternate flag on the same surface
- concise subsystem output now prefers specific, structurally grounded subsystem rows and architecturally representative owners and hotspots; weakly grounded or helper-level labels may be omitted rather than forced into an unrelated bucket
- `context` prefers direct relationships, but may supplement container symbols with member-based relationships and explicit partial-coverage reporting
- `context` and `impact` share the same deterministic obvious-name lookup stack for unambiguous module surfaces: exact symbol, exported module symbol, file basename, then safe shorthand derived from indexed facts
- `context` may recover file members from grounded file-level definitions when direct file container edges are missing, while keeping partial-confidence reporting explicit
- `context` now explicitly distinguishes weak Luau returned-table wrappers from richer exported modules so thin wrapper modules do not look like hollow failures
- when a weak Luau wrapper explicitly delegates into a named local table, `context` may surface that backing table's grounded members as structural context without pretending those members are exported directly by the wrapper
- `impact` prefers direct graph traversal, but may expand through contained members or grounded file-level definitions for file targets and report partial confidence when container-symbol coverage is incomplete
- `impact` may surface `affected_areas` from direct file-level callers when process or community memberships are not grounded enough to populate `affected_processes` or `affected_modules`
- `impact` now shares the same disambiguation inputs as `context` and `rename`, including `--uid` and `--file-path`
- `impact` now exposes machine-readable `risk_dimensions`, `risk_split`, and `shape.file` so operators can separate change risk, local refactor pressure, and raw overload shape on one surface
- `cypher` stays read-only and now adds friendlier recovery guidance for near misses such as `type(r)` and property misses such as `File.lineCount`
- Cypher schema and property discoverability are exposed through `gitnexus://schema`, `gitnexus://properties`, and `gitnexus://properties/{nodeType}`
