# Repo-Local Implementation

## Purpose

This document maps the locked CodeNexus runtime contract onto the reduced post-Epic-02 codebase.

Epic 03 implements a hard cut:

- `.codenexus/` is the only active repo-state boundary
- the nearest enclosing git root is the active repo boundary
- nested repos win over parent repos
- worktrees are distinct runtime boundaries
- there is no active global registry
- there is no active repo-discovery routing surface

## Owning Modules

| Surface | Owning module | Responsibility |
|---|---|---|
| repo boundary resolution | [git.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/git.ts) | nearest git root, current branch, current commit, dirty-worktree checks |
| `.codenexus` paths and file contracts | [repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts) | config, meta, runtime paths; schema validation; repo-state evaluation |
| repo-bound query engine | [local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts) | one bound repo, one Kuzu handle, one active tool surface |
| agent-facing tool schema | [tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts) | single-repo tool contracts with no repo routing |
| agent-facing resources | [resources.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/resources.ts) | single-repo resource URIs with no repo discovery |
| repo activation shim | [init.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/init.ts) | create `.codenexus/config.toml` without creating index or runtime state |
| retained indexing shim | [index-command.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index-command.ts) | write `.codenexus/kuzu` and `.codenexus/meta.json` only |
| retained status shim | [status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts) | report canonical base state and detail flags |
| serve command | [serve.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/serve.ts) | start the repo-local HTTP service for one repo boundary |
| service runtime | [service-runtime.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/service-runtime.ts) | bind the HTTP server, own graceful shutdown, and maintain runtime metadata |

## Active State Layout

Epic 03 uses the v1 `.codenexus/` layout already locked in [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md):

- `.codenexus/config.toml`
- `.codenexus/meta.json`
- `.codenexus/kuzu/`
- `.codenexus/runtime.json`

All four paths are now exercised by the active CLI surface. `codenexus serve` owns the live HTTP lifecycle and advisory `runtime.json`.

The live service health contract is now also responsible for exposing the loaded index identity the service actually opened at startup. That identity is the source of truth for serving freshness, while `runtime.json` persists the same facts only as advisory recovery state.

## Hard-Cut Removals

Epic 03 removes the old active architecture rather than adapting it:

- no `~/.gitnexus/registry.json`
- no registry refresh path
- no `list_repos`
- no `gitnexus://repos`
- no repo-name-targeted MCP resource paths
- no active `repo` parameter routing semantics
- no `.gitnexus/` runtime ownership

## Active CLI Surface

Epic 04 replaces the inherited user-facing CLI with:

- `codenexus init`
- `codenexus index`
- `codenexus status`
- `codenexus serve`

`codenexus serve` now starts the repo-local HTTP service directly. The CLI must not silently fall back to inherited transport behavior for compatibility.

## Separation From Later Epics

Epic 03 owns:

- repo-local state ownership
- single-repo backend binding
- removal of active multi-repo affordances

Epic 04 still owns:

- the final user-facing CLI shape
- `codenexus init`
- command-module renaming and user ergonomics

Epic 05 owns and now implements:

- the repo-local HTTP MCP lifecycle
- port binding and runtime metadata writes as a real service contract
- replacement of retained stdio MCP as the primary transport

## Language Layer Extension

Epic 07 extends the existing indexing engine with Luau as a language-level feature, not as a separate product path.

The same core seams remain responsible:

- [supported-languages.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/config/supported-languages.ts) owns language registration
- [utils.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/utils.ts) owns extension mapping
- [parser-loader.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/tree-sitter/parser-loader.ts) and [parse-worker.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts) own parser loading
- [tree-sitter-queries.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/tree-sitter-queries.ts) owns language capture definitions
- [import-processor.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/import-processor.ts) and [call-processor.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/call-processor.ts) own graph linking

Epic 07 adds Luau to those existing seams only.

Epic 08 layers Roblox- and Rojo-specific semantics on top through a dedicated domain helper under [gitnexus/src/core/ingestion/roblox](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/roblox):

- `default.project.json` is parsed into a deterministic filesystem-to-DataModel mapping
- static Roblox path forms such as `game:GetService(...)`, `script.Parent`, and chained `WaitForChild(...)` are resolved conservatively
- shallow syntax-local aliases of those rooted paths are supported
- runtime-area tagging (`shared`, `client`, `server`, `other`) is carried into the indexed graph and surfaced through query results

This keeps the Roblox specialization isolated from the generic Luau parser and graph seams while making the existing product genuinely useful on Rojo-based Roblox repos.

Epic 09 then improves the agent-facing ergonomics on top of that correctness layer:

- common returned Luau module tables become stronger first-class symbols
- deterministic ranking uses exact module names, file names, split-word service aliases, `runtimeArea`, and Rojo path context
- query and context responses now surface concise Roblox-aware facts such as module symbol, runtime area, DataModel path, and key boundary-crossing imports

Those ergonomics changes are documented in [roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md).
