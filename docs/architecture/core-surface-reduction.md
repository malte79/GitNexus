# Core Surface Reduction

## Purpose

This document records the Epic 02 reduction of the inherited upstream repo toward the minimum surfaces needed for the headless GNexus core.

The reduction rule used here is strict:

- remove a surface now unless it is required for the headless core or Epics 03-05
- do not preserve product layers just because they might be useful later
- if a cut proves too aggressive, restore it from git history or the upstream checkout with explicit rationale

## Keep / Remove Inventory

| Surface | Current role | Decision | Rationale |
|---|---|---|---|
| `gitnexus/src/core/ingestion/` | core indexing pipeline | keep for epic 03 | Required for repo-local indexing and later Luau work |
| `gitnexus/src/core/graph/` | graph model | keep for epic 03 | Required core data model |
| `gitnexus/src/core/kuzu/` | graph persistence/querying | keep for epic 03 | Kuzu remains the storage engine for now |
| `gitnexus/src/core/search/bm25-index.ts` | lexical retrieval | keep for epic 03 | Lexical/BM25 retrieval remains part of the bare core |
| `gitnexus/src/core/tree-sitter/` | parser loading | keep for epic 07 | Required for language indexing |
| `gitnexus/src/core/wiki/` | wiki generation | remove now | Human-facing output mode outside the approved product |
| `gitnexus/src/core/augmentation/` | hook/search augmentation | remove now | Side-system not required for the headless core |
| `gitnexus/src/core/embeddings/` | semantic embeddings | remove now | Explicitly deferred future upgrade |
| `gitnexus/src/core/search/hybrid-search.ts` | semantic+BM25 blend | remove now | Embeddings removed; lexical search remains |
| `gitnexus/src/cli/index-command.ts` | indexing entrypoint | keep for epic 04 | Still the shortest path to `gnexus index` |
| `gitnexus/src/cli/status.ts` | status entrypoint | keep for epic 04 | Still the shortest path to future `gnexus status` |
| `gitnexus/src/cli/serve.ts` | serve entrypoint | keep | Active `gnexus serve` command for the repo-local HTTP runtime |
| `gitnexus/src/cli/index.ts` | CLI dispatcher | keep for epic 04 | Required CLI seam, but reduced to the minimal current surface |
| `gitnexus/src/cli/setup.ts` | editor/plugin setup | remove now | Outside the headless product |
| `gitnexus/src/cli/serve.ts` | web UI server command | remove now | Web UI is no longer a product surface |
| `gitnexus/src/cli/list.ts` | multi-repo listing command | remove now | Not part of the near-term CLI surface |
| `gitnexus/src/cli/clean.ts` | cleanup command | remove now | Not part of the near-term CLI surface |
| `gitnexus/src/cli/wiki.ts` | wiki command | remove now | Wiki generation removed |
| `gitnexus/src/cli/augment.ts` | augmentation command | remove now | Augmentation removed |
| `gitnexus/src/cli/tool.ts` | direct tool CLI commands | remove now | MCP remains the primary agent-facing surface |
| `gitnexus/src/cli/eval-server.ts` | eval daemon | remove now | Eval subsystem removed |
| `gitnexus/src/cli/ai-context.ts` | AGENTS/context file generation | remove now | Product rule is no repo mutation outside repo state |
| `gitnexus/src/mcp/` | MCP tool/server seam | keep | Active repo-local MCP surface |
| `gitnexus/src/server/mcp-http.ts` | HTTP MCP transport mount | keep | Active repo-local HTTP runtime seam |
| `gitnexus/src/server/api.ts` | web/browser API server | remove now | Web UI surface removed |
| `gitnexus/src/storage/` | repo/git storage helpers | keep for epic 03 | Required until repo-local state rewrite lands |
| `gitnexus-web/` | browser UI product | remove now | Human-facing visualization is out of scope |
| `gitnexus-claude-plugin/` | Claude plugin product | remove now | Editor/plugin packaging is out of scope |
| `gitnexus-cursor-integration/` | Cursor integration product | remove now | Editor/plugin packaging is out of scope |
| `eval/` | evaluation harness | remove now | Side system outside the main product |
| `gitnexus-test-setup/` | test setup side package | remove now | Not required by retained package tests |
| `.claude/` | Claude-specific repo support | remove now | Product-specific editor support removed |
| `.claude-plugin/` | Claude plugin marketplace config | remove now | Plugin surface removed |
| `.github/workflows/claude*.yml` | Claude-specific automation | remove now | Workflow tied to removed product surfaces |
| `.github/workflows/ci.yml` | CI | keep for repo workflow | Supports the retained package |
| `.github/workflows/publish.yml` | package publish | keep for repo workflow | Supports the retained package |
| `gitnexus/hooks/` | Claude hook scripts | remove now | Hook/onboarding surface removed |
| `gitnexus/skills/` | legacy repo skill pack | remove now | Product-specific helper pack removed |
| `gitnexus/vendor/` | retained package support code | keep for epic 03 | Still shipped by the retained package; revisit when architecture changes |

## Resulting Product Surface

After this reduction, the intended active product surface is:

- local indexing via `gnexus index`
- local status via `gnexus status`
- local service command via `gnexus serve`
- the ingestion, graph, Kuzu, search, MCP, and storage seams needed for Epics 03-05

Removed from first-class product scope:

- human-facing visualization
- plugin/editor packaging
- eval harnesses
- wiki generation
- augmentation helpers
- embeddings and semantic search
- onboarding/setup side systems

## Before / After Summary

Before:

- multi-surface repo with web UI, plugins, eval harnesses, hooks, skills, wiki generation, augmentation, embeddings, and broad CLI packaging

After:

- headless package plus planning/docs/workflow surfaces, with only the indexing, status, serve, and core graph-engine seams left active

## Post-Epic-03 Note

The retained surfaces above are no longer registry-backed multi-repo seams.

After Epic 03:

- `.gnexus/` is the active repo-local state boundary
- the retained backend is bound to one repo boundary
- repo-discovery affordances such as `list_repos` and `gnexus://repos` are gone from the active runtime surface
