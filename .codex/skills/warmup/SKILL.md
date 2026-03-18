---
name: warmup
description: Use when the user asks to warm up or reorient. Run a deterministic read-only orientation pass for gnexus repo state, core engine surfaces, and git state.
---

# warmup

Run a deterministic read-only orientation pass.

## Steps

1. Read repo rules
- read `AGENTS.md` fully

2. Verify environment assumptions
- Node and npm are available:
  - `node --version`
  - `npm --version`
- key files exist:
  - `planning/master-intent.md`
  - `package.json`
  - `src/cli/index.ts`
  - `src/mcp/server.ts`
  - `src/core/ingestion/pipeline.ts`

3. Refresh core code surfaces
- `src/cli/index.ts`
- `src/cli/analyze.ts`
- `src/mcp/server.ts`
- `src/mcp/local/local-backend.ts`
- `src/core/ingestion/pipeline.ts`
- `src/core/kuzu/kuzu-adapter.ts`

4. Refresh gnexus self-index view
- `gnexus manage status`
- `gnexus summary --subsystems`
- `gnexus query "cli mcp storage core" --owners`

5. Refresh branch state
- `git rev-parse --abbrev-ref HEAD`
- `git status --short --branch`

6. Report
- environment checks
- gnexus freshness and top subsystem view
- current branch and worktree state
- major architecture risks or shape observations
- what to focus on next

## Requirements

- Keep output concise and actionable.
- Do not suggest workflows unrelated to gnexus development.
