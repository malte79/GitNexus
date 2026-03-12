Title: Luau And Roblox Embedding Support
Assigned to: unassigned
Lane: Bridge
Status: backlog
Objective: Add repo-local embedding support for Luau and Rojo-based Roblox repos so `codenexus query` can supplement the current BM25 plus graph path with semantic recall, while preserving deterministic Roblox-aware ranking and `.codenexus/` ownership.
In scope: repo-local embedding config and state under `.codenexus/`; index-time embedding document generation for Luau and Roblox-aware code artifacts; repo-local vector store lifecycle tied to `codenexus index`; query-time blending of vector recall with existing BM25 and Roblox reranking; operator visibility through `codenexus status` and `codenexus info`; real acceptance against `/Users/alex/Projects/roblox/dancegame-agent-1`; first implementation standardized on an OpenAI-backed provider contract with environment-supplied credentials; embeddings opt-in in `.codenexus/config.toml` and defaulting off; v1 coverage limited to file-level and strong Luau module-level embedding documents.
Out of scope: replacing BM25 or graph traversal as the primary retrieval path; branch-specific embedding stores; background embedding-only refresh outside normal `codenexus index`; world projection joins; Studio inspection or dynamic Roblox world inference; function-level embeddings beyond clearly surfaced strong Luau module symbols; cross-repo or cloud-hosted shared vector indexes; multi-provider support in the first implementation.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md); current Luau/Roblox ingestion seams in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/pipeline.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/pipeline.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/luau-module-symbols.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/luau-module-symbols.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/roblox/rojo-project.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/roblox/rojo-project.ts); existing query/rerank path in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); existing repo-local state ownership in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts).
Risks: semantic recall may drown out exact Roblox matches if reranking is too aggressive; embedding generation may materially slow `codenexus index`; repo-local vector state may drift from graph state if lifecycle is not serialized tightly; Luau files with sparse comments may produce weak embeddings unless enriched from Rojo and runtime metadata; provider failures may create misleading partial semantic state if manifest ownership is not strict.
Rollback strategy: keep vector retrieval behind explicit repo-local config; if ranking becomes noisy, disable vector recall and retain the existing BM25 plus graph path unchanged; if embedding build becomes unstable, skip building `.codenexus/embeddings/` while keeping graph indexing healthy; repo-local rollback is deleting `.codenexus/embeddings/` and disabling embeddings in config.

### [ ] 101 Lock The Repo-Local Embeddings Contract

Surface: `gitnexus/src/storage/repo-manager.ts`; `gitnexus/src/cli/init.ts`; `gitnexus/src/cli/status.ts`; `gitnexus/src/cli/info.ts`; `docs/architecture/repo-state-model.md`; `docs/architecture/repo-local-implementation.md`; `docs/cli/commands.md`; `planning/master-intent.md`
Work: Define the repo-local embeddings contract under `.codenexus/` with exact owned paths, config fields, and status semantics. The planned shape is `.codenexus/embeddings/` plus a manifest file that records embedding generation identity tied to the same repo and worktree snapshot as `.codenexus/meta.json`. `codenexus init` must create config defaults only, not placeholder embedding state. `codenexus status` and `codenexus info` must clearly report disabled, unbuilt, current, stale, and failed embedding states without implying semantic search is authoritative. Done when there is one durable operator and state contract for embeddings.
Tests: `gitnexus/test/unit/repo-manager.test.ts`; `gitnexus/test/unit/status-command.test.ts`; `gitnexus/test/unit/info-command.test.ts`
Docs: `docs/architecture/repo-state-model.md`; `docs/architecture/repo-local-implementation.md`; `docs/cli/commands.md`; `planning/master-intent.md`

### [ ] 102 Add Embedding Manifest And Freshness Evaluation

Surface: `gitnexus/src/storage/repo-manager.ts`; `gitnexus/src/core/search/embedding-manifest.ts`; `gitnexus/src/core/search/embedding-store.ts`
Work: Add schema validation and repo-manager helpers for embedding manifest load and save plus stale and current evaluation. The manifest must be deterministic, repo-local, and comparable against `.codenexus/meta.json` so status can tell whether embeddings were built from the same graph generation. No hidden fallback to stale vectors is allowed. Done when embedding state has explicit lifecycle ownership and freshness reporting.
Tests: `gitnexus/test/unit/repo-manager.test.ts`; `gitnexus/test/unit/embedding-manifest.test.ts`
Docs: `docs/architecture/repo-state-model.md`; `docs/architecture/repo-local-implementation.md`

### [ ] 190 Milestone 100 Closeout

Surface: embeddings config; manifest lifecycle; status and info reporting; durable docs; validation evidence
Work: Prove the repo-local embeddings contract is stable before semantic indexing work begins. Closeout is complete only when config parsing, status and info reporting, manifest freshness evaluation, and docs-contract gates all pass with the new embeddings contract in place.
Tests: `npm test --prefix gitnexus -- test/unit/repo-manager.test.ts test/unit/status-command.test.ts test/unit/info-command.test.ts test/unit/embedding-manifest.test.ts`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`
Docs: None

### [ ] 201 Build Deterministic Luau And Roblox Embedding Documents

Surface: `gitnexus/src/core/ingestion/pipeline.ts`; `gitnexus/src/core/ingestion/luau-module-symbols.ts`; `gitnexus/src/core/ingestion/roblox/rojo-project.ts`; `gitnexus/src/core/search/embedding-documents.ts`
Work: Build deterministic embedding documents from existing graph facts for Luau and Roblox. Initial coverage should be file-level artifacts plus strong Luau module symbols, enriched with file path, module symbol, runtime area, Rojo or DataModel path, and concise grounded summaries already derivable from indexed facts. This unit must not invent free-form summaries, must not depend on world projection, and must not add function-level documents in v1. Done when CodeNexus can produce stable semantic documents for the repo surfaces users actually ask about.
Tests: `gitnexus/test/unit/embedding-documents.test.ts`; existing Luau and Roblox ingestion tests updated to verify document payloads for representative Rojo repos
Docs: `docs/architecture/roblox-query-ergonomics.md`; `docs/architecture/repo-local-implementation.md`

### [ ] 202 Tie Embedding Generation To `codenexus index`

Surface: `gitnexus/src/cli/index-command.ts`; `gitnexus/src/core/search/embedding-provider.ts`; `gitnexus/src/core/search/embedding-store.ts`; `gitnexus/src/core/search/embedding-indexer.ts`
Work: Tie embedding generation to `codenexus index`. After the graph and FTS indexes are built, generate vectors for the planned documents through the first implementation's OpenAI-backed provider contract and persist the repo-local vector store and manifest under `.codenexus/embeddings/`. Indexing must report a clear degraded outcome or fail loudly when embeddings are enabled but cannot complete; it must not silently pretend semantic state exists. Manual `codenexus index` remains the only build path. Done when one index command owns the graph, lexical indexes, and semantic indexes together.
Tests: `gitnexus/test/unit/embedding-indexer.test.ts`; `gitnexus/test/unit/index-command.test.ts`; targeted integration around `codenexus index` output and manifest creation
Docs: `docs/cli/commands.md`; `docs/architecture/repo-state-model.md`

### [ ] 290 Milestone 200 Closeout

Surface: embedding documents; provider-backed vector build; index lifecycle; validation evidence
Work: Prove embedding documents and vectors are generated deterministically for the same repo snapshot and are rebuilt when the indexed graph generation changes. Closeout is complete only when index-time tests cover unchanged rebuild skip behavior, changed graph rebuild behavior, and manifest or current-state reporting.
Tests: `npm test --prefix gitnexus -- test/unit/embedding-documents.test.ts test/unit/embedding-indexer.test.ts test/unit/index-command.test.ts`; targeted integration for index lifecycle
Docs: None

### [ ] 301 Add Query-Time Semantic Recall To The Bound Repo Backend

Surface: `gitnexus/src/mcp/local/local-backend.ts`; `gitnexus/src/core/search/bm25-index.ts`; `gitnexus/src/core/search/embedding-query.ts`
Work: Add query-time vector recall for the bound repo and merge it with the existing BM25 candidate path before process grouping. The implementation must preserve the current single-repo backend shape and must not add a second query surface. Query-time behavior must remain bounded: if embeddings are disabled or absent, the current lexical path remains the whole result path and the operator surface must reflect that state instead of hiding it. Done when semantic recall is a supplement inside the existing backend rather than a parallel retrieval mode.
Tests: `gitnexus/test/unit/embedding-query.test.ts`; `gitnexus/test/integration/local-backend.test.ts`
Docs: `docs/architecture/repo-local-implementation.md`; `docs/cli/commands.md`

### [ ] 302 Blend Semantic Recall Conservatively With Roblox-Aware Ranking

Surface: `gitnexus/src/mcp/local/local-backend.ts`; `docs/architecture/roblox-query-ergonomics.md`
Work: Blend vector scores conservatively with the existing deterministic Roblox and Luau ranking rules. Exact module names, file basenames, `runtimeArea`, and Rojo or DataModel path context must still dominate when present. Broad natural-language queries should improve, but exact queries like `SpotlightRegistry` or `LightingShowService` must not regress. Done when broad intent queries improve without breaking grounded exact lookup.
Tests: `gitnexus/test/integration/local-backend.test.ts`; targeted ranking tests for exact-name queries, broad intent queries, and client or server or shared boundary queries
Docs: `docs/architecture/roblox-query-ergonomics.md`

### [ ] 390 Milestone 300 Closeout

Surface: semantic recall; Roblox-aware reranking; acceptance query set; validation evidence
Work: Prove semantic recall improves broad Luau and Roblox retrieval without breaking deterministic exact lookup. Closeout is complete only when the fixed acceptance query set shows better or equal top results and no regression on exact module and file lookups.
Tests: `npm run test:integration --prefix gitnexus`; targeted ranking assertions in `gitnexus/test/integration/local-backend.test.ts`
Docs: None

### [ ] 401 Validate Against `dancegame` And Tighten Thresholds

Surface: `/Users/alex/Projects/roblox/dancegame-agent-1`; `gitnexus/src/mcp/local/local-backend.ts`; `docs/architecture/roblox-query-ergonomics.md`; `docs/cli/commands.md`
Work: Run the real acceptance pass on `dancegame`. Use a fixed before-and-after query set shaped around exact lookups and fuzzy intent lookups such as `round start show logic`, `spotlight elimination pacing`, `beat timing affects lighting`, `DJ booth lights`, `client wallet UI`, and `world bootstrap`. Record which queries materially improved, which stayed flat, and any queries where embeddings added noise. Tighten thresholds rather than broadening semantics if noise appears. Done when the real target repo shows clear gains on fuzzy queries without losing the existing exact lookup quality.
Tests: real-product smoke through the live `codenexus` service against `/Users/alex/Projects/roblox/dancegame-agent-1`; targeted integration reruns after threshold tuning
Docs: `docs/architecture/roblox-query-ergonomics.md`; `docs/cli/commands.md`

### [ ] 490 Epic Closeout

Surface: unit tests; integration tests; docs gates; build; real acceptance evidence
Work: Epic closeout is complete only when unit tests, integration tests, docs gates, build, and real `dancegame` acceptance all pass, and the final docs clearly state that embeddings are supplementary semantic recall layered on top of BM25 plus graph traversal rather than a replacement for grounded Roblox and Luau retrieval.
Tests: `npm test --prefix gitnexus`; `npm run test:integration --prefix gitnexus`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`
Docs: None
