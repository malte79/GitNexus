# Product And Runtime Boundary

## Purpose

CodeNexus is a repo-activated code-intelligence backend for AI agents.

Its v1 product boundary is:

- one repo-local state directory: `.codenexus/`
- one primary transport: repo-local MCP over HTTP
- one primary audience: AI agents
- one primary storage engine: Kuzu
- one primary lifecycle: `codenexus init`, `codenexus index`, `codenexus status`, `codenexus serve`

## V1 Invariants

- CodeNexus may create or update state only under `.codenexus/`.
- The no-mutation rule outside `.codenexus/` is absolute in v1.
- The operative repo boundary is the nearest enclosing git root.
- Nested git repos are separate repo boundaries from their parents.
- Git worktrees are separate runtime boundaries in v1.
- One repo-local MCP HTTP service corresponds to one repo boundary.
- Config format is part of the product boundary and is not an implementation detail.
- Runtime-state files are advisory only; live service checks are authoritative.
- A stale index may be served only with explicit degraded reporting.

## Repo Boundary Rules

### Nearest Git Root

All v1 commands resolve the nearest enclosing git root and treat it as the active repo boundary.

### Nested Repos

If a command is run inside a nested git repo, the nested repo wins. The parent repo's `.codenexus/` must not be treated as the active boundary from inside the nested repo.

### Worktrees

Each git worktree is its own runtime boundary. Worktrees may point at different branches and have different index freshness states. They must not share runtime identity implicitly.

## Runtime Model

The intended runtime model is:

`agent <-> repo-local MCP HTTP server <-> local repo Kuzu index`

The MCP service is repo-scoped, not multi-repo. It serves only the repo boundary in which it is started.

## V1 Non-Goals

- global multi-repo registry behavior
- shared control-plane routing across repos
- stdio as the primary runtime transport
- automatic background freshness guarantees
- branch-specific index stores
- repo mutation outside `.codenexus/`
- human-oriented visualization as a core product surface
- a storage-engine migration away from Kuzu

## Companion Contracts

- [repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md)
- [commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md)
- [mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md)
