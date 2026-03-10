# Master Intent

## Current Direction

This fork is evolving from `GitNexus` into `CodeNexus`, a globally installed but repo-activated tool for AI-agent code intelligence. The canonical executable will be `codenexus`, but the broader rename remains lazy and incremental outside the user-facing CLI/product surface. One concrete rename already chosen at the product-design level is the repo-local state directory: use `.codenexus/` instead of `.gitnexus/`.

## Core Product Intent

Each repository should be self-contained and isolated. A repo that uses the tool is explicitly activated, and all index data plus runtime metadata should live only under `.codenexus/`. The tool should not mutate other files in the repo by default. The previously added `--index-only` behavior is important because it already aligns with that principle, and the broader product direction is pushing toward making that model the norm rather than an exception.

## V1 Invariants

- CodeNexus may create or update repo state only under `.codenexus/`
- The no-mutation rule outside `.codenexus/` is absolute
- The nearest enclosing git root is the operative repo boundary
- Nested git repos are separate repo boundaries from their parents
- Git worktrees are separate runtime boundaries in v1
- The primary runtime interface is repo-local MCP over HTTP
- Runtime metadata is advisory only; live service checks are authoritative
- A stale index may be served only with explicit degraded reporting

## V1 Non-Goals

- global multi-repo control-plane behavior
- stdio as the primary runtime transport
- automatic background freshness guarantees
- branch-specific index stores
- repo mutation outside `.codenexus/`
- human-oriented visualization as a core product surface
- a storage-engine migration away from Kuzu

## Architecture Direction

The product should not retain the current shared global control-plane model. Today the code stores the heavy index locally but still relies on a global registry and multi-repo routing. We confirmed that the current MCP server is not talking to a separate backend daemon; it is the backend. It loads a `LocalBackend`, resolves repos through the global registry, and queries each repo's local Kuzu DB directly.

Based on that, a separate daemon is not automatically justified. If all it would do is wrap Kuzu, it adds unnecessary complexity. For agent use, the desired system is a stable repo-local API surface rather than raw DB access. The preferred model is:

`agent <-> repo-local MCP server <-> local repo Kuzu DB`

Epic 03 implements the architectural pivot underneath the retained `gitnexus` shims:

- `.codenexus/` is now the only active repo-state boundary
- the backend is bound to one repo boundary
- the old global registry and repo-discovery affordances are no longer part of the active runtime model

## Transport Decision

HTTP is the chosen transport, not stdio, for the repo-local MCP service. The intended model is a long-lived, repo-scoped service with a configured port. That fits HTTP naturally. Stdio is better for client-spawned ephemeral MCP processes, which is not the desired product shape.

## Operational Model

- `codenexus init`
  - run inside a repo to activate CodeNexus for that repo
  - creates `.codenexus/`
  - writes repo-local config
- `codenexus index`
  - builds or refreshes the local index in `.codenexus/`
- `codenexus serve`
  - starts a repo-specific MCP HTTP server
  - serves only that repo
  - listens on the port defined in repo-local config
  - writes advisory runtime metadata under `.codenexus/`
- `codenexus status`
  - reports repo config, freshness, and whether the local MCP service is running

Durable command and runtime contracts live in:

- [product-and-runtime-boundary.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/product-and-runtime-boundary.md)
- [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md)
- [commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md)
- [mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md)
- [repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md)

## Config And Runtime State

Config and live state must be separate.

- Config should live in `.codenexus/`, created by `codenexus init`
- Config should include at least the port for the repo-local MCP service
- Runtime or live state should also live under `.codenexus/`, but in separate files from config
- Runtime state would cover things like PID, active port, timestamps, and service health markers

The v1 contract is intentionally minimal:

- `.codenexus/config.toml`
- `.codenexus/meta.json`
- `.codenexus/kuzu/`
- `.codenexus/runtime.json`

## Freshness And Indexing

Automatic freshness should not be overpromised at the start. Manual refresh is acceptable for v1. The desirable future direction is smart refresh using deltas rather than full rebuilds, but the current codebase does not yet support true incremental graph refresh. Today it can skip a rebuild if the commit is unchanged, but a changed repo still triggers a full rebuild.

The v1 repo-state model uses a finite base-state set with detail flags rather than pretending the runtime is fully self-healing. Durable freshness and state-transition rules live in [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md).

Manual refresh in v1 is explicit:

- `codenexus index` refreshes the on-disk index
- a running service may continue serving an older loaded index
- restarting `codenexus serve` is required before the live service adopts the refreshed index

## Scope And Priorities

- The tool is explicitly meant to be a backend utility for AI agents to understand and navigate codebases faster and with less brute-force searching
- Narrowing who and what is supported is acceptable if it helps achieve that cleanly
- The work should proceed one step at a time rather than trying to land repo-local state, HTTP MCP, refresh semantics, and broader rebranding all at once

## Documentation Discipline

- CodeNexus-owned contract and behavior changes must update matching docs in the same change
- Durable CodeNexus documentation lives under `docs/`
- Planning docs remain governed while they lock active direction, but they are not the long-term home for durable product documentation
- The governed docs surface set is defined by `docs/governed-paths.toml`
- Required docs gates are `npm run lint:docs --prefix gitnexus` and `npm run check:docs-contracts --prefix gitnexus`
- Pure refactors with no CodeNexus-owned contract or behavior change may skip docs updates only when the docs-contract gate concludes no governed docs change is required

## Implementation Posture

- There is no commitment to a full rewrite into Go or Rust at this stage
- The current TypeScript implementation is acceptable for now while the fork is simplified and refocused
- The immediate goal is to boil the fork down to the bare necessities rather than rewrite the whole engine first

## Bare Necessities

The fork should retain only the core pieces needed for the intended product:

- repo-local indexing
- graph-backed code intelligence
- Kuzu as the graph storage and query engine for now
- a compact MCP surface for AI agents
- lexical or BM25-style retrieval plus graph traversal

The fork should be intentionally reduced toward a headless core for agents:

- one repo-local state directory: `.codenexus/`
- one repo-local lifecycle: `codenexus init`, `codenexus index`, `codenexus status`, `codenexus serve`
- one primary runtime audience: AI agents
- one primary transport: HTTP MCP
- one primary storage engine: Kuzu

## Storage Engine Direction

- Kuzu remains the storage engine for the time being
- There is no immediate plan to migrate to DuckDB, SQLite, or another database
- A database migration is deferred until there is a concrete product or performance reason to do it
- Forking Kuzu is also deferred unless a specific missing feature or blocker makes that necessary

The current posture is to keep Kuzu while CodeNexus is stripped down and reshaped. The more important near-term work is product simplification, repo-local architecture, and strong Luau or Roblox support rather than replacing the database layer prematurely.

The fork should remove, defer, or deprioritize non-core layers such as:

- visualization and human-oriented graph browsing
- editor-specific integration work that is not central to the product
- other non-core platform extras that do not materially support the core agent workflow

More concretely, the current fork should be stripped toward:

- a core ingestion and graph engine
- repo-local config and runtime state under `.codenexus/`
- a repo-local MCP HTTP service
- a thin CLI

And stripped away from:

- multi-surface product complexity
- browser-first or human-visualization surfaces
- plugin or editor packaging work that is not core to CodeNexus
- evaluation harnesses and other side systems not needed for the main product

## Embeddings Direction

- Embeddings are not a near-term requirement
- Embeddings are a deferred future upgrade rather than a v1 priority
- V1 should work well with compact lexical retrieval and graph traversal alone
- Complexity budget should go first to strong structural understanding, repo-local architecture, and Roblox or Luau support rather than semantic embeddings

Embeddings are still valuable in the future for fuzzy semantic retrieval when user language and code vocabulary do not match, but they are not considered core to the first useful CodeNexus product.

## Roblox And Luau Direction

- Luau is now supported as a real indexed language through the existing CodeNexus engine
- Roblox support is also a real product goal
- Rojo-based Roblox projects are the initial support target
- The Rojo-only restriction is intentional because it gives a deterministic mapping from filesystem source to Roblox instance tree and makes practical support much more feasible

The implementation order remains deliberate:

- Epic 07 adds Luau as a real indexed language through the existing CodeNexus engine
- Epic 08 adds Roblox- and Rojo-specific semantics on top of that language support

For Roblox projects, CodeNexus should eventually understand:

- Luau source structure
- Rojo project structure
- Roblox-aware module resolution patterns such as `game:GetService(...)`, `script.Parent`, and `WaitForChild(...)`
- client/shared/server boundaries common in Rojo-based games

## World Projection Direction

- The SQLite world projection concept remains part of long-term intent
- It is considered complementary to the code graph, not a replacement for it
- It is explicitly a future subsystem and not an immediate implementation priority
- When added later, it should likely be modeled as a separate but linkable world-state dataset inside CodeNexus

## Reduction Strategy

The fork should be simplified in a deliberate order rather than by random deletion.

Preferred strategy:

1. define the minimal CodeNexus product shape clearly
2. redirect core flows toward repo-local `.codenexus/` ownership and repo-local MCP over HTTP
3. isolate and disable non-core product surfaces
4. remove dead code and dead tests only after the core path is stable

The current reduction inventory and before/after repo surface are tracked in [core-surface-reduction.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/core-surface-reduction.md).

This reduction should preserve the parts that actually do the work:

- the ingestion pipeline
- the graph model
- Kuzu persistence and querying
- the parser and language loading layer
- the agent-facing MCP backend shape, rewritten to single-repo and repo-local

And it should remove or strongly deprioritize:

- global multi-repo control-plane behavior
- human-facing visualization layers
- setup automation and editor-specific helper layers
- wiki generation and similar non-core output modes
- embeddings for now

## Naming Direction

- Product name: `CodeNexus`
- CLI name: `codenexus`
- Repo-local state directory: `.codenexus/`
- Renaming strategy: lazy and piecemeal, only where the old `gitnexus` name is getting in the way
