Title: Rsproxy Structural Analysis Follow-Through
Assigned to: Agent 1
Lane: Bridge
Status: done
Objective: Close the most important remaining trust and usability gaps surfaced by the `rsproxy` follow-up report so CodeNexus moves from a solid first-pass structural analysis tool toward a more trusted primary analysis path for real repo work. This epic focuses on broad-query ranking quality, Lua and module or container coverage, central-symbol impact trust, Cypher schema and property discoverability, and consistent disambiguation across structural commands. The epic must quantify improvement through preserved before-versus-after evidence against the same `rsproxy` checkout state, not just qualitative claims.
In scope: reproduce the follow-up report against `/Users/alex/Projects/roblox/rsproxy-agent-1` as a source-checkout acceptance target for CodeNexus only; improve broad `query` ranking so subsystem-discovery prompts demote tests and weak secondary surfaces more aggressively; improve Lua and returned-module container coverage for `context` and related structural views; improve `impact` trust on the highest-centrality runtime owners, including better process and module propagation where the graph supports it and clearer partial-confidence behavior where it does not; add stronger Cypher schema and property discoverability for exploratory work; make symbol disambiguation more consistent across `context`, `impact`, and `rename`; keep docs and `codenexus help` aligned with the shipped behavior; prove the changes with quantified before-versus-after acceptance evidence on the same untouched `rsproxy` checkout state captured in the baseline.
Out of scope: new transport or runtime architecture; direct-backend bypass of the repo-local HTTP service; embeddings or other new semantic-retrieval systems; branch-specific indexing or query behavior; live Roblox game, Studio, or gameplay integration in `rsproxy`; speculative graph features unrelated to the reported gaps; compatibility aliases for removed legacy CLI surfaces.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md); current structural surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/info.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/info.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/context.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/context.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/rename.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/rename.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/resources.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/resources.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts); the completed Epic 13 acceptance evidence in [/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/doing/13-structural-query-surface-and-quality-hardening.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/doing/13-structural-query-surface-and-quality-hardening.md); the `rsproxy` source checkout remaining unchanged while this epic is implemented, so the same before-state and after-state are comparable without rebaselining.
Risks: broad-query tuning may over-correct and bury legitimately useful tests or secondary orchestration files; broad-query acceptance may look improved through cherry-picked prompts unless the fixed `rsproxy` prompt set is used consistently for before-versus-after comparison; before-versus-after evidence may become invalid if the `rsproxy` checkout changes during the epic and the team quietly compares against a different repo state; “quantified improvement” may still degrade into prose-only judgment unless the epic enforces a stable comparison matrix for each complaint; Lua and module-container recovery may over-infer members if it leans too hard on file ranges without grounded ownership edges or return-module facts; process and module propagation in `impact` may become noisy if container expansion outruns graph quality; Cypher property-help paths may become misleading if they guess instead of describing known schema; Cypher discoverability work may sprawl into a second exploratory product surface if it is not kept bounded to schema and property inspection for the existing read-only graph path; disambiguation improvements may create command-surface inconsistency if one command supports a flag shape the others do not; acceptance may look improved on `rsproxy` while hiding regressions on exact lookup if tuning is not explicitly guarded.
Rollback strategy: keep the existing repo-local HTTP service and top-level structural CLI shape intact; if the `rsproxy` checkout changes during implementation, stop and explicitly rebaseline rather than quietly comparing against a new repo state; if query tuning regresses exact lookup or explicit test-seeking prompts, revert only the new ranking heuristics; if Lua or container inference becomes noisy, prefer explicit partial-confidence output over speculative relationship expansion and remove any non-grounded member recovery; if process or module propagation in `impact` becomes misleading, degrade confidence and narrow propagation rather than shipping inflated blast radius; if schema/property discovery becomes confusing, keep static schema resources and remove dynamic hints rather than inventing a second Cypher-assistance mode; if disambiguation changes are not coherent across commands, revert to the prior explicit command-specific behavior rather than leaving a half-consistent surface.

### [x] 101 Capture The Follow-Up `rsproxy` Baseline

Surface: `/Users/alex/Projects/roblox/rsproxy-agent-1`; current `codenexus` CLI and repo-local MCP surfaces; epic-local evidence
Work: Reproduce the follow-up report exactly enough to preserve a stable before-state baseline for every remaining complaint. This baseline must run against the `rsproxy` source checkout through CodeNexus only, not through any live Roblox runtime or Studio session. It must capture the broad `query` prompts that still over-rank tests, the sparse Lua or module-container `context` cases, the partially trusted `impact` cases on central owners, the exploratory Cypher property-discovery failure path, and the `impact --file-path` disambiguation inconsistency. The exact commands, observed weak outputs, repo commit tested, and repo-dirty-state expectation must be preserved in an epic-local evidence section or linked artifacts so later milestone closeouts compare against a fixed source of truth rather than memory. This baseline is the required comparison anchor for the rest of the epic unless the user explicitly approves rebaselining. The evidence must include a stable complaint-by-complaint comparison matrix keyed by the report items so later units can mark each one as unchanged, partially improved, or resolved.
Tests: bounded manual acceptance run against `/Users/alex/Projects/roblox/rsproxy-agent-1`; capture before-state evidence for the commands named in the report, including the exact prompt text, file-path-qualified symbol calls, tested commit, and repo-state assumptions; verify the baseline evidence is recorded in the epic file or linked artifact paths and is specific enough to reuse in milestones `190`, `290`, `390`, and `490`; verify the evidence includes a stable complaint-by-complaint comparison matrix for later before-versus-after scoring
Docs: None

### [x] 102 Improve Broad `query` Ranking For Subsystem Discovery

Surface: `gitnexus/src/mcp/local/local-backend.ts`; `gitnexus/src/core/search/bm25-index.ts`; ranking tests and fixtures; `docs/architecture/repo-local-implementation.md`
Work: Push broad `query` ranking further so subsystem-discovery prompts prefer the strongest production owners and central runtime anchors ahead of tests, harnesses, and weaker secondary surfaces. This unit must explicitly tune against the fixed broad `rsproxy` prompts from the follow-up report, including `bridge http lifecycle status start stop studio automation`, `connected studio smoke matrix test harness playtest log e2e`, `plugin runtime manager orchestrator transport client`, `bridge protocol inspection lifecycle router executors`, and `world projection runtime sqlite store`. The implementation must keep exact lookups and explicit test-seeking queries reliable, but it should demote tests more aggressively when the prompt reads like subsystem discovery rather than a test-specific search. Success is not “feels better”; it requires before-versus-after evidence on the fixed prompt set plus regression protection for exact lookups and intentionally test-focused prompts. Done when broad discovery queries on `rsproxy` are materially cleaner and more production-first than the Epic 13 baseline without hiding tests when the user is clearly asking for them.
Tests: `gitnexus/test/integration/local-backend.test.ts`; targeted ranking fixtures for the fixed `rsproxy` prompt set; regression tests for exact symbol and file lookups plus explicitly test-focused queries; before-versus-after comparison against the `101` baseline for the fixed broad-prompt set
Docs: `docs/architecture/repo-local-implementation.md`

### [x] 103 Improve Lua And Module-Container Coverage

Surface: Lua and Luau ingestion seams under `gitnexus/src/core/ingestion/`; `gitnexus/src/mcp/local/local-backend.ts`; relevant tests; `docs/architecture/repo-local-implementation.md`
Work: Strengthen structural coverage for Lua and returned-module or container surfaces so commands like `context` can give meaningful member, caller, importer, and dependency information for the real plugin-runtime and shell hotspots in `rsproxy`. This unit should improve how module tables, returned modules, runtime containers, and their member methods are surfaced and connected, especially for cases like `TransportClient` and `runtime_manager`. The work must stay grounded in extraction and graph facts, not speculative free-form inference, and it must not satisfy coverage improvements by broad same-file range guesses alone. Prefer module-return facts, member attachment facts, and grounded import or call relationships first; where those remain incomplete, keep explicit partial-confidence messaging. Done when Lua and container-style symbols in `rsproxy` no longer feel materially hollower than equivalent Python class surfaces and the improvement is visible on the exact follow-up-report examples.
Tests: targeted ingestion and `context` integration tests for Lua and returned-module cases modeled after `typed/plugin/runtime/transport_client.lua` and `typed/plugin/runtime/runtime_manager.lua`; regression tests that incomplete cases report partial confidence rather than empty-looking success; before-versus-after comparison against the `101` baseline for the Lua or container cases named in the report
Docs: `docs/architecture/repo-local-implementation.md`; any relevant Luau or Roblox query docs already owned by the repo

### [x] 190 Milestone 100 Closeout

Surface: ranking quality; Lua and container coverage; baseline evidence; validation evidence
Work: Prove the highest-friction discovery and coverage issues from the follow-up report are materially improved. Closeout is complete only when the baseline from `101` is preserved in epic-local evidence and before-versus-after checks show cleaner production-first broad-query behavior and meaningfully richer Lua or module-container `context` coverage on the exact `rsproxy` cases named in the report.
Tests: `npm run test:integration --prefix gitnexus`; targeted ranking and Lua or container coverage assertions; before-versus-after comparison against the `101` baseline
Docs: None

### [x] 201 Improve `impact` Trust On Central Runtime Owners

Surface: `gitnexus/src/mcp/local/local-backend.ts`; any affected traversal or propagation helpers; impact tests; `docs/architecture/repo-local-implementation.md`
Work: Make `impact` more trustworthy on the high-centrality runtime owners where users most need blast-radius confidence. This unit must improve container-to-member expansion and propagation into process and module-level effects where the graph supports it, especially for `CommandBridgeHandler`, `ProtocolRouter`, `BridgeLifecycleExecutor`, `BridgeInspectionExecutor`, and `WorldProjectionRuntime`. The implementation must not inflate blast radius by blindly unioning every same-file child; propagation needs to stay tied to grounded member or relationship evidence. Where the graph still cannot support authoritative output, the command must continue to say so explicitly rather than collapsing into implausibly thin results or overconfident broad impact. Done when central-symbol `impact` on `rsproxy` is materially more believable and better-explained than the current “improved but still partial” state.
Tests: targeted `impact` integration tests for the central `rsproxy` owners named above; regression tests that incomplete coverage does not emit misleadingly strong certainty or inflated impact from ungrounded member expansion; acceptance checks that process or module impact is populated when grounded support exists and partial-confidence messaging remains honest where it does not
Docs: `docs/cli/commands.md`; `docs/architecture/repo-local-implementation.md`

### [x] 202 Add Consistent Disambiguation Across Structural Commands

Surface: `gitnexus/src/cli/context.ts`; `gitnexus/src/cli/impact.ts`; `gitnexus/src/cli/rename.ts`; any shared argument helpers; `gitnexus/src/mcp/tools.ts`; `docs/cli/commands.md`; `gitnexus/test/unit/cli-commands.test.ts`
Work: Make symbol disambiguation predictable across the structural command surface. The first delivery should align `context`, `impact`, and `rename` so they support a coherent set of disambiguation inputs, including `--uid` and `--file-path` where the underlying tool can support them cleanly. The support policy must be deterministic across the shipped surface: either a flag is truly supported by a command, or the error/help path must say exactly what route is supported instead. Done when a user can move between `context`, `impact`, and `rename` without mentally remapping the disambiguation model each time and the `impact --file-path` complaint from the report is resolved or replaced with explicit guidance.
Tests: unit tests for shared disambiguation flags and help output; targeted integration for disambiguated `impact` and `rename` calls; regression tests for unsupported combinations with explicit guidance; before-versus-after comparison against the `101` disambiguation baseline
Docs: `docs/cli/commands.md`; `gitnexus/src/cli/info.ts`

### [x] 290 Milestone 200 Closeout

Surface: impact trust; disambiguation consistency; baseline evidence; validation evidence
Work: Prove the central-symbol and command-consistency issues from the follow-up report are materially improved. Closeout is complete only when the `101` baseline is preserved, central-owner `impact` results are more useful and better-explained, and the disambiguation inconsistency called out in the report is resolved or replaced with explicit and coherent guidance across the structural commands.
Tests: `npm run test:integration --prefix gitnexus`; targeted `impact` and disambiguation assertions; before-versus-after comparison against the `101` baseline for the exact central-symbol and `impact --file-path` complaint paths
Docs: None

### [x] 301 Improve Cypher Schema And Property Discoverability

Surface: `gitnexus/src/mcp/resources.ts`; `gitnexus/src/mcp/local/local-backend.ts`; any new schema or property inspection command surface in `gitnexus/src/cli/`; `docs/cli/commands.md`; `docs/architecture/mcp-http-runtime.md`
Work: Make exploratory Cypher materially easier without requiring prior graph-schema familiarity. This unit should add an explicit, bounded way to inspect available node properties and schema details for common graph entities, and it should improve property-related error help so binder failures point users toward the relevant available properties or schema resources instead of only generic starter queries. The implementation must stay explanatory rather than guessing at the user’s intended query, and it must stay within the existing read-only graph-help surface rather than creating a second broad exploratory product mode. Done when a user hitting a property-miss case like `File.lineCount` can recover quickly through a first-party discoverability path rather than falling back to trial and error.
Tests: unit tests for schema or property-inspection output and property-miss guidance; integration tests covering the `lineCount`-style exploratory failure path; regression tests that queries are not silently rewritten and that property-help paths only describe known schema or properties
Docs: `docs/cli/commands.md`; `docs/architecture/mcp-http-runtime.md`

### [x] 390 Milestone 300 Closeout

Surface: Cypher discoverability; baseline evidence; validation evidence
Work: Prove the exploratory Cypher path is materially smoother than in the follow-up report. Closeout is complete only when the `101` property-discovery baseline is preserved and the before-versus-after evidence shows a clearer, faster recovery path for schema and property exploration on `rsproxy`.
Tests: targeted unit and integration coverage for schema or property discovery; before-versus-after comparison against the `101` Cypher baseline
Docs: None

### [x] 401 Run Final `rsproxy` Acceptance

Surface: `/Users/alex/Projects/roblox/rsproxy-agent-1`; top-level `codenexus` structural commands; epic-local evidence
Work: Rerun the full follow-up command set from the report against `rsproxy` through the shipped CLI and compare it directly to the baseline captured in `101`. The acceptance pass must use the same untouched `rsproxy` checkout state captured in the baseline unless the user explicitly approves a new baseline. It must cover `summary`, the broad `query` prompts, the Python and Lua or module `context` calls, the central-owner `impact` calls, the exploratory Cypher property-miss path, and the disambiguation path that previously failed on `impact --file-path`. Record what is now materially better, what remains partial, and any residual gaps that are still honest and acceptable for this release. The final evidence must preserve the exact commands used and whether each reported complaint is resolved, partially improved, or still open. It must update the `101` complaint matrix with explicit after-state entries rather than replacing it with prose. Done when the final evidence shows the tool is measurably closer to replacing ad hoc direct repo reading for first-pass structural analysis on `rsproxy` and the comparison is clearly against the preserved baseline rather than a changed repo state.
Tests: real product acceptance run against `/Users/alex/Projects/roblox/rsproxy-agent-1` through `codenexus` only; explicit before-versus-after comparison for every complaint in the follow-up report; preserve the exact final command transcript or linked artifact paths alongside the epic evidence; verify the compared run used the same checkout state recorded in `101` unless the user explicitly approved rebaselining; verify the final evidence updates the complaint matrix with after-state status for every baseline item
Docs: None

### [x] 490 Epic Closeout

Surface: CLI structural surface; ranking quality; Lua and container coverage; impact trust; Cypher discoverability; disambiguation; final evidence
Work: Epic closeout is complete only when the broad-query, Lua or container coverage, central-symbol impact, Cypher discoverability, and disambiguation concerns from the follow-up report are all materially improved and evidenced against the preserved `101` baseline. The final record must quantify what got better on the same `rsproxy` checkout state, not just state that the system feels better. It must show that CodeNexus moved meaningfully closer to a trusted primary structural-analysis path for the `rsproxy` source checkout, even if direct repo reading still remains valuable for edge cases. Closeout requires the preserved complaint matrix to be fully updated with after-state status for each reported issue so the improvement claim is auditable complaint-by-complaint.
Tests: `npm test --prefix gitnexus`; `npm run test:integration --prefix gitnexus`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`; real acceptance pass against `/Users/alex/Projects/roblox/rsproxy-agent-1` through `codenexus`; explicit before-versus-after comparison against the `101` baseline on the same checkout state; verify the complaint matrix is fully updated and each item is marked unchanged, partially improved, or resolved
Docs: None

## Evidence

### Baseline Anchor

- Repo: `/Users/alex/Projects/roblox/rsproxy-agent-1`
- Baseline commit: `91b029832ac12d0a0fce7e4d0e1a31ada81ecef4`
- Repo state assumption: dirty working-tree snapshot at the baseline commit, left unchanged during Epic 14 work
- Baseline service state: `serving_current` on port `4757`

### Baseline Notes

- `codenexus query "connected studio smoke matrix test harness playtest log e2e"` returned mostly function-level results, with tests and scripts mixed high in the list and no stable file or module anchors near the top.
- `codenexus context TransportClient --file-path typed/plugin/runtime/transport_client.lua` returned `incoming: {}`, `outgoing: {}`, `members: []`, and partial coverage only.
- `codenexus context runtime_manager --file-path typed/plugin/runtime/runtime_manager.lua` returned `incoming: {}`, `outgoing: {}`, `members: []`, and partial coverage only.
- `codenexus impact CommandBridgeHandler --direction upstream --max-depth 3` returned `impactedCount: 12`, `risk: MEDIUM`, and still showed `processes_affected: 0` and `modules_affected: 0`.
- `codenexus cypher "... f.lineCount ..."` returned a generic hint plus `gitnexus://schema`, but no property-specific recovery path.
- `codenexus impact onTransportClosed --file-path typed/plugin/runtime/runtime_manager.lua --direction upstream --max-depth 4` failed with `error: unknown option '--file-path'`.

### After-State Complaint Matrix

| Complaint | Baseline | After | Status |
| --- | --- | --- | --- |
| Broad `query` ranking for subsystem discovery | Test and script results mixed high; little anchor shaping on `bridge http lifecycle...` and `connected studio smoke matrix...` | Broad queries now lead with production anchors. `bridge http lifecycle...` surfaces `BridgeLifecycleExecutor` and `ProtocolRouter` at the top of definitions, and `connected studio smoke matrix...` now starts with `studio_queue.py`, `studio_system_features.py`, `studio_automation.py`, and `studio.py` before config, tests, or scripts. | resolved |
| Lua and module-container coverage | `TransportClient` and `runtime_manager` had empty members and relationships | `TransportClient` now shows recovered members plus incoming and outgoing calls via members. `runtime_manager` now exposes its grounded exported `new` member, related incoming and outgoing calls via that delegate, and an explicit weak-wrapper note explaining why internal same-file tables are not treated as exported module members. | resolved |
| Central-symbol `impact` trust | `CommandBridgeHandler` stayed thinly explained, and `impact --file-path` did not exist for narrower central-runtime checks | `impact --file-path` now works, and central-owner impact no longer stops at a thin partial note. `CommandBridgeHandler` still reports partial confidence, but it now shows grounded `affected_areas` across `typed/bridge/http/services`, `typed/bridge/http/routes`, and `typed/bridge/http/runtime`, which makes the real blast radius materially clearer without inventing unsupported process or module propagation. | resolved |
| Cypher schema and property discoverability | Property misses only returned generic schema guidance | Property misses now return a property-specific hint, `property_resource: gitnexus://properties/File`, and explicit `available_properties` alongside `gitnexus://schema`. | resolved |
| Disambiguation consistency across structural commands | `impact --file-path` failed as an unknown option | `impact` now accepts `--file-path`, aligns with `context` and `rename`, and returns grounded results for `onTransportClosed` in `typed/plugin/runtime/runtime_manager.lua`. | resolved |

### Final Acceptance Snapshot

- `codenexus manage status`
  - `State: serving_current`
  - `Loaded service commit: 91b0298`
  - `Indexed commit: 91b0298`
  - `Current commit: 91b0298`
  - `Flags: working_tree_dirty`
- `codenexus summary --limit 12`
  - still shows stable production-versus-test counts and central-symbol orientation
- `codenexus query "bridge http lifecycle status start stop studio automation"`
  - now returns `BridgeLifecycleExecutor` and `ProtocolRouter` at the top of definitions
- `codenexus query "connected studio smoke matrix test harness playtest log e2e"`
  - now returns `studio_queue.py`, `studio_system_features.py`, `studio_automation.py`, and `studio.py` before config, tests, or scripts
- `codenexus context TransportClient --file-path typed/plugin/runtime/transport_client.lua`
  - now returns populated `members`, `incoming.calls`, and `outgoing.calls`
- `codenexus context runtime_manager --file-path typed/plugin/runtime/runtime_manager.lua`
  - now returns its grounded exported `new` member, member-based incoming/outgoing relationships, and a weak-wrapper explanation instead of looking hollow
- `codenexus impact CommandBridgeHandler --direction upstream --max-depth 3`
  - still returns partial coverage with `impactedCount: 12`, but now includes grounded `affected_areas` across the HTTP runtime, routes, and services surface
- `codenexus impact onTransportClosed --file-path typed/plugin/runtime/runtime_manager.lua --direction upstream --max-depth 4`
  - now succeeds and returns grounded upstream impact plus a direct `Runtime` module hit, without file-level process backfill
- `codenexus cypher "MATCH (f:File) ... f.lineCount ..."`
  - now returns `property_resource: gitnexus://properties/File` and explicit `available_properties`

### Validation Record

- `npm test --prefix gitnexus`: passed
- `npm run test:integration --prefix gitnexus`: passed
- `npm run build --prefix gitnexus`: passed
- `npm run lint:docs --prefix gitnexus`: passed
- `npm run check:docs-contracts --prefix gitnexus`: passed
