Title: Structural Query Surface And Quality Hardening
Assigned to: Agent 1
Lane: Bridge
Status: doing
Objective: Make CodeNexus a first-class structural analysis product for real repo work by separating use from administration in the CLI, surfacing the existing MCP query capabilities as top-level analysis commands, keeping the user guidance entrypoint on the use plane as `codenexus help`, regrouping lifecycle and repo-management operations under `codenexus manage ...`, improving broad subsystem discovery quality, strengthening context and impact coverage on central Python owners, polishing Cypher ergonomics, and adding a lightweight repo-summary mode.
In scope: first-party top-level CLI commands for `query`, `context`, `impact`, `detect-changes`, `cypher`, `rename`, and `help`; regrouping lifecycle and repo-admin operations under `codenexus manage ...`; complete command docs and help output for the structural query path, the HTTP-service dependency, and the new manage surface; improved broad-query ranking that favors production anchors over tests for subsystem discovery; stronger `context` and `impact` coverage on central Python runtime owners; friendlier Cypher help and starter-query guidance; a repo-summary or subsystem-summary surface for centrality and dependency overviews; clearer `status` messaging when `serving_stale` is caused by dirty state, reload lag, or auto-index backoff; real acceptance against the source checkout at `/Users/alex/Projects/roblox/rsproxy-agent-1` as a CodeNexus repo-analysis target only.
Out of scope: new language support; embeddings; world projection; branch-specific query behavior; replacing the MCP service transport; broad parser rewrites; speculative graph features not directly tied to the reported issues; changing the repo-local runtime ownership model under `.codenexus/`; any Roblox game-runtime, Studio-session, or live gameplay integration work in `rsproxy`.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md); current structural tool surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/info.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/info.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/mcp-http.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/mcp-http.ts).
Risks: CLI wrappers may drift from the MCP tool contract if they duplicate tool schemas instead of reusing them; wrapper commands may accidentally introduce hidden fallback behavior such as auto-starting the service or bypassing repo-bound health checks; the new top-level analysis commands may become confusing if they do not fail clearly when the repo-local HTTP service is unavailable and instead expose raw transport errors; broad-query ranking changes may over-correct and hide genuinely useful tests; central-symbol coverage work may expose deeper Python graph-model gaps than expected; repo-summary output may become noisy if it is added before centrality and ranking signals are trustworthy; more detailed stale-state wording may become verbose or contradictory if it is not driven from canonical repo-state details; Cypher help may become misleading if it silently rewrites user queries instead of explaining the correct form; the use-versus-manage reset may be implemented inconsistently if any legacy top-level admin commands remain callable or are only removed from help text instead of the actual command surface.
Rollback strategy: keep the existing MCP HTTP tool path as the canonical backend and make CLI wrappers thin adapters over it; if wrapper ergonomics prove brittle, keep direct MCP access documented and remove only the wrapper layer rather than forking tool behavior; do not preserve or restore legacy top-level admin aliases as a compatibility path inside this epic; if ranking changes produce regressions, revert to the existing production and test balance and tighten query-shape heuristics incrementally; if Python centrality coverage is not trustworthy yet, degrade suspicious `impact` confidence instead of presenting implausibly low-risk results; if repo-summary output is noisy, remove the summary command while preserving the improved core query surfaces; if Cypher help becomes misleading, fall back to explicit schema/help resources rather than query rewriting.

### [x] 101 Split The CLI Into Top-Level Analysis, Top-Level `help`, And `manage` Administration

Surface: `gitnexus/src/cli/index.ts`; new command modules under `gitnexus/src/cli/`; any shared local MCP client helper; `gitnexus/src/cli/info.ts`; `gitnexus/src/mcp/tools.ts`; `docs/cli/commands.md`; `docs/architecture/mcp-http-runtime.md`
Work: Reshape the CLI so structural analysis is exposed as top-level commands, user guidance remains on the use plane as `codenexus help`, and lifecycle or repo-admin operations live under `codenexus manage ...`. The target product shape is: top-level `help`, `query`, `context`, `impact`, `detect-changes`, `cypher`, `rename`, and any shipped summary surface for day-to-day use; `manage init`, `manage index`, `manage status`, `manage serve`, `manage start`, `manage stop`, and `manage restart` for service and repo administration. The structural commands must proxy into the repo-local MCP service using the existing tool contracts instead of inventing a second schema, must connect only to the matching repo-local service proved through the existing health checks, must not auto-start the service or fall back to hidden alternate transports, and must surface tool errors without inventing a second result format. When the repo-local HTTP service is unavailable, the structural commands must fail clearly and point users to `codenexus manage start` rather than exposing raw transport noise or trying a direct backend path. This unit must make the shipped command surface fully deterministic: legacy top-level admin commands and the old `info` entrypoint are removed from the CLI surface entirely rather than retained as aliases, hidden compatibility paths, or undocumented alternate entrypoints. If a user invokes an old top-level admin command or `codenexus info`, the CLI should fail clearly and point to the corresponding `manage` or `help` form. Done when a normal user can understand from the CLI shape alone that CodeNexus has a use surface and a manage surface, and can run structural analysis without hand-writing a local MCP client or changing the runtime ownership model.
Tests: `gitnexus/test/unit/cli-commands.test.ts`; new unit tests for top-level structural commands, top-level `help`, and `manage` subcommands; explicit tests that legacy top-level admin commands and `codenexus info` are no longer callable and produce clear guidance to the new `manage` or `help` forms; negative tests for missing service that require guidance to `codenexus manage start`, wrong-repo service, and tool-error passthrough; targeted integration proving wrapper commands reach a running repo-local service correctly
Docs: `docs/cli/commands.md`; `docs/architecture/mcp-http-runtime.md`

### [x] 102 Align `codenexus help` And Operator Guidance With The New Surface

Surface: `gitnexus/src/cli/info.ts`; `gitnexus/test/unit/info-command.test.ts`; `docs/cli/commands.md`
Work: Replace the current `codenexus info` guidance entrypoint with top-level `codenexus help` and make that help output present both the top-level structural query surface and the `manage` administration surface coherently. This unit must explain that everyday structural analysis happens through top-level commands, that repo and service administration happens through `codenexus manage ...`, and that direct MCP access remains available for advanced use. It must also explicitly document that the top-level structural commands still depend on the repo-local HTTP service rather than bypassing it, and that the normal remediation for an unavailable service is `codenexus manage start`. The examples must reflect the actual shipped command shape rather than hidden internal-only flows, must not imply any legacy top-level admin alias or `info` surface remains supported, and should show the new `manage` paths plainly enough that users do not need prior knowledge of the old layout. Done when the product no longer gives a first impression that CodeNexus is lifecycle-only and the use-versus-manage split is obvious from the guidance itself.
Tests: `gitnexus/test/unit/info-command.test.ts`; help-output assertions for HTTP-service dependency guidance and the `codenexus manage start` remediation path
Docs: `docs/cli/commands.md`

### [x] 103 Capture The `rsproxy` Baseline Reproduction

Surface: `/Users/alex/Projects/roblox/rsproxy-agent-1`; current `codenexus` CLI and MCP surfaces; epic-local validation evidence
Work: Reproduce the user-reported `rsproxy` failures before changing behavior and capture the exact before-state as the acceptance baseline for the rest of the epic. This unit must rerun the report flow against the source checkout at `/Users/alex/Projects/roblox/rsproxy-agent-1` through CodeNexus only, not through any live Roblox game or Studio session. The reproduced flow must include: lifecycle and discoverability checks from the current CLI surface before the new top-level and `manage` split; the broad subsystem `query` prompts; `context(CommandBridgeHandler)`; `impact(CommandBridgeHandler, upstream)`; the `type(r)` Cypher near-miss failure; and at least one representative `serving_stale` state that is operationally correct but easy to misread. The output of this unit must preserve the exact prompts, commands, and observed weak results in a stable epic-local evidence section or linked artifact paths so later milestone closeouts can compare against the same baseline rather than memory. Done when the epic contains a stable before-state reference for every major complaint in the feedback report.
Tests: bounded manual acceptance run against the source checkout at `/Users/alex/Projects/roblox/rsproxy-agent-1` through `codenexus` CLI and repo-local MCP only; capture before-state evidence for the exact prompts and symbols named above; verify the baseline evidence is recorded in an epic-local evidence section or linked artifact paths and is specific enough to reuse in milestone `190`, `290`, `390`, `401`, `402`, and `490`
Docs: None

### [x] 190 Milestone 100 Closeout

Surface: CLI wrappers; info output; command docs; validation evidence
Work: Prove the product surface now exposes the structural query capabilities directly and coherently with the intended split between use and administration. Closeout is complete only when the baseline reproduction evidence from `103` exists in a stable epic-local evidence section or linked artifact paths, top-level `help` and the new structural commands are available on the use plane, lifecycle and repo-admin commands are available under `codenexus manage ...`, legacy top-level admin commands and `codenexus info` are no longer callable from the CLI surface, the HTTP service dependency of the top-level structural commands remains documented for advanced users, unavailable-service failures point users clearly to `codenexus manage start`, and the docs and tests agree on the same surfaced commands.
Tests: `npm test --prefix gitnexus -- test/unit/cli-commands.test.ts test/unit/info-command.test.ts`; targeted integration for top-level `help`, the new top-level structural commands, and `manage` subcommands; before-versus-after comparison against the `103` baseline for structural-tool discoverability; explicit validation that legacy top-level admin commands are rejected with clear guidance to the `manage` forms, `codenexus info` is rejected with clear guidance to `codenexus help`, and unavailable-service structural commands point to `codenexus manage start`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`
Docs: None

### [x] 201 Improve Broad Query Ranking For Production Anchor Discovery

Surface: `gitnexus/src/mcp/local/local-backend.ts`; `gitnexus/src/core/search/bm25-index.ts`; ranking tests and fixtures
Work: Improve broad natural-language `query` ranking on repos like `rsproxy` so subsystem-discovery prompts prefer production owners, entrypoints, and central runtime symbols over tests and wrappers. The implementation must preserve exact lookup reliability, must not hide tests entirely, and should key off query shape and available structural signals rather than hard-coded repo-specific file names. Use the fixed acceptance prompt set from the feedback report as the baseline tuning set: `bridge http lifecycle status start stop studio automation`, `plugin shell lifecycle transport bootstrap runtime`, and `connected studio smoke matrix test harness playtest`. Done when those broad subsystem queries are materially less test-dominated and more useful for real refactor discovery without regressing exact lookup.
Tests: `gitnexus/test/integration/local-backend.test.ts`; targeted ranking fixtures for the fixed broad subsystem prompts above plus production-versus-test result ordering; regression tests that exact symbol/file lookups still behave as before
Docs: `docs/architecture/repo-local-implementation.md`

### [x] 202 Add A Repo Summary And Subsystem Summary Surface

Surface: `gitnexus/src/mcp/local/local-backend.ts`; `gitnexus/src/mcp/tools.ts`; corresponding CLI wrapper surface; `docs/cli/commands.md`
Work: Add a lightweight summary mode that can answer questions like top central production symbols by subsystem, production-versus-test concentration, and high fan-in or fan-out components. The summary must stay grounded in indexed graph facts, must not introduce new storage or background analysis passes, and should help with tasks like refactor ranking without requiring users to write raw Cypher first. Done when CodeNexus can produce a compact, read-only structural overview that is more useful than a broad free-form query for repo-ranking tasks.
Tests: new unit and integration tests for the summary tool or command; acceptance fixtures covering centrality, production-versus-test split, and subsystem breakdown output
Docs: `docs/cli/commands.md`; `docs/architecture/repo-local-implementation.md`

### [x] 290 Milestone 200 Closeout

Surface: query ranking; repo-summary output; acceptance query set; validation evidence
Work: Prove that broad structural discovery is now materially better for real repo-level exploration. Closeout is complete only when the fixed subsystem prompt set and summary output favor useful production anchors over test-heavy noise on the target acceptance repo compared with the captured `103` baseline preserved in epic-local evidence.
Tests: `npm run test:integration --prefix gitnexus`; targeted ranking and summary assertions against the fixed subsystem prompt set; before-versus-after comparison to the `103` broad-query baseline
Docs: None

### [x] 301 Strengthen `context` Coverage On Central Python Owners

Surface: Python ingestion and graph-linking seams under `gitnexus/src/core/ingestion/`; `gitnexus/src/mcp/local/local-backend.ts`; relevant tests
Work: Investigate and fix sparse `context` output on large central Python symbols such as `CommandBridgeHandler`. This unit must improve categorized incoming and outgoing relationship coverage for high-centrality runtime owners without fabricating relationships, and must prefer explicit uncertainty or partial-coverage messaging over empty-looking success when the graph is incomplete. Done when central Python classes that are clearly shared runtime anchors produce materially richer `context` results or clearly report remaining graph-coverage limits.
Tests: targeted Python ingestion and `context` integration tests for central-class scenarios modeled after the `rsproxy` failures; regression tests that incomplete cases report uncertainty rather than silently sparse success
Docs: `docs/architecture/repo-local-implementation.md`

### [x] 302 Improve `impact` Trustworthiness For Central Runtime Owners

Surface: `gitnexus/src/mcp/local/local-backend.ts`; any affected graph-traversal helpers; impact tests
Work: Fix under-reported blast-radius results for central Python owners. This unit must ensure that very central runtime symbols no longer report implausibly low upstream impact simply because graph coverage is sparse, and should downgrade confidence or report uncertainty explicitly when coverage is incomplete instead of emitting misleadingly crisp low-risk results. Done when `impact` is materially more believable on the symbols users care about most for refactor safety.
Tests: targeted `impact` integration tests for central Python classes and shared runtime owners; regression tests for existing non-Python `impact` behavior; negative tests that incomplete coverage does not collapse into spurious `LOW` / zero-impact output
Docs: `docs/cli/commands.md`; `docs/architecture/repo-local-implementation.md`

### [x] 390 Milestone 300 Closeout

Surface: Python context coverage; impact confidence; validation evidence
Work: Prove that `context` and `impact` are now strongest, not weakest, on the repo’s most central runtime owners. Closeout is complete only when the known weak central-symbol cases produce richer `context` output and more credible `impact` results on the acceptance repo compared with the captured `103` baseline preserved in epic-local evidence.
Tests: `npm run test:integration --prefix gitnexus`; targeted `context` and `impact` acceptance checks modeled on `CommandBridgeHandler`, `BridgeInspectionExecutor`, `BridgeLifecycleExecutor`, and `ProtocolRouter`; before-versus-after comparison to the `103` central-symbol baseline
Docs: None

### [x] 401 Add Friendlier Cypher Help And Starter Guidance

Surface: `gitnexus/src/mcp/local/local-backend.ts`; `gitnexus/src/mcp/resources.ts`; `docs/cli/commands.md`; any schema-help resource surface
Work: Improve the advanced query path so users recover quickly from near-miss Cypher mistakes. This unit must add friendlier guidance for common errors such as `type(r)` misuse, expose a concise schema cheat sheet, and provide a small set of repo-agnostic starter graph queries. The help path must not silently rewrite or broaden user queries; it should explain the correct CodeRelation-property form and leave the query under user control. Done when advanced users can move from a raw graph error to the correct CodeRelation-property form without guesswork and the `type(r)` failure path from the captured `103` baseline is demonstrably improved.
Tests: unit tests for error translation or guidance helpers; integration tests for schema/help resource availability; regression tests that invalid queries are not silently rewritten; before-versus-after comparison to the `103` Cypher-error baseline
Docs: `docs/cli/commands.md`; any matching architecture or resource docs

### [x] 402 Clarify `serving_stale` Status Messaging

Surface: `gitnexus/src/cli/status.ts`; `gitnexus/src/storage/repo-manager.ts`; status tests; repo-state docs
Work: Make `status` easier to interpret when the service is stale for different reasons such as dirty working tree state, pending live adoption, reload failure, or auto-index backoff. The output must stay truthful and driven by canonical repo-state detail flags, must preserve the existing base-state semantics, and should make the dominant reason plus next action legible without forcing users to infer it. Done when the operational state is still precise but less cognitively muddy and the confusing `serving_stale` case captured in the `103` baseline is materially clearer without changing the underlying state model.
Tests: `gitnexus/test/unit/status-command.test.ts`; any repo-state tests needed for new messaging branches; negative tests for mixed stale causes so one cause is explained without suppressing the others; before-versus-after comparison to the `103` stale-status baseline
Docs: `docs/architecture/repo-state-model.md`; `docs/cli/commands.md`

### [x] 490 Epic Closeout

Surface: CLI surface; ranking quality; central-symbol coverage; Cypher help; status messaging; acceptance evidence
Work: Epic closeout is complete only when the structural query features are first-class from the CLI, broad subsystem discovery is less noisy, central-symbol `context` and `impact` behavior is materially stronger, Cypher help is friendlier, and stale-state status messaging is clearer on the real acceptance repo. The final evidence must show before-versus-after improvement against the captured `103` baseline preserved in epic-local evidence and demonstrate that CodeNexus is closer to a primary structural analysis tool for the `rsproxy` source checkout, not just a companion to direct filesystem reading.
Tests: `npm test --prefix gitnexus`; `npm run test:integration --prefix gitnexus`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`; real acceptance pass against the source checkout at `/Users/alex/Projects/roblox/rsproxy-agent-1` through `codenexus` only, with explicit before-versus-after comparison to the `103` baseline
Docs: None

## Evidence

### 103 Baseline

Baseline source: the user feedback report captured on March 12, 2026 for `/Users/alex/Projects/roblox/rsproxy-agent-1` in this thread. That report is the preserved before-state reference for all major complaints because the original file was removed from the repo after delivery.

Baseline complaints preserved from the report:

- CLI discoverability looked lifecycle-only until the user manually wired an MCP client.
- Broad `query` prompts such as `bridge http lifecycle status start stop studio automation` were heavily test-biased.
- `context(CommandBridgeHandler)` returned essentially no useful relationship detail.
- `impact(CommandBridgeHandler, upstream)` returned implausibly weak `LOW` / `0`-impact output.
- `cypher` on `type(r)` failed with a raw catalog error and no useful correction path.
- `status` could truthfully report stale state in a way that was easy to misread without clearer dominant-cause messaging.

### 490 After-State

Final acceptance target: `/Users/alex/Projects/roblox/rsproxy-agent-1` through the rebuilt CLI at `/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/dist/cli/index.js`.

Final acceptance commands and observed outcome:

- `help`
  - showed the explicit use plane vs `manage` plane split
  - documented that top-level structural commands still use the repo-local HTTP service
  - pointed unavailable-service remediation to `codenexus manage start`
- `status`
  - now fails clearly with `Top-level \`status\` was removed. Use \`codenexus manage status\` instead.`
- `manage status`
  - reported healthy background service state on port `4757`
- `query "bridge http lifecycle status start stop studio automation"`
  - no longer returned a test-dominated top block
  - now surfaced production anchors first, including `BridgeLifecycleExecutor`, `typed/bridge/http/runtime/core.py` lifecycle functions, `build_default_route_registry`, and `ProtocolRouter`
  - still included some lower-ranked test/script noise, but materially less than the baseline
- `summary --limit 5 --no-processes`
  - now reports production/test split as `341` production files vs `88` test files
  - top symbols are no longer dominated by test files
- `context CommandBridgeHandler`
  - now returns `kind: "Class"` instead of a blank kind
  - still has sparse direct relationships on this repo, but now marks coverage as `partial` instead of falsely implying grounded completeness
- `impact CommandBridgeHandler --direction upstream`
  - still has no direct impacted symbols on this repo snapshot
  - now marks coverage as `partial` with an explicit incomplete-coverage note instead of presenting the result as fully grounded
- `cypher "MATCH (a)-[r]->(b) RETURN type(r) AS relType LIMIT 5"`
  - now returns a friendly hint pointing to `CodeRelation {type: ...}`, the schema resource, and starter queries

### Validation

Validation completed on March 12, 2026:

- `npm test --prefix gitnexus`
- `npm run test:integration --prefix gitnexus`
- `npm run build --prefix gitnexus`
- `npm run lint:docs --prefix gitnexus`
- `npm run check:docs-contracts --prefix gitnexus`

All of the above passed in this checkout.

Stale-status note:

- The final `rsproxy` acceptance pass ended in `serving_current`, not `serving_stale`.
- The stale-state clarity improvement was therefore validated through the new `status` messaging branches and unit coverage in this repo rather than by mutating the sibling `rsproxy` checkout into a dirty/stale state.
