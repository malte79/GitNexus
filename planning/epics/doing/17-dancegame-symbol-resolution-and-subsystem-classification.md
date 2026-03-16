Title: Dancegame Symbol Resolution And Subsystem Classification
Assigned to: Agent 1
Lane: Bridge
Status: doing
Objective: Close the remaining trust blockers from the latest dancegame follow-up on `/Users/alex/Projects/roblox/dancegame-agent-2` so CodeNexus can resolve obvious engineer-facing symbols consistently, assign subsystem hotspots and lifecycle signals to the right concise summary rows, and preserve the freshness and query-quality gains already achieved. Success is not “slightly better.” Success is a preserved before-versus-after benchmark record showing that `impact` and `context` resolve obvious names without guesswork, `summary --subsystems` no longer misclassifies signals like `Paths` under unrelated subsystems such as `Log`, freshness remains consistent across commands, and `client ui shell --owners` remains UI-led after the changes.
In scope: reproduce the latest dancegame follow-up against `/Users/alex/Projects/roblox/dancegame-agent-2` at the repo commit present when the epic begins and preserve that state as the acceptance baseline and benchmark anchor; improve structural symbol resolution so exact symbol names, exported module names, file basenames, and common engineer-facing shorthand names resolve consistently in `impact` and `context`; tighten concise subsystem classification so hotspots and lifecycle chokepoints land under the correct subsystem rows and are not obviously assigned to unrelated buckets; preserve the current freshness-consistency behavior across `manage status` and `summary`; preserve the improved owner/query relevance for natural-language subsystem prompts such as `client ui shell`; install the candidate build from the working checkout and rerun the exact acceptance corpus as the governing post-work benchmark before closeout.
Out of scope: new transport or runtime architecture; direct-backend bypass of the repo-local HTTP service; a new search engine or embeddings layer; hand-maintained alias maps keyed specifically to dancegame symbols or files; dancegame-specific path weighting, prompt hacks, or special-case summary labels; widening the concise summary into a detailed dump again; reworking risk dimensions or overload-shape surfaces beyond what is necessary to avoid regressions.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); current structural surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/context.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/context.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts); the dancegame trust benchmark and evidence format in [/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/done/16-dancegame-trustworthiness-and-summary-quality.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/done/16-dancegame-trustworthiness-and-summary-quality.md) and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/fixtures/dancegame-trust-corpus.json](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/fixtures/dancegame-trust-corpus.json); the exact follow-up command corpus from the latest dancegame report remaining the canonical acceptance surface and benchmark corpus for this epic, with no prompt rewrites or substitute commands; `/Users/alex/Projects/roblox/dancegame-agent-2` remaining unchanged while the epic is implemented so the preserved baseline and end-of-epic benchmark stay comparable.
Risks: symbol resolution may be “fixed” with repo-specific aliases instead of general product behavior; broader fallback lookup may overmatch unrelated symbols and make `impact` or `context` ambiguous or wrong; a partial resolution fix may let `query` discover the right file while `impact` and `context` still diverge on the same name, which would preserve workflow guesswork; subsystem classification may improve one row while smearing other hotspots into the wrong bucket if membership is widened carelessly; preserving freshness and query quality may regress silently if summary/classification work reintroduces old metadata paths or ranking side effects; acceptance may become invalid if the dancegame checkout changes or the installed build is not the one actually being measured; candidate-build closeout may be invalid if the global binary is updated but the repo-local service is not restarted before rerunning the corpus; the epic may still drift into prose-only “looks better” claims unless the same baseline matrix is updated by the installed-build benchmark rerun at closeout; pressure to satisfy the report may tempt hardcoded dancegame naming or alias shortcuts that violate universality.
Rollback strategy: if forgiving symbol resolution cannot be implemented generally, narrow it to a smaller truthful resolution stack and leave unresolved names as an open complaint rather than adding bespoke aliases; if broader lookup causes ambiguous overmatching, require explicit disambiguation instead of silently picking a likely candidate; if subsystem classification cannot be tightened truthfully, emit fewer subsystem rows or weaker but correct placement rather than inventing labels or forcing misassigned hotspots; if freshness consistency regresses, collapse all user-visible freshness reporting back onto the same underlying repo-state source before shipping; if query relevance regresses, revert only the ranking changes and keep the current improved owner-mode behavior; if installed-build results diverge from source-tree validation, or if the rerun was performed without restarting the repo-local service after installation, treat the installed-build measurement as invalid and keep the epic open; if the benchmark rerun cannot update the same baseline matrix field-for-field, treat closeout evidence as insufficient and keep the epic open.

### [x] 101 Capture The Follow-Up Dancegame Baseline

Surface: `/Users/alex/Projects/roblox/dancegame-agent-2`; current globally installed `codenexus`; epic-local evidence
Work: Reproduce the latest dancegame follow-up exactly enough to preserve a stable before-state baseline and benchmark anchor for the remaining trust blockers. This baseline must record the dancegame repo commit, the installed `codenexus` path and version, and the exact outputs for symbol-resolution failures, subsystem misclassification, freshness consistency, and the preserved improved query relevance. The evidence must include a complaint matrix keyed to symbol resolution, subsystem classification quality, freshness consistency, and query relevance, with structured fields for exact commands, top summary rows, misassigned hotspots and chokepoints, unresolved engineer-facing names, and the discovery results that prove the named surfaces exist. The baseline corpus must use the exact follow-up commands, with no substitutions or prompt rewrites, and the same matrix must be reused unchanged at closeout for the post-work benchmark comparison.
Tests: real product baseline run against `/Users/alex/Projects/roblox/dancegame-agent-2`; preserved command transcript or linked artifacts for `git rev-parse HEAD`, `codenexus manage status`, `codenexus summary --subsystems | sed -n '1,146p'`, `codenexus summary --subsystems | rg '"heuristicLabel"|"label"' | sed -n '1,80p'`, `codenexus query "client ui shell" --owners | sed -n '1,120p'`, `codenexus impact SweepController --direction upstream`, `codenexus impact OrchestratorPlaybackRuntime --direction upstream`, `codenexus query "SweepController spotlight sweep runtime" --owners | sed -n '1,120p'`, and the corresponding orchestrator discovery query named in the report; explicit complaint matrix with baseline fields for commit identity, summary row placement, and resolution failures
Docs: None

### [x] 102 Make Symbol Resolution Forgiving For Obvious Engineer-Facing Names

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/context.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/context.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts)
Work: Extend symbol lookup so `impact` and `context` resolve the obvious engineer-facing names a user would naturally type, using a deterministic general-purpose resolution stack: exact symbol name, exported module symbol, file-basename alias, and safe shorthand alias derived from existing indexed facts. The implementation must remain universal and must not use dancegame-specific alias maps, hardcoded symbol names, or repo-specific path rules. If multiple candidates remain plausible, preserve explicit disambiguation rather than guessing. Done only when the same obvious name resolves consistently across `impact` and `context`, or both surfaces reject it with the same explicit ambiguity contract.
Tests: targeted unit coverage in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts) and relevant CLI tests proving that obvious engineer-facing names like `SweepController` and `OrchestratorPlaybackRuntime` resolve through the general lookup stack; regression coverage that unrelated basename collisions remain disambiguated rather than silently overmatched; explicit negative coverage that ambiguous shorthand names do not silently bind to the wrong symbol; real-product rerun against `/Users/alex/Projects/roblox/dancegame-agent-2` for both `impact` and `context`
Docs: [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md)

### [x] 103 Tighten Concise Subsystem Classification Quality

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts)
Work: Improve concise subsystem classification so top hotspots and lifecycle chokepoints are assigned to the right subsystem rows and are no longer obviously misplaced, such as `Paths` or `Run → New` appearing under unrelated buckets like `Log`. Separate subsystem rows cleanly from process-level summaries without widening the output back into a raw dump. This must be done by tightening grounded assignment logic, not by hardcoding subsystem names or dancegame-specific placements. If the graph facts are too weak to place a signal truthfully, omit it from the concise row rather than forcing a wrong placement. Done only when the concise summary no longer shows baseline misplacements and does not leak raw low-signal bucket labels or process-like labels into the subsystem row stream.
Tests: targeted unit and integration coverage in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts) and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/local-backend.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/local-backend.test.ts) proving concise subsystem rows no longer misclassify clearly unrelated hotspots or process labels; acceptance rerun of `codenexus summary --subsystems | sed -n '1,146p'` and the label-grep command from the report on `/Users/alex/Projects/roblox/dancegame-agent-2`; explicit negative coverage that a signal omitted for weak grounding is absent rather than incorrectly reassigned
Docs: [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md)

### [x] 190 Milestone 100 Closeout

Surface: symbol resolution; concise subsystem summary; epic-local evidence
Work: Prove the remaining two active dancegame blockers are materially fixed against the preserved baseline. Closeout is complete only when the same before-versus-after matrix shows that obvious engineer-facing names now resolve through `impact` or `context`, and concise subsystem rows no longer contain the baseline’s clearly wrong hotspot and chokepoint placements. If either bar is only partially improved, keep this milestone open.
Tests: before-versus-after comparison against the `101` baseline for symbol resolution and subsystem placement; `npm run build --prefix gitnexus`
Docs: None

### [x] 201 Lock Freshness Consistency As A Regression Guard

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts)
Work: Preserve the current freshness fix while the symbol-resolution and classification work lands. Add or strengthen regression coverage so `git rev-parse HEAD`, `codenexus manage status`, and `codenexus summary --subsystems` continue to report one consistent freshness truth or explicitly mark stale output, and do not drift back into conflicting commit identities.
Tests: targeted unit and integration coverage in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/repo-manager.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/repo-manager.test.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/status-command.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/status-command.test.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts); acceptance rerun on `/Users/alex/Projects/roblox/dancegame-agent-2`
Docs: [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md)

### [x] 202 Lock Query Relevance At The Current Improved Quality

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/query.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/query.ts)
Work: Preserve the improved ranking quality for natural-language subsystem discovery while the remaining trust work lands. The acceptance bar is that `codenexus query "client ui shell" --owners` stays led by client/shared UI surfaces and does not let irrelevant server tile or runtime logic outrank the plainly intended subsystem.
Tests: targeted ranking regressions in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts); acceptance rerun of the exact `client ui shell --owners` command on `/Users/alex/Projects/roblox/dancegame-agent-2`
Docs: None

### [x] 290 Milestone 200 Closeout

Surface: freshness truth; query relevance; regression evidence
Work: Prove that the two already-improved trust surfaces remain intact while the new symbol-resolution and subsystem-classification changes land. Closeout is complete only when the preserved matrix shows no freshness regression and no ranking regression on the canonical `client ui shell --owners` query.
Tests: before-versus-after comparison against `101` for freshness and query relevance; `npm run test:integration --prefix gitnexus`
Docs: None

### [x] 301 Install The Candidate Build And Rerun The Dancegame Follow-Up Corpus

Surface: `/Users/alex/Projects/roblox/dancegame-agent-2`; current working checkout of `gitnexus`; globally installed `codenexus`; epic-local evidence
Work: Before epic closeout, build the current working checkout, install it globally on the machine, restart the repo-local service for `/Users/alex/Projects/roblox/dancegame-agent-2`, and rerun the exact dancegame follow-up corpus from `101` against that repo. This is a required measurement step, not an optional smoke test. The evidence must record the installed `codenexus` path, version, and source checkout path, the dancegame repo commit, the exact commands rerun, and the same complaint matrix updated field by field. The installed-build rerun is the required post-work benchmark verification for this epic. If the installed build differs materially from source-tree validation, the installed build controls closeout.
Tests: real product acceptance run through the newly installed `codenexus`; explicit before-versus-after comparison for every complaint in the `101` baseline matrix; verification that the install workflow used the operator-facing command sequence `npm run build --prefix gitnexus`, `npm link --prefix gitnexus`, `which codenexus`, and `codenexus --version`; explicit verification that `codenexus manage restart` was run on `/Users/alex/Projects/roblox/dancegame-agent-2` after installation and before rerunning the corpus; explicit verification that the post-work benchmark updates the same baseline matrix rather than a separate narrative summary
Docs: None

### [x] 390 Milestone 300 Closeout

Surface: installed-build acceptance evidence; dancegame trust verdict
Work: Prove the installed build itself resolves the remaining trust blockers against the same dancegame repo state. Closeout is complete only when the installed build shows reliable symbol resolution for the obvious engineer-facing names, cleaner concise subsystem classification, preserved freshness consistency, and preserved query relevance quality on the exact follow-up corpus. This milestone is the benchmark-verification gate: the exact corpus from `101` must be rerun and compared field-for-field against the preserved baseline.
Tests: installed-build before-versus-after benchmark comparison against `101`; `npm test --prefix gitnexus`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`
Docs: None

### [x] 490 Epic Closeout

Surface: symbol resolution; concise subsystem classification; freshness consistency; query relevance; installed-build acceptance evidence
Work: Epic closeout is complete only when the dancegame follow-up no longer supports the claim that CodeNexus is merely “useful first-pass” on this repo because of unresolved obvious-name failures or clearly wrong concise subsystem assignments. The final record must show reliable symbol resolution for engineer-facing names, cleaner concise subsystem classification, preserved freshness consistency, preserved query relevance, and installed-build benchmark evidence on the same dancegame repo commit. The epic is not complete if the fixes depend on repo-specific alias maps, dancegame-specific ranking rules, hardcoded subsystem placements, or any other bespoke shortcut. The epic is also not complete if the acceptance evidence still requires prose to explain away unresolved symbol-lookup misses, stale-service measurement, or obviously wrong subsystem placement.
Tests: `npm test --prefix gitnexus`; `npm run test:integration --prefix gitnexus`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`; real acceptance rerun against `/Users/alex/Projects/roblox/dancegame-agent-2` through the newly installed `codenexus`; explicit field-compatible before-versus-after benchmark comparison against the `101` baseline; verification that the installed-build rerun was performed after repo-local service restart and is sufficient to support the trust verdict without prose-only interpretation
Docs: None

## Benchmark Evidence

### Installed-Build Metadata

- CodeNexus checkout base commit measured: `6c04be4bffd0c21de4d8e0e58dcf5d236a2f9846` (installed build includes the current Epic 17 worktree on branch `codex/epic-17-dancegame-symbol-resolution-and-subsystem-classification`)
- Install workflow used:
  - `npm run build --prefix gitnexus`
  - `npm link --prefix gitnexus`
  - `which codenexus`
  - `codenexus --version`
  - `codenexus manage restart`
- Installed `which codenexus`: `/opt/homebrew/bin/codenexus`
- Installed package source path: `/Users/alex/Projects/GitNexusFork-agent-1/gitnexus`
- Installed `codenexus --version`: `1.3.10`
- Dancegame benchmark repo: `/Users/alex/Projects/roblox/dancegame-agent-2`
- Dancegame repo commit measured: `dc8d986542d2fc69f91d50b9969074ea047138b8`

### Complaint Matrix

| Complaint | Baseline | After | Status |
|---|---|---|---|
| Symbol resolution for obvious names | `codenexus impact SweepController --direction upstream`, `codenexus impact OrchestratorPlaybackRuntime --direction upstream`, `codenexus context SweepController`, and `codenexus context OrchestratorPlaybackRuntime` all returned `Symbol '...' not found`, even though owner discovery still surfaced the same files and modules | `impact` and `context` now resolve both obvious names through the general lookup stack: `SweepController` resolves to `SpotlightSweepController` in `src/server/Minigames/Spotlight/SweepController.lua`, and `OrchestratorPlaybackRuntime` resolves to `PlaybackRuntime` in `src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua` | resolved |
| Concise subsystem classification | Top concise row was `Log`; global hotspots showed `Log` and `Paths` under `Log`; global chokepoints showed `Run → New` under `Log` | Concise summary now leads with `Spotlight`, `Lighting`, `Bot`, `Procedural`, and `Lobby Runtime`; global hotspots are `Sweep Controller` under `Spotlight` and `Lighting Show Service Runtime` under `Lighting`; the `Log` / `Paths` / `Run → New` misplacement is gone from the concise first screen | resolved |
| Freshness consistency | Already correct at baseline: `git rev-parse HEAD`, `codenexus manage status`, and `codenexus summary --subsystems` all agreed on `dc8d986542d2fc69f91d50b9969074ea047138b8` and `serving_current` | Installed-build rerun preserved the same one-truth freshness contract on the same repo commit after service restart | preserved |
| Query relevance (`client ui shell`) | Already improved at baseline: first-screen owner results were UI-led instead of tile-collapse-led | Installed-build rerun preserved the same UI-led first screen, still starting with `DeviceProfile`, `DebugConsole`, and `WinnerPip` in `src/client/UI/**` | preserved |

### Baseline And After Highlights

- Baseline symbol-resolution failures:
  - `codenexus impact SweepController --direction upstream`: `Symbol 'SweepController' not found`
  - `codenexus impact OrchestratorPlaybackRuntime --direction upstream`: `Symbol 'OrchestratorPlaybackRuntime' not found`
  - `codenexus context SweepController`: `Symbol 'SweepController' not found`
  - `codenexus context OrchestratorPlaybackRuntime`: `Symbol 'OrchestratorPlaybackRuntime' not found`
- Baseline discovery still proved the surfaces existed:
  - `codenexus query "SweepController spotlight sweep runtime" --owners` surfaced `SpotlightSweepController` and `SweepController.lua`
  - `codenexus query "OrchestratorPlaybackRuntime lighting playback runtime" --owners` surfaced the lighting/orchestrator runtime surfaces around playback
- After installed-build symbol resolution:
  - `codenexus impact SweepController --direction upstream`: target is `SpotlightSweepController`, `member_count = 7`, `impactedCount = 15`
  - `codenexus impact OrchestratorPlaybackRuntime --direction upstream`: target is `PlaybackRuntime`, `member_count = 20`, `impactedCount = 1`
  - `codenexus context SweepController`: resolved module is `SpotlightSweepController`
  - `codenexus context OrchestratorPlaybackRuntime`: resolved module is `PlaybackRuntime`
- Baseline concise-summary misclassification:
  - `top_hotspots`: `Log` under `Log`, `Paths` under `Log`
  - `top_lifecycle_chokepoints`: `Run → New` under `Log`
- After installed-build concise summary:
  - `top_hotspots`: `Sweep Controller` under `Spotlight`, `Lighting Show Service Runtime` under `Lighting`
  - `top_lifecycle_chokepoints`: `StartRainbowCycle → GetPivot` under `Spotlight`, `StrobePreset → ReadNumber` under `Lighting`
  - top subsystem rows: `Spotlight`, `Lighting`, `Bot`, `Procedural`, `Lobby Runtime`

### Current Epic Verdict

- Units `101`, `102`, `103`, `190`, `201`, `202`, `290`, `301`, `390`, and `490` are complete with installed-build benchmark evidence.
- The remaining trust blockers from the corrected dancegame follow-up are closed on `/Users/alex/Projects/roblox/dancegame-agent-2`.
- The delivered behavior stays general-purpose:
  - no dancegame-specific alias maps
  - no path-specific ranking hacks
  - no hardcoded subsystem placements
