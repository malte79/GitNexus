# CLI Command Contracts

## Purpose

This document defines the v1 user-facing CLI contract for gnexus.

The CLI is split into two planes:

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

All commands resolve the nearest enclosing git root as the active repo boundary.

## Command-Surface Rules

- top-level structural commands are for daily analysis work
- `gnexus manage ...` is for repo activation, indexing, status, and service lifecycle
- top-level structural commands still use the repo-local MCP HTTP service
- top-level structural commands must not bypass the service or auto-start it
- when the service is unavailable, top-level structural commands fail clearly and point to `gnexus manage start`
- old top-level admin commands and `gnexus info` are removed from the active CLI surface

## `gnexus help`

Print Markdown guidance for installing and using gnexus.

Contract:

- read-only
- prints Markdown only
- explains what gnexus is and the split between everyday analysis commands and `manage` lifecycle commands
- teaches a practical command-selection flow so users know when to start with `plan-change`, when to use `query --owners`, when to drill into `context` or `impact`, when to use `detect-changes`, and when to run `verify-change`
- documents the normal remediation path when the service is unavailable or stale:
  - `gnexus manage start`
  - `gnexus manage index`
  - `gnexus manage restart`
- includes a short example workflow for normal CLI use
- includes brief use cases and example calls for each supported structural command type
- includes at least one cross-cutting workflow, one narrow-symbol workflow, and one QA/security-oriented workflow
- documents owner-biased discovery with `gnexus query --owners`, concise subsystem summary with `gnexus summary --subsystems`, and the explicit detailed alternate `gnexus summary --subsystems-detailed`
- does not mention retired product names, `gnexus://` resources, API endpoints, MCP, or transport internals in the default help output

## Top-Level Structural Commands

The top-level structural commands are:

- `gnexus query`
- `gnexus context`
- `gnexus impact`
- `gnexus plan-change`
- `gnexus verify-change`
- `gnexus detect-changes`
- `gnexus cypher`
- `gnexus rename`
- `gnexus summary`

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
- `gnexus context` also accepts `--file` as a shorthand alias for `--file-path`
- `gnexus context` and `gnexus impact` may also resolve an obvious engineer-facing module name through the same general lookup stack when it is unambiguous:
  - exact symbol name
  - exported module symbol
  - file basename
  - safe shorthand derived from indexed facts
- `gnexus context` may explain when a Luau module is a weak returned-table wrapper and therefore only exposes grounded delegate members from the returned table
- `gnexus context` may also surface grounded backing-container members for weak returned-table wrappers when the wrapper explicitly delegates into a named local table; those backing members are structural context, not exported module members
- `gnexus impact` may return `affected_areas` when direct blast radius is grounded at the file level but the graph does not attach process or community memberships strongly enough to populate `affected_processes` or `affected_modules`
- `gnexus impact` exposes machine-readable `risk_dimensions` for centrality, coupling breadth, internal concentration, lifecycle complexity, and boundary ambiguity
- `gnexus impact` also exposes `risk_split` so operators can distinguish change risk from local refactor pressure without inferring it manually from raw shape details
- `gnexus impact` exposes `shape.file` for overload analysis, including line count, function count, largest members, hotspot share, and grounded extraction seams when available
- `gnexus plan-change` is the bounded-confidence planning surface for agents
- `gnexus plan-change` is the preferred starting point for broad, cross-cutting, multi-file, QA-oriented, or security-oriented work that needs one shared edit-and-test contract
- `gnexus plan-change` must return:
  - one explicit `confidence_posture: bounded`
  - evidence buckets for `grounded`, `strong_inference`, and `hypothesis`
  - `required_edit_surfaces`
  - `likely_dependent_surfaces`
  - `recommended_tests`
  - `risk_notes`
  - `unknowns`
- for broad behavioral or runtime requests, `gnexus plan-change` may rerank broad owner candidates by repeated prompt-term agreement and subsystem cohesion so a coherent owner cluster can beat an isolated helper or incidental subsystem hit
- for those same broad requests, `gnexus plan-change` should prefer owner-like anchors such as files, modules, classes, services, controllers, orchestrators, or runtime owners over isolated methods or functions when the evidence is otherwise similar
- broad-request ranking may demote ancillary surfaces such as playtests, scenarios, sandboxes, or examples when the prompt does not explicitly target them; that demotion must turn off when the prompt is explicitly about one of those ancillary surfaces
- `gnexus plan-change` must not claim full codebase understanding or flatten all evidence into one unlabeled recommendation set
- `gnexus verify-change` is the bounded-confidence verification surface for agents
- `gnexus verify-change` is the follow-through command after editing or before handoff, not the replacement for initial planning
- `gnexus verify-change` must preserve these mismatch categories:
  - `missing_grounded_surfaces`
  - `unreviewed_inferred_surfaces`
  - `out_of_contract_touched_surfaces`
  - `missing_recommended_tests`
  - `contract_insufficiency`
- `gnexus verify-change` must not silently collapse contract defects into implementation misses
- `gnexus summary --subsystems` is the concise subsystem view for daily use
- concise subsystem rows prefer architecturally representative owners and hotspots, and may omit weakly grounded or helper-level labels rather than forcing them into an unrelated subsystem
- concise subsystem rows evaluate a wider candidate set before truncation and rank by representative quality, so broad or weakly grounded buckets do not crowd out stronger subsystem rows just because they were discovered earlier
- `gnexus summary --subsystems-detailed` is the explicit detailed subsystem breakdown
- `gnexus cypher` must surface first-party recovery guidance for both relationship near misses such as `type(r)` and property misses such as `File.lineCount`
- the primary Cypher recovery resources are:
  - `gnexus://schema`
  - `gnexus://properties`
  - `gnexus://properties/{nodeType}`

## `gnexus manage init`

Activate gnexus for the current repo boundary.

Contract:

- creates `.gnexus/` if missing
- creates `.gnexus/config.toml` if missing
- initial v1 config uses port `4747`
- initial v1 config enables background auto-index with a `300` second interval
- idempotent when config already exists
- must not create index or runtime files
- must not mutate files outside `.gnexus/`

## `gnexus manage index`

Build or refresh the local repo index.

Contract:

- initial build and manual refresh path
- creates or replaces `.gnexus/kuzu/`
- creates or replaces `.gnexus/meta.json`
- must not rewrite `config.toml`
- must not mutate files outside `.gnexus/`
- owns `.gnexus/index.lock` while an index run is active
- may run on a dirty working tree
- if a service is already running, the live service adopts the rebuilt index automatically in the normal path
- if live reload fails, it must tell the operator how to recover the affected service

## `gnexus manage status`

Report repo configuration, index freshness, and service state.

Contract:

- read-only
- may read `.gnexus/config.toml`, `.gnexus/meta.json`, and `.gnexus/runtime.json`
- may probe the local MCP HTTP service
- live probes are bounded and must not hang indefinitely
- reports:
  - canonical base state
  - applicable detail flags
  - configured port
  - background auto-index config and runtime facts when available
  - whether stale serving is caused primarily by dirty state, divergence, pending live adoption, reload failure, or auto-index backoff

## `gnexus manage serve`

Start the repo-local MCP HTTP service for the active repo boundary in the foreground.

Contract:

- fails if the repo is uninitialized
- fails if no usable index exists
- binds the configured port only
- writes `.gnexus/runtime.json` on successful startup
- removes `.gnexus/runtime.json` on graceful shutdown
- may serve a stale index only with explicit degraded reporting
- must not run background auto-index polling

## `gnexus manage start`

Start the same repo-local MCP HTTP service in detached background mode.

Contract:

- uses the same runtime implementation and health contract as `gnexus manage serve`
- fails loudly if the matching repo-local service is already running
- only detached background mode may run automatic freshness polling
- when `auto_index = true`, polls for repo divergence every `auto_index_interval_seconds`
- branch switches and dirty-state flips are treated as ordinary repo divergence
- must not trigger auto-index while another `gnexus manage index` run or live reload is already in flight
- repeated auto-index failures must back off and remain visible through `gnexus manage status`

## `gnexus manage stop`

Stop the repo-local background service for the active repo boundary.

Contract:

- targets only the matching repo-local service
- must not stop unrelated processes or services for other repos

## `gnexus manage restart`

Restart the repo-local background service for the active repo boundary.

Contract:

- deterministic stop/start cycle
- uses the same detached runtime as `gnexus manage start`

## Wrong-Context Behavior

If a command is run:

- from inside a nested repo, the nested repo boundary applies
- from inside a worktree, that worktree boundary applies

No command may silently target a parent repo when a nearer git root exists.

## Change-Contract Acceptance Bar

Epic 20 closed on the reduced six-task orientation benchmark, not the original full telemetry study.

The preserved shipping evidence requires:

- no regression in initial-plan correctness on the pinned slice
- no regression in QA or security expected-test coverage on the pinned slice
- a strictly better candidate success count than baseline on that slice
- lower wall-clock time and lower tool-call count on the tasks where both baseline and candidate reach a viable initial plan

That reduced-bar evidence is preserved in:

- [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/orientation-shipping-slice.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/orientation-shipping-slice.json)

The deeper benchmark harness remains available for future studies, but it is not the current ship blocker.
