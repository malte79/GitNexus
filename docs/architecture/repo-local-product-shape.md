# Repo-Local Product Shape

## Summary

CodeNexus is a globally installed but repo-activated tool for AI-agent code intelligence.

The intended runtime model is:

`agent <-> repo-local MCP server <-> local repo index`

## Repo Ownership

Each activated repository owns its own local CodeNexus state under `.codenexus/`.

CodeNexus should not mutate other files in the repository by default.

## Primary Lifecycle

The intended v1 lifecycle is:

- `codenexus init`
- `codenexus index`
- `codenexus status`
- `codenexus serve`

## Runtime Boundary

The primary runtime interface is a repo-local MCP server over HTTP.

The server is scoped to one repo boundary and should expose the agent-facing CodeNexus commands for that repo only.

## Storage

Kuzu remains the storage engine for now.

There is no immediate storage-engine migration plan. Any future migration must be justified by concrete product or performance needs.

## Freshness

Manual refresh is acceptable in v1.

The product should not overpromise automatic freshness before a clear and reliable refresh model exists.

## Documentation Ownership

This document captures a durable product contract that was first shaped in planning docs and then promoted into canonical `docs/` ownership.
