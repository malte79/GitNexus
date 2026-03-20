# Repo-Local Implementation

## Purpose

This document maps the locked gnexus runtime contract onto the current repo-local implementation.

## Owning Modules

| Surface | Owning module | Responsibility |
|---|---|---|
| repo boundary resolution | [git.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/storage/git.ts) | nearest git root, current branch, current commit, dirty-worktree checks |
| `.gnexus` paths and file contracts | [repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/storage/repo-manager.ts) | config, meta, runtime paths; schema validation; repo-state evaluation |
| repo-bound query engine coordinator | [local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend.ts) | one bound repo, one Kuzu handle, one active tool surface, and delegation across the repo-local analysis stack |
| repo-local runtime/repo support | [local-backend-runtime-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-runtime-support.ts) | nearest-repo resolution, bound repo handle refresh, cached repo context, and repo-freshness summary for the local backend stack |
| repo-local graph utility support | [local-backend-graph-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-graph-support.ts) | owner recovery, contained-member recovery, affected-area shaping, and shared graph utility classification for local backend tools |
| repo-local search/query seam | [local-backend-search-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-support.ts) | thin repo-local query seam that delegates search lookup, enrichment, ranking, and response shaping |
| repo-local search lookup support | [local-backend-search-lookup-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-lookup-support.ts) | exact-name lookup, alias normalization, shorthand resolution, and symbol hydration by id |
| repo-local search enrichment support | [local-backend-search-enrichment-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-enrichment-support.ts) | Rojo project mapping, primary module recovery, boundary-import enrichment, and broad-query file signals |
| repo-local search ranking support | [local-backend-search-ranking-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-ranking-support.ts) | broad-query classification, owner penalties, representative boosts, and final search-result scoring |
| repo-local search query support | [local-backend-search-query-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-query-support.ts) | BM25 retrieval, process association, result shaping, and owner-mode response assembly |
| repo-local Cypher support | [local-backend-cypher-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-cypher-support.ts) | read-only Cypher execution, write-block enforcement, and operator-facing Cypher recovery guidance |
| repo-local summary presentation support | [local-backend-summary-presentation-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-summary-presentation-support.ts) | concise subsystem row shaping, representative scoring, label normalization, and low-signal/broad-bucket penalties |
| repo-local summary query support | [local-backend-summary-query-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-summary-query-support.ts) | subsystem graph queries, cluster/process aggregation, and direct cluster/process detail queries |
| repo-local overview support | [local-backend-overview-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-overview-support.ts) | summary/overview assembly, top-symbol shaping, and concise subsystem-mode closeout |
| repo-local analysis seam | [local-backend-analysis-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-analysis-support.ts) | thin repo-local analysis seam that delegates shape, context, impact, change detection, and rename work |
| repo-local shape support | [local-backend-shape-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-shape-support.ts) | overload-shape scoring, grounded extraction seams, and file-level structural pressure shaping |
| repo-local context support | [local-backend-context-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-context-support.ts) | symbol lookup closeout, member-based context expansion, and context coverage reporting |
| repo-local impact support | [local-backend-impact-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-impact-support.ts) | direct traversal impact analysis, propagated module/process shaping, and machine-readable risk reporting |
| repo-local change-detection support | [local-backend-detect-changes-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-detect-changes-support.ts) | git diff scope handling, changed-symbol recovery, and affected-process shaping |
| repo-local change-contract types | [local-backend-change-contract-types.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-types.ts) | bounded-confidence change-contract output shapes, evidence buckets, and verification mismatch schema |
| repo-local change-evidence support | [local-backend-change-evidence-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-evidence-support.ts) | reuse-first evidence collection from query, impact, owner overlap, and test adjacency |
| repo-local change-contract support | [local-backend-change-contract-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-support.ts) | pre-change contract assembly for `plan-change` |
| repo-local verify-change support | [local-backend-verify-change-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-verify-change-support.ts) | post-change mismatch classification and contract-insufficiency detection |
| repo-local rename support | [local-backend-rename-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-rename-support.ts) | rename dry-run/apply planning, grounded reference edits, and bounded text-search expansion |
| repo-local shared backend primitives | [local-backend-common.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-common.ts), [local-backend-types.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-types.ts) | shared repo-local constants, logging helpers, and internal MCP/backend types |
| agent-facing tool schema | [tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/tools.ts) | single-repo tool contracts with no repo routing |
| agent-facing resources | [resources.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/resources.ts) | single-repo resource URIs with no repo discovery |
| top-level CLI entrypoint | [index.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/index.ts) | use-plane versus manage-plane command tree |
| top-level help surface | [info.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/info.ts) | Markdown guidance for the use plane and everyday CLI workflow |
| CLI MCP client wrapper | [mcp-command-client.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/mcp-command-client.ts) | repo-match checks, bounded service connection, and tool passthrough |
| lifecycle shims | [init.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/init.ts), [index-command.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/index-command.ts), [status.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/status.ts), [serve.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/serve.ts), [start.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/start.ts), [stop.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/stop.ts), [restart.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/restart.ts) | repo activation, index lifecycle, status, and service lifecycle |
| service runtime | [service-runtime.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/server/service-runtime.ts) | bind the HTTP server, own graceful shutdown, maintain runtime metadata, and run background auto-index polling |

## Active State Layout

The active repo-local layout is:

- `.gnexus/config.toml`
- `.gnexus/meta.json`
- `.gnexus/kuzu/`
- `.gnexus/runtime.json`
- `.gnexus/index.lock`

`gnexus manage index` owns `.gnexus/index.lock` while an index run is active so manual and background reindex attempts serialize on one repo boundary.

The live service health contract exposes the loaded index identity the service actually opened at startup. That identity is the source of truth for serving freshness, while `runtime.json` persists the same facts only as advisory recovery state.

## Active CLI Surface

The current CLI surface is intentionally split:

- use plane:
  - `gnexus help`
  - `gnexus query`
  - `gnexus context`
  - `gnexus impact`
  - `gnexus plan-change`
  - `gnexus verify-change`
  - `gnexus detect-changes`
  - `gnexus cypher`
  - `gnexus rename`
  - `gnexus summary`
- manage plane:
  - `gnexus manage init`
  - `gnexus manage index`
  - `gnexus manage status`
  - `gnexus manage serve`
  - `gnexus manage start`
  - `gnexus manage stop`
  - `gnexus manage restart`

The top-level structural commands are thin HTTP clients over the repo-local MCP service. They do not bypass the service and do not auto-start it.

## Runtime Notes

- `gnexus manage serve` starts the repo-local HTTP service directly
- `gnexus manage start` runs the same service in detached background mode
- only detached background mode owns automatic freshness polling
- successful background auto-index still reuses the normal `gnexus manage index` path and the existing live-reload adoption path
- failure and backoff state is surfaced through `runtime.json`, `/api/health`, and `gnexus manage status`

## Query Surface Notes

The bound MCP tool surface is now:

- `summary`
- `query`
- `context`
- `impact`
- `detect_changes`
- `rename`
- `cypher`
- `plan_change`
- `verify_change`

Implementation posture:

- `LocalBackend` is now a thin repo-local coordinator rather than the prior god-module. It owns tool dispatch, repo binding, and a small number of compatibility-facing helper methods that tests and resources call intentionally.
- The repo-local backend stack is split into focused internal owners:
  - repo-bound runtime and freshness handling live in [local-backend-runtime-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-runtime-support.ts)
  - shared graph utility and owner/member recovery live in [local-backend-graph-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-graph-support.ts)
  - the search/query public seam lives in [local-backend-search-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-support.ts)
  - search alias lookup and symbol hydration live in [local-backend-search-lookup-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-lookup-support.ts)
  - search enrichment and Rojo/module recovery live in [local-backend-search-enrichment-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-enrichment-support.ts)
  - search ranking, penalties, and representative scoring live in [local-backend-search-ranking-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-ranking-support.ts)
  - search response assembly and process shaping live in [local-backend-search-query-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-search-query-support.ts)
  - read-only Cypher execution and recovery guidance live in [local-backend-cypher-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-cypher-support.ts)
  - concise subsystem presentation and representative scoring live in [local-backend-summary-presentation-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-summary-presentation-support.ts)
  - subsystem graph queries, cluster aggregation, and direct cluster/process detail queries live in [local-backend-summary-query-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-summary-query-support.ts)
  - overview assembly and top-symbol shaping live in [local-backend-overview-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-overview-support.ts)
- the analysis public seam lives in [local-backend-analysis-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-analysis-support.ts)
- overload-shape and extraction-seam analysis live in [local-backend-shape-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-shape-support.ts)
- symbol context expansion and coverage reporting live in [local-backend-context-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-context-support.ts)
- impact traversal and blast-radius shaping live in [local-backend-impact-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-impact-support.ts)
- git diff and affected-process shaping live in [local-backend-detect-changes-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-detect-changes-support.ts)
- bounded-confidence contract shapes live in [local-backend-change-contract-types.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-types.ts)
- reuse-first contract evidence collection lives in [local-backend-change-evidence-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-evidence-support.ts)
- pre-change contract assembly lives in [local-backend-change-contract-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-support.ts)
- post-change mismatch classification and contract-insufficiency checks live in [local-backend-verify-change-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-verify-change-support.ts)
- rename planning and bounded edit application live in [local-backend-rename-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-rename-support.ts)
- Support modules bind to each other directly through explicit host interfaces where needed; the coordinator is no longer a broad internal facade or the practical routing sink for summary, detail-query, and Cypher authority.
- shared repo-local backend constants and internal types live in [local-backend-common.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-common.ts) and [local-backend-types.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-types.ts); they do not introduce a second public MCP or CLI contract
- `query` remains BM25-plus-graph retrieval with deterministic ranking adjustments
- `summary` is a read-only overview derived from existing graph facts
- `summary --subsystems` is the concise subsystem-oriented architectural view for daily use, including grounded owners, hotspots, lifecycle chokepoints, and production-versus-test split
- `summary --subsystems-detailed` keeps the fuller subsystem breakdown behind an explicit alternate flag on the same surface
- concise subsystem output now prefers specific, structurally grounded subsystem rows and architecturally representative owners and hotspots; weakly grounded or helper-level labels may be omitted rather than forced into an unrelated bucket
- concise subsystem output now evaluates a broader candidate pool before truncating the first screen and ranks candidates by representative quality rather than raw discovery order; broad or low-signal buckets are penalized so stronger grounded subsystem rows win ties
- `context` prefers direct relationships, but may supplement container symbols with member-based relationships and explicit partial-coverage reporting
- `context` and `impact` share the same deterministic obvious-name lookup stack for unambiguous module surfaces: exact symbol, exported module symbol, file basename, then safe shorthand derived from indexed facts
- `context` may recover file members from grounded file-level definitions when direct file container edges are missing, while keeping partial-confidence reporting explicit
- `context` now explicitly distinguishes weak Luau returned-table wrappers from richer exported modules so thin wrapper modules do not look like hollow failures
- when a weak Luau wrapper explicitly delegates into a named local table, `context` may surface that backing table's grounded members as structural context without pretending those members are exported directly by the wrapper
- `impact` prefers direct graph traversal, but may expand through contained members or grounded file-level definitions for file targets and report partial confidence when container-symbol coverage is incomplete
- `plan-change` is the bounded-confidence planning surface built from existing query, impact, owner, and test-adjacency evidence rather than a parallel planner runtime
- `plan-change` must separate `grounded`, `strong_inference`, and `hypothesis` evidence explicitly for every substantive recommendation
- for broad behavioral or runtime goals, `plan-change` now reranks grounded surfaces using repeated prompt-term agreement, source agreement across path or symbol sources, and owner-like-versus-helper shape so coherent subsystem owners can outrank isolated helper hits
- that broad-goal reranking may demote ancillary paths such as playtests, scenarios, sandboxes, or examples when the prompt is not explicitly about those surfaces; explicit ancillary-target prompts disable that demotion
- when a concentrated owner is recovered but direct propagation remains sparse, `plan-change` may reuse tracked-file adjacency and content-grounded search to surface nearby proof or debug companions, Luau spec or test files, documentation companions, and same-file hotspot members through the existing contract fields instead of widening the response schema
- `verify-change` compares a real or claimed change set against one contract and preserves `contract_insufficiency` separately from implementation misses
- `impact` may surface `affected_areas` from direct file-level callers when process or community memberships are not grounded enough to populate `affected_processes` or `affected_modules`
- `impact` now shares the same disambiguation inputs as `context` and `rename`, including `--uid` and `--file-path`
- `impact` now exposes machine-readable `risk_dimensions`, `risk_split`, and `shape.file` so operators can separate change risk, local refactor pressure, and raw overload shape on one surface
- when direct traversal is sparse for a concentrated owner, `impact` may keep higher-level blast-radius fields empty while using `coverage.note` and `shape.file.largest_members` to surface bounded same-file hotspot guidance rather than inventing process or module propagation
- `cypher` stays read-only and now adds friendlier recovery guidance for near misses such as `type(r)` and property misses such as `File.lineCount`
- Cypher schema and property discoverability are exposed through `gnexus://schema`, `gnexus://properties`, and `gnexus://properties/{nodeType}`
