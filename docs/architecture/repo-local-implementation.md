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
| retained indexing shim | [analyze.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/analyze.ts) | write `.codenexus/kuzu` and `.codenexus/meta.json` only |
| retained status shim | [status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts) | report canonical base state and detail flags |
| retained stdio MCP shim | [mcp.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/mcp.ts) | fail clearly without config or usable local index; bind stdio transport to one repo |

## Active State Layout

Epic 03 uses the v1 `.codenexus/` layout already locked in [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md):

- `.codenexus/config.toml`
- `.codenexus/meta.json`
- `.codenexus/kuzu/`
- `.codenexus/runtime.json`

Only the first three are exercised by the retained `gitnexus` shims in Epic 03. `runtime.json` remains part of the storage contract, but the repo-local HTTP lifecycle that owns it remains an Epic 05 concern.

## Hard-Cut Removals

Epic 03 removes the old active architecture rather than adapting it:

- no `~/.gitnexus/registry.json`
- no registry refresh path
- no `list_repos`
- no `gitnexus://repos`
- no repo-name-targeted MCP resource paths
- no active `repo` parameter routing semantics
- no `.gitnexus/` runtime ownership

## Retained Transitional Behavior

The retained `gitnexus analyze`, `gitnexus status`, and `gitnexus mcp` commands are transitional shims only.

They are allowed to fail clearly when:

- `.codenexus/config.toml` is missing
- config is invalid
- a usable local index does not exist

They must not silently create config or preserve the old registry model for compatibility.

## Separation From Later Epics

Epic 03 owns:

- repo-local state ownership
- single-repo backend binding
- removal of active multi-repo affordances

Epic 04 still owns:

- the user-facing `cn` CLI shape
- `cn init`
- final command naming and user ergonomics

Epic 05 still owns:

- the repo-local HTTP MCP lifecycle
- port binding and runtime metadata writes as a real service contract
- replacement of retained stdio MCP as the primary transport
