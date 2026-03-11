Title: Roblox Query Ergonomics
Assigned to: Agent 1
Lane: Product
Status: done
Objective: Improve Luau/Roblox query ergonomics by making module-table exports first-class symbols, strengthening retrieval and ranking for Roblox/Luau concepts, and producing more useful Roblox-aware summaries so CodeNexus answers are easier for agents to use on real Rojo repos.
In scope: Luau module-table symbol extraction; file-to-module symbol linking; deterministic support for common Roblox Luau module patterns such as returned singleton tables, table method definitions, constructor-like modules, and service-like modules; improved search/ranking for exact file/module names and Roblox domain context; use of `runtimeArea` and Rojo path context in retrieval and summaries; richer query/context output for Roblox repos; tests, docs, and real-product proof on a Rojo repo.
Out of scope: new language support; new Roblox path-resolution rules beyond Epic 08; branch-aware indexing; embeddings; world projection; transport/runtime redesign; full text-semantic search redesign.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/planning/epics-todo.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/epics-todo.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); existing Luau/Roblox seams in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/graph/types.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/graph/types.ts), and query surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts).
Risks: if module-table extraction is too loose, CodeNexus will invent symbols that are really arbitrary locals; if lower-confidence returned-table-literal handling is not clearly ranked beneath named module tables, weak symbols could pollute retrieval; if ranking changes are too aggressive, exact-name boosts could hurt broader query usefulness or bury precise file hits; if Roblox-aware summaries are layered on without better symbol grounding, they will still feel noisy or misleading; if this epic expands into full semantic search, it will overlap with deferred intelligence work.
Rollback strategy: keep improvements grounded in existing Luau/Roblox structure; if a symbolization or ranking rule is too fuzzy, narrow it to deterministic cases instead of keeping approximate behavior; if lower-confidence module symbols create noise, disable that tier and keep only named returned-table patterns; if ranking changes hurt precise file/module lookup, revert to the previous ranking path and reintroduce improvements behind narrower signals; if summary output becomes noisy, simplify it toward explicit file/module/runtime-area facts rather than adding more prose.

### [x] 100 Lock The Luau/Roblox Query-Ergonomics Contract

Surface: durable docs under `docs/architecture/`; `planning/master-intent.md`; existing Luau/Roblox docs
Work: Lock the exact contract for this ergonomics epic. This unit must define what counts as a first-class Luau module symbol, what ranking improvements are in scope, and what Roblox-aware summary fields should be exposed to agents. It must also explicitly separate deterministic symbolization/ranking improvements from deferred semantic-search work and must state that module-table symbolization augments file-level lookup rather than replacing it. The contract must define the supported module-pattern set for this epic:

1. named returned singleton tables like `local X = {}; return X`
2. table method definitions like `function X.foo(...) end`, `X.foo = function(...) end`, and `function X:foo(...) end`
3. constructor-like modules with methods such as `X.new(...)`
4. service-like module tables such as `LightingShowService`
5. returned table literals with statically obvious function members as a lower-confidence case

It must also define a confidence ordering for those patterns so lower-confidence table-literal cases never outrank stronger named module symbols by default. Done when the repo has one durable statement of what better Luau/Roblox query ergonomics means and what it does not attempt.
Tests: Validate the contract against representative cases like `SpotlightRegistry`, `LightingShowService`, and `UIService`, ensuring the scope is about symbol grounding, ranking, and summaries rather than new path resolution or embeddings. Validate that file-level lookup remains available and useful even after module-table symbolization is added.
Docs: Create [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md) and update [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md) plus the existing Luau/Roblox docs to reflect the scope boundary.

### [x] 101 Make Luau Module Tables First-Class Symbols

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/workers/parse-worker.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/parsing-processor.ts); fixtures and graph tests
Work: Improve Luau symbol extraction so common module-table exports become first-class graph symbols. This unit must handle deterministic patterns like `local SpotlightRegistry = {}` followed by method assignments and `return SpotlightRegistry`, link the file to that module-table symbol, and surface its methods and callers more naturally. It must cover the supported module-pattern set from Unit `100`, remain conservative, and avoid treating arbitrary locals as exported module symbols. File-level lookup must remain intact as a fallback, and returned table literals should only become module symbols when the exported shape is statically obvious and must be marked lower-confidence than named module symbols. Done when `context(\"SpotlightRegistry\")`-style lookups work on representative Luau modules and the graph reflects file-to-module-table-to-method relationships clearly without degrading the existing ability to locate the containing file directly.
Tests: Add or update Luau fixtures and integration tests covering returned module tables, constructor-like tables, singleton service tables, typed method assignments, and returned table literals with statically obvious function members. Confirm false positives are rejected for plain locals that are not exported modules, and confirm file-level lookup still resolves the same representative modules.
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md) and [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md) with the implemented module-symbol rules.

### [x] 102 Improve Retrieval And Ranking For Luau/Roblox Concepts

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); any adjacent search/ranking helpers; tests
Work: Improve query retrieval and ranking so broad Roblox/Luau queries are less noisy and exact module/file names are promoted correctly. This unit should use deterministic signals such as exact file-name matches, module-table symbol names, split-word service aliases, `runtimeArea`, and Rojo/DataModel path context to improve ranking. It should not introduce embeddings or broad semantic guesswork. Done when queries like `spotlight registry`, `lighting show service`, `UI service`, and `world bootstrap` surface the expected modules and symbols in the top few results consistently, with before-and-after evidence for the target cases.
Tests: Add ranking-focused tests for exact-name, near-name, and Roblox domain queries. Validate that improved Roblox/Luau ranking does not regress exact file-name lookup or basic non-Roblox query usefulness on existing supported-language fixtures. Capture a fixed before-and-after comparison set for the representative Roblox queries and preserve it as durable evidence for the epic:

1. `SpotlightRegistry`
2. `lighting show service`
3. `UI service`
4. `world bootstrap`
5. one client/shared boundary query

Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md) and any relevant query-surface docs with the implemented ranking signals.

### [x] 103 Add Roblox-Aware Agent Summaries

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); query/context response formatting; docs
Work: Make query and context results more useful to agents on Roblox repos by surfacing Roblox-aware summary facts when they are available. This unit should enrich results with concise fields such as module-table symbol, file path, `runtimeArea`, Rojo/DataModel path context, and key imported boundary crossings, without dumping raw graph detail. Done when CodeNexus answers for representative Roblox modules feel intentionally informative rather than generic file listings and the added summary fields are grounded in facts already present in the graph.
Tests: Add output-focused tests for query and context behavior on representative Roblox fixtures, verifying the new summary fields appear when available, stay concise, and do not contradict the underlying graph facts.
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md), and any affected user-facing query docs.

### [x] 104 Prove Improved Ergonomics On A Real Rojo Repo

Surface: real product workflow (`codenexus init/index/serve`); live query path; validation target [/Users/alex/Projects/roblox/dancegame-agent-3](/Users/alex/Projects/roblox/dancegame-agent-3); docs
Work: Prove that the new symbolization, ranking, and summary improvements materially improve real-world agent usefulness on a Rojo repo. This unit must run a fixed query set against a representative real project, compare CodeNexus answers to actual source, and show that previously weak cases like module-table lookup or noisy broad queries are now better. This unit must record a concise before-and-after evidence snapshot so the improvement is auditable after the fact. Done when the repo has product-level evidence that Epic 08 correctness is now paired with materially better ergonomics.
Tests: Add or document a real-product smoke pass covering at least:

1. a module-table lookup like `SpotlightRegistry`
2. a broad service query like `lighting show service`
3. a client/shared/server-aware query like `UI service`
4. a bootstrap-oriented query like `world bootstrap`

and manually verify at least one returned answer against source. Use `/Users/alex/Projects/roblox/dancegame-agent-3` as the default acceptance target unless there is a documented reason to switch. The acceptance pass must capture before-and-after evidence for the fixed query set from Unit `102`.
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md), [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md), and any affected validation notes with the real-product proof.

### [x] 190 Milestone 100 Closeout

Surface: module-table symbolization; retrieval/ranking; Roblox-aware summaries; durable docs; validation evidence
Work: Confirm CodeNexus is now not only correct on Rojo-based Roblox repos, but also ergonomically useful for agents. This closeout must prove that module-table lookups work, broad Roblox/Luau queries rank better, summaries surface the right Roblox-aware context, and those improvements hold up on a real repo. It must also clearly separate what this epic solved from later work on branch intelligence and deferred higher-end retrieval features.
Tests: Run the selected docs, build, unit, integration, and real-product smoke checks for the final ergonomics layer.
Docs: Record closeout evidence in the epic and ensure the final supported behavior is reflected in [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/luau-core-support.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md), and [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md).

Closeout evidence table (required):

| Unit | Required evidence | Link / Note | Status |
|---|---|---|---|
| 100 | Query-ergonomics contract is locked | [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md) defines module-table symbol rules, ranking scope, summary scope, and explicit deferrals. | [x] |
| 101 | Luau module-table exports are first-class symbols | [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/luau-module-symbols.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/core/ingestion/luau-module-symbols.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/luau-module-symbols.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/luau-module-symbols.test.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/roblox-rojo-indexing.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/roblox-rojo-indexing.test.ts) prove representative module tables like `SpotlightRegistry` are graph symbols while file-level lookup still works. | [x] |
| 102 | Retrieval and ranking are materially improved | [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts) and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts) show better top results for `SpotlightRegistry`, `lighting show service`, `UI service`, and `world bootstrap` without regressing exact lookup. | [x] |
| 103 | Roblox-aware summaries are concise and useful | Query/context output from [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts) now surfaces `module_symbol`, `runtimeArea`, `data_model_path`, and `boundary_imports`, all grounded in indexed graph facts. | [x] |
| 104 | Real-product ergonomics are proven | Live queries on [/Users/alex/Projects/roblox/dancegame-agent-3](/Users/alex/Projects/roblox/dancegame-agent-3) now return `SpotlightRegistry`, `LightingShowService`, `UIService`, and `WorldBootstrap` as top results with manual source verification against the corresponding files. | [x] |
| 190 | Validation passed on the final ergonomics layer | `build`, `test`, `test:integration`, `test:all`, docs gates, and the real-product acceptance pass on `/Users/alex/Projects/roblox/dancegame-agent-3` all passed on the final branch state. | [x] |

Blocker criteria (190 cannot close if any are true):

- Module-table symbolization still misses representative exported Luau module tables.
- Lower-confidence module-symbol cases are allowed to outrank stronger named module symbols by default.
- Ranking improvements rely on fuzzy semantic inference rather than deterministic signals.
- Ranking improvements materially regress exact file or module lookup for representative cases.
- Roblox-aware summaries are noisy, misleading, or unsupported by actual graph facts.
- Real-product proof of improved ergonomics is missing.
- Docs, build, unit, integration, or product-smoke validation fail on the resulting ergonomics layer.
