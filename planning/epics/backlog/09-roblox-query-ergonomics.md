Title: Roblox Query Ergonomics
Assigned to: unassigned
Lane: Product
Status: backlog
Objective: Improve Luau/Roblox query ergonomics by making module-table exports first-class symbols, strengthening retrieval and ranking for Roblox/Luau concepts, and producing more useful Roblox-aware summaries so CodeNexus answers are easier for agents to use on real Rojo repos.
In scope: Luau module-table symbol extraction; file-to-module symbol linking; improved search/ranking for exact file/module names and Roblox domain context; use of `runtimeArea` and Rojo path context in retrieval and summaries; richer query/context output for Roblox repos; tests, docs, and real-product proof on a Rojo repo.
Out of scope: new language support; new Roblox path-resolution rules beyond Epic 08; branch-aware indexing; embeddings; world projection; transport/runtime redesign; full text-semantic search redesign.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/planning/epics-todo.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/epics-todo.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); existing Luau/Roblox seams in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/graph/types.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/graph/types.ts), and query surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts).
Risks: if module-table extraction is too loose, CodeNexus will invent symbols that are really arbitrary locals; if ranking changes are too aggressive, exact-name boosts could hurt broader query usefulness; if Roblox-aware summaries are layered on without better symbol grounding, they will still feel noisy or misleading; if this epic expands into full semantic search, it will overlap with deferred intelligence work.
Rollback strategy: keep improvements grounded in existing Luau/Roblox structure; if a symbolization or ranking rule is too fuzzy, narrow it to deterministic cases instead of keeping approximate behavior; if summary output becomes noisy, simplify it toward explicit file/module/runtime-area facts rather than adding more prose.

### [ ] 100 Lock The Luau/Roblox Query-Ergonomics Contract
Surface: durable docs under `docs/architecture/`; `planning/master-intent.md`; existing Luau/Roblox docs
Work: Lock the exact contract for this ergonomics epic. This unit must define what counts as a first-class Luau module symbol, what ranking improvements are in scope, and what Roblox-aware summary fields should be exposed to agents. It must also explicitly separate deterministic symbolization/ranking improvements from deferred semantic-search work. Done when the repo has one durable statement of what better Luau/Roblox query ergonomics means and what it does not attempt.
Tests: Validate the contract against representative cases like `SpotlightRegistry`, `LightingShowService`, and `UIService`, ensuring the scope is about symbol grounding, ranking, and summaries rather than new path resolution or embeddings.
Docs: Create [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md) and update [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md) plus the existing Luau/Roblox docs to reflect the scope boundary.

### [ ] 101 Make Luau Module Tables First-Class Symbols
Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts); fixtures and graph tests
Work: Improve Luau symbol extraction so common module-table exports become first-class graph symbols. This unit must handle deterministic patterns like `local SpotlightRegistry = {}` followed by method assignments and `return SpotlightRegistry`, link the file to that module-table symbol, and surface its methods and callers more naturally. It must remain conservative and avoid treating arbitrary locals as exported module symbols. Done when `context(\"SpotlightRegistry\")`-style lookups work on representative Luau modules and the graph reflects file-to-module-table-to-method relationships clearly.
Tests: Add or update Luau fixtures and integration tests covering returned module tables, constructor-like tables, singleton service tables, and typed method assignments. Confirm false positives are rejected for plain locals that are not exported modules.
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md) and [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md) with the implemented module-symbol rules.

### [ ] 102 Improve Retrieval And Ranking For Luau/Roblox Concepts
Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); any adjacent search/ranking helpers; tests
Work: Improve query retrieval and ranking so broad Roblox/Luau queries are less noisy and exact module/file names are promoted correctly. This unit should use deterministic signals such as exact file-name matches, module-table symbol names, `runtimeArea`, and Rojo/DataModel path context to improve ranking. It should not introduce embeddings or broad semantic guesswork. Done when queries like `spotlight registry`, `lighting show service`, and `UI service` surface the expected modules and symbols near the top consistently.
Tests: Add ranking-focused tests for exact-name, near-name, and Roblox domain queries. Validate that improved Roblox/Luau ranking does not regress basic non-Roblox query usefulness on existing supported-language fixtures.
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md) and any relevant query-surface docs with the implemented ranking signals.

### [ ] 103 Add Roblox-Aware Agent Summaries
Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); query/context response formatting; docs
Work: Make query and context results more useful to agents on Roblox repos by surfacing Roblox-aware summary facts when they are available. This unit should enrich results with concise fields such as module-table symbol, `runtimeArea`, Rojo/DataModel path context, and key imported boundary crossings, without dumping raw graph detail. Done when CodeNexus answers for representative Roblox modules feel intentionally informative rather than generic file listings.
Tests: Add output-focused tests for query and context behavior on representative Roblox fixtures, verifying the new summary fields appear when available and stay concise.
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md), and any affected user-facing query docs.

### [ ] 104 Prove Improved Ergonomics On A Real Rojo Repo
Surface: real product workflow (`codenexus init/index/serve`); live query path; validation targets such as [/Users/alex/Projects/roblox/dancegame-agent-3](/Users/alex/Projects/roblox/dancegame-agent-3); docs
Work: Prove that the new symbolization, ranking, and summary improvements materially improve real-world agent usefulness on a Rojo repo. This unit must run real queries against a representative project, compare CodeNexus answers to actual source, and show that previously weak cases like module-table lookup or noisy broad queries are now better. Done when the repo has product-level evidence that Epic 08 correctness is now paired with materially better ergonomics.
Tests: Add or document a real-product smoke pass covering at least:
1. a module-table lookup like `SpotlightRegistry`
2. a broad service query like `lighting show service`
3. a client/shared/server-aware query like `UI service`
and manually verify at least one returned answer against source.
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md), [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md), and any affected validation notes with the real-product proof.

### [ ] 190 Milestone 100 Closeout
Surface: module-table symbolization; retrieval/ranking; Roblox-aware summaries; durable docs; validation evidence
Work: Confirm CodeNexus is now not only correct on Rojo-based Roblox repos, but also ergonomically useful for agents. This closeout must prove that module-table lookups work, broad Roblox/Luau queries rank better, summaries surface the right Roblox-aware context, and those improvements hold up on a real repo. It must also clearly separate what this epic solved from later work on branch intelligence and deferred higher-end retrieval features.
Tests: Run the selected docs, build, unit, integration, and real-product smoke checks for the final ergonomics layer.
Docs: Record closeout evidence in the epic and ensure the final supported behavior is reflected in [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md), and [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md).

Closeout evidence table (required):

| Unit | Required evidence | Link / Note | Status |
|---|---|---|---|
| 100 | Query-ergonomics contract is locked | Durable docs define module-table symbol rules, ranking scope, summary scope, and explicit deferrals. | [ ] |
| 101 | Luau module-table exports are first-class symbols | Graph/tests show representative module tables like `SpotlightRegistry` can be found and traversed as symbols. | [ ] |
| 102 | Retrieval and ranking are materially improved | Ranking tests and real queries show better top results for representative Roblox/Luau concepts. | [ ] |
| 103 | Roblox-aware summaries are concise and useful | Query/context output now surfaces meaningful runtime/path/module facts without noisy graph dumps. | [ ] |
| 104 | Real-product ergonomics are proven | Live queries on a real Rojo repo demonstrate improved lookup and broad-query usefulness, with manual source verification. | [ ] |
| 190 | Validation passed on the final ergonomics layer | Required docs/build/test/product-smoke checks passed and closeout notes clearly separate this epic from later roadmap items. | [ ] |

Blocker criteria (190 cannot close if any are true):
- Module-table symbolization still misses representative exported Luau module tables.
- Ranking improvements rely on fuzzy semantic inference rather than deterministic signals.
- Roblox-aware summaries are noisy, misleading, or unsupported by actual graph facts.
- Real-product proof of improved ergonomics is missing.
- Docs, build, unit, integration, or product-smoke validation fail on the resulting ergonomics layer.
