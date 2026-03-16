Title: Dancegame Summary Representativeness And Refactor Pressure
Assigned to: unassigned
Lane: Bridge
Status: backlog
Objective: Close the remaining trust gap from the latest dancegame follow-up on `/Users/alex/Projects/roblox/dancegame-agent-2` at commit `4155a0f2ea68832368edd763d5dfa9d98afed544` by making concise subsystem summaries architecturally representative and by separating high change-risk seams from locally overloaded refactor targets in `impact`. Success is a preserved field-compatible before-versus-after benchmark showing that `summary --subsystems` surfaces review-grade owners and hotspots, `impact` distinguishes central seam risk from local structural pressure through stable machine-readable output, and the already-fixed freshness, obvious-name resolution, query relevance, summary size, and clean-tree `detect-changes` behavior remain intact after the changes. This epic is governed by an iron-clad universalism rule: product behavior must remain fully general-purpose, and it is better to leave a game-dev complaint unresolved than to satisfy it with repo-specific logic.
In scope: reproduce the latest dancegame follow-up exactly on `/Users/alex/Projects/roblox/dancegame-agent-2` after checking out commit `4155a0f2ea68832368edd763d5dfa9d98afed544` and restarting the repo-local service; preserve that run as the acceptance baseline and benchmark anchor; lock the exact follow-up command corpus and reuse the same benchmark matrix unchanged at closeout; improve concise subsystem summary selection so `top_owners`, `top_hotspots`, and subsystem hotspot naming prefer architecturally representative services, controllers, orchestrators, facades, and runtime owners over helper-level or incidental cross-subsystem symbols; improve `impact` so central stable seams such as `Paths` can read as high change risk without being implicitly presented as high local refactor pressure; preserve freshness consistency across commands; preserve obvious-name symbol resolution for `SweepController` and `OrchestratorPlaybackRuntime`; preserve concise summary size, including keeping the first-screen output in the same compact class rather than regressing toward a dump; preserve plain-language query relevance for `client ui shell --owners`; preserve clean-tree `detect-changes`; install the candidate build and rerun the exact follow-up corpus as the governing post-work benchmark before closeout.
Out of scope: transport or runtime redesign; a new retrieval engine or embeddings layer; repo-specific alias maps, path weighting, naming maps, prompt hacks, symbol boosts, helper blacklists, or any other dancegame-specific heuristic; widening `summary --subsystems` back into a detailed dump; reworking unrelated symbol-resolution logic beyond regression protection; inventing architecture labels unsupported by indexed facts; compatibility shims or silent fallbacks that mask ambiguity.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); current summary and impact surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts); regression-protection surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/detect-changes.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/detect-changes.ts); prior dancegame benchmark evidence in [/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/done/16-dancegame-trustworthiness-and-summary-quality.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/done/16-dancegame-trustworthiness-and-summary-quality.md) and [/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/doing/17-dancegame-symbol-resolution-and-subsystem-classification.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/epics/doing/17-dancegame-symbol-resolution-and-subsystem-classification.md); `/Users/alex/Projects/roblox/dancegame-agent-2` remaining on commit `4155a0f2ea68832368edd763d5dfa9d98afed544` throughout baseline and closeout measurement; the exact follow-up command corpus remaining the canonical acceptance and benchmark surface with no prompt rewrites or substitutes, specifically the checkout/restart/status sequence plus `summary --subsystems`, `impact Paths --direction upstream`, `query "client ui shell" --owners`, `impact SweepController --direction upstream`, `impact OrchestratorPlaybackRuntime --direction upstream`, and clean-tree `detect-changes`.
Risks: representativeness work may drift into dancegame-specific symbol boosting instead of general product behavior; concise subsystem output may improve one row by misclassifying another if ranking and placement widen carelessly; efforts to suppress helper-level labels may hide real subsystem anchors instead of surfacing better ones; `impact` may gain new wording without actually separating change risk from refactor pressure in stable machine-readable form; preserving fixed surfaces may regress silently if summary and impact work reuse stale metadata or ranking paths incorrectly; the benchmark may become invalid if the repo is not pinned to the target commit or if the repo-local service is not restarted after installing the candidate build; acceptance may fall back to prose-only interpretation unless the same baseline matrix is updated field-for-field at closeout; pressure to satisfy the report may tempt helper-name suppression or owner weighting tuned specifically to dancegame symbols instead of universal scoring; summary quality work may quietly bloat the concise output again unless first-screen size remains an explicit acceptance field; implementation pressure may tempt a bespoke shortcut that makes the benchmark pass while violating the product’s universalist design rule.
Rollback strategy: if architecturally representative selection cannot be improved generally, prefer omitting weak owner and hotspot labels over adding repo-specific heuristics; if helper suppression removes too much signal, revert only the representativeness weighting and keep concise size intact; if change-risk and refactor-pressure separation cannot be expressed truthfully from current indexed facts in stable machine-readable form, keep the smaller truthful distinction and leave the complaint open rather than invent a synthetic score; if freshness, symbol resolution, query relevance, or `detect-changes` regress, revert only the offending change and preserve the already-fixed surfaces; if installed-build benchmark results diverge from source-tree validation or the service was not restarted after install, treat the installed-build evidence as authoritative and keep the epic open; if the exact command corpus or matrix fields drift between baseline and closeout, treat the benchmark as invalid and keep the epic open; if the only path to satisfying the report is a repo-specific heuristic or any other bespoke shortcut, stop, reject that approach, and keep the complaint open.

### [x] 101 Capture The Pinned Dancegame Baseline

Surface: `/Users/alex/Projects/roblox/dancegame-agent-2`; globally installed `codenexus`; epic-local evidence
Work: Check out commit `4155a0f2ea68832368edd763d5dfa9d98afed544` in `/Users/alex/Projects/roblox/dancegame-agent-2`, restart the repo-local service, and reproduce the exact follow-up corpus as the before-state benchmark anchor. Record the dancegame commit, `which codenexus`, `codenexus --version`, `codenexus manage status`, the first screen of `summary --subsystems`, the subsystem-line count, the exact `Paths` impact output, the `client ui shell --owners` first screen, the `SweepController` and `OrchestratorPlaybackRuntime` impact results, and clean-tree `detect-changes`. Preserve a complaint matrix with stable fields for: first-screen subsystem rows; `top_owners`, `top_hotspots`, and `top_lifecycle_chokepoints` for the flagged rows; whether the reported problem examples `State`, `Centering`, and `Bot Sweep Adapter` appear in the first-screen representative slots; the current top-line `risk` plus the machine-readable risk/refactor split for `Paths`; freshness identity; summary line count; symbol-resolution results; query-leading results; and clean-tree `detect-changes` output fields.
Tests: real product baseline run on `/Users/alex/Projects/roblox/dancegame-agent-2` after `git fetch origin`, `git checkout 4155a0f2ea68832368edd763d5dfa9d98afed544`, `codenexus manage restart`, and `codenexus manage status`; preserved outputs for `codenexus summary --subsystems | sed -n '1,220p'`, `codenexus summary --subsystems | wc -l`, `codenexus impact Paths --direction upstream`, `codenexus query "client ui shell" --owners | sed -n '1,120p'`, `codenexus impact SweepController --direction upstream`, `codenexus impact OrchestratorPlaybackRuntime --direction upstream`, and `codenexus detect-changes`; explicit verification that the same field names and command list are reused unchanged at closeout
Docs: None

### [x] 102 Make Concise Subsystem Summaries Architecturally Representative

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/summary.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts)
Work: Improve concise subsystem summary selection so `top_owners`, `top_hotspots`, and subsystem hotspot naming prefer architecturally representative anchors such as services, controllers, orchestrators, facades, and runtime owners. De-prioritize generic helper labels such as `State`, narrow leaf helpers such as `Centering`, and incidental cross-subsystem adapters such as `Bot Sweep Adapter` unless indexed facts show they are truly the dominant seam. Keep the output compact and truthful: if the indexed facts are weak, omit a weak owner or hotspot instead of forcing a misleading one. Do not introduce dancegame-specific symbol weighting, hardcoded labels, path rules, helper blacklists, or any other repo-specific heuristic. This unit is not complete if it merely hides noisy helpers while still surfacing non-representative owners; the first-screen rows must become more architecturally representative, not just shorter. On the pinned dancegame corpus, the first-screen representative slots must stop reproducing the specific reported failures unless the indexed facts still genuinely force them. If that bar cannot be met generally, leave the complaint open.
Tests: targeted unit and integration coverage in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts) and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/local-backend.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/local-backend.test.ts) proving concise rows prefer architecturally representative owners and hotspots while omitting weakly grounded helpers; negative coverage that process-like labels and generic helper names are omitted rather than reassigned; baseline-versus-after rerun of `codenexus summary --subsystems | sed -n '1,220p'` on the pinned dancegame repo; explicit comparison that the reported `State`, `Centering`, and `Bot Sweep Adapter` examples are no longer occupying first-screen representative slots unless the benchmark matrix records a justified retained case
Docs: [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md)

### [x] 190 Milestone 100 Closeout

Surface: concise subsystem summary evidence; dancegame benchmark matrix
Work: Prove the concise subsystem summary is still compact while the semantic quality of `top_owners`, `top_hotspots`, and hotspot naming is materially better on the pinned dancegame corpus. Closeout is complete only when the updated matrix shows review-grade subsystem anchors, no longer requires explanatory prose for clearly generic helper labels in the first screen, and preserves concise output size in the same compact range as the baseline.
Tests: before-versus-after comparison against `101` for summary line count, top subsystem rows, `top_owners`, `top_hotspots`, hotspot names, and the presence or absence of the reported bad examples; `npm test --prefix gitnexus`
Docs: None

### [x] 201 Separate Change Risk From Local Refactor Pressure

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/impact.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/tools.ts)
Work: Refine `impact` so the output explicitly distinguishes a central stable seam from a locally overloaded structural offender. Keep the current risk dimensions, but expose a stronger user-facing split between change risk and refactor pressure through stable machine-readable fields and a matching top-line summary. A facade like `Paths` must be able to read as high change risk and low-to-medium local refactor pressure without forcing the user to infer that split from raw shape details. The distinction must be fully general-purpose and driven by current indexed facts and existing shape signals, not by repo-specific exceptions or dancegame-specific scoring logic. This unit is not complete if the split exists only as prose or wording around the existing `risk` label, or if the new fields still leave `Paths` materially ambiguous in the benchmark output. If the benchmark only improves under bespoke scoring, reject that approach and leave the complaint open.
Tests: targeted unit coverage in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts) for facade-like symbols versus locally overloaded files; acceptance rerun of `codenexus impact Paths --direction upstream` on the pinned dancegame repo; validation that overload-heavy symbols still show strong local structural pressure when warranted; exact comparison of the new machine-readable risk/refactor fields between baseline and closeout; explicit benchmark check that `Paths` reads as a central seam with materially lower local structural pressure than a true overloaded offender
Docs: [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md)

### [x] 202 Lock Regression Protection For Fixed Surfaces

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/mcp/local/local-backend.ts); [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/detect-changes.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/detect-changes.ts)
Work: Add or tighten regression coverage so the already-fixed surfaces stay fixed while summary and impact behavior changes. Protect freshness consistency, obvious-name symbol resolution, concise summary size, `client ui shell --owners` relevance, and clean-tree `detect-changes` behavior. The goal is not new product scope; it is preventing this narrower representativeness work from reopening trust regressions elsewhere. This unit is not complete unless clean-tree `detect-changes` still returns the same no-changes shape and message on the pinned repo state.
Tests: regression coverage in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/repo-manager.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/repo-manager.test.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/status-command.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/status-command.test.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/calltool-dispatch.test.ts), and existing integration coverage for `detect-changes`; acceptance rerun of the preserved fixed-surface commands from `101`, including exact verification that clean-tree `detect-changes` still reports `changed_count = 0`, `affected_count = 0`, `risk_level = "none"`, and `message = "No changes detected."`
Docs: None

### [x] 290 Milestone 200 Closeout

Surface: impact output; preserved fixed-surface benchmark matrix
Work: Prove that `impact` now distinguishes central seam risk from local refactor pressure more explicitly, while the fixed freshness, symbol-resolution, query-relevance, summary-size, and clean-tree `detect-changes` surfaces remain intact. Closeout is complete only when the `Paths` benchmark is materially clearer and the protected matrix fields remain green.
Tests: before-versus-after comparison against `101` for `impact Paths --direction upstream` plus all protected-surface benchmark fields; `npm run test:integration --prefix gitnexus`
Docs: None

### [x] 301 Install The Candidate Build And Rerun The Pinned Dancegame Corpus

Surface: `/Users/alex/Projects/roblox/dancegame-agent-2`; globally installed `codenexus`; epic-local evidence
Work: Build the working checkout, install it globally, restart the repo-local service for `/Users/alex/Projects/roblox/dancegame-agent-2`, and rerun the exact pinned follow-up corpus from `101` on commit `4155a0f2ea68832368edd763d5dfa9d98afed544`. This is the governing post-work benchmark, not an optional smoke test. Record the installed `codenexus` path, version, source checkout path, repo commit, service restart, and the same complaint matrix updated field-for-field. If installed-build behavior differs from source-tree spot checks, the installed build controls the verdict. This unit is not complete if the rerun updates a narrative summary instead of the same field-compatible matrix captured in `101`, or if the reported build identity is not explicitly tied to the working checkout that produced the install.
Tests: real product acceptance run after `npm run build --prefix gitnexus`, `npm link --prefix gitnexus`, `which codenexus`, `codenexus --version`, and `codenexus manage restart`; explicit verification that the benchmark rerun uses the same command corpus, same pinned repo commit, same matrix field names as `101`, and the installed binary path/source checkout path expected for the candidate build
Docs: None

### [x] 390 Milestone 300 Closeout

Surface: installed-build benchmark evidence; dancegame trust verdict
Work: Prove the installed build closes the remaining report gap on the pinned dancegame repo. Closeout is complete only when subsystem summaries are architecturally representative enough for direct review use, `impact` distinguishes central seam risk from local structural pressure clearly through stable fields, and the fixed surfaces remain preserved on the same corpus. The installed-build benchmark, not source-tree spot checks, governs the milestone verdict.
Tests: installed-build before-versus-after benchmark comparison against `101`; `npm test --prefix gitnexus`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`
Docs: None

### [x] 490 Epic Closeout

Surface: concise subsystem summary quality; impact output semantics; preserved fixed surfaces; installed-build benchmark evidence
Work: Epic closeout is complete only when the pinned dancegame follow-up no longer supports the claim that subsystem summaries require manual reinterpretation for architectural conversations or that central stable seams are still too easily conflated with locally overloaded refactor targets. The final record must show architecturally representative concise subsystem owners and hotspots, a clearer split between change risk and refactor pressure, preserved freshness consistency, preserved obvious-name resolution, preserved query relevance, preserved summary size, preserved clean-tree `detect-changes`, and installed-build benchmark evidence on the same pinned repo commit. The epic is not complete if the improvements depend on dancegame-specific symbol boosting, helper-name blacklists tuned to this repo, hardcoded subsystem placements, or any other bespoke shortcut. The epic is also not complete if the closeout case still relies on prose to explain away generic helper labels, weak owner choice, or an unclear `Paths` risk/refactor interpretation. The universalist rule is absolute: if a general solution does not clear the report’s bar, the correct outcome is to leave the complaint open, not to bend the product toward repo-specific behavior.
Tests: `npm test --prefix gitnexus`; `npm run test:integration --prefix gitnexus`; `npm run build --prefix gitnexus`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`; real acceptance rerun through the installed `codenexus` on `/Users/alex/Projects/roblox/dancegame-agent-2`; explicit field-compatible before-versus-after benchmark comparison against `101`
Docs: None

## Benchmark Evidence

### Baseline

- repo: `/Users/alex/Projects/roblox/dancegame-agent-2`
- pinned commit: `4155a0f2ea68832368edd763d5dfa9d98afed544`
- service action: `codenexus manage restart`
- freshness:
  - `manage status`: `serving_stale`
  - indexed commit: `4155a0f2ea68832368edd763d5dfa9d98afed544`
  - current commit: `4155a0f2ea68832368edd763d5dfa9d98afed544`
- summary size:
  - `codenexus summary --subsystems | wc -l`: `143`
- first-screen representative slots:
  - `State` present in first-screen hotspot slots: `yes`
  - `Centering` present in first-screen owner slots: `yes`
  - `Bot Sweep Adapter` present in first-screen representative slots: `no`
- flagged subsystem rows:
  - `Spotlight`
    - `top_owners`: `Cage`, `Centering`
    - `top_hotspots`: `State`
    - `top_lifecycle_chokepoints`: `Run → GetPivot`
  - `Bot`
    - `top_owners`: `Audio Controller`, `Bot Dance Controller`
    - `top_hotspots`: `Bot Math`
    - `top_lifecycle_chokepoints`: `Update → New`
- `Paths` interpretation:
  - top-line `risk`: `CRITICAL`
  - explicit change-risk vs refactor-pressure split: `absent`
  - shape still required manual interpretation to see that the file was tiny (`28` lines, `4` functions)
- protected surfaces:
  - `query "client ui shell" --owners`: UI-led
  - `impact SweepController --direction upstream`: resolved
  - `impact OrchestratorPlaybackRuntime --direction upstream`: resolved
  - `detect-changes` on clean repo:
    - `changed_count`: `0`
    - `affected_count`: `0`
    - `risk_level`: `none`
    - `message`: `No changes detected.`

### Closeout

- source checkout: `/Users/alex/Projects/GitNexusFork-agent-1`
- installed binary path: `/opt/homebrew/bin/codenexus`
- installed binary realpath: `/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/dist/cli/index.js`
- installed version: `1.3.10`
- repo: `/Users/alex/Projects/roblox/dancegame-agent-2`
- pinned commit: `4155a0f2ea68832368edd763d5dfa9d98afed544`
- service action: `codenexus manage restart`
- freshness:
  - `manage status`: `serving_current`
  - indexed commit: `4155a0f2ea68832368edd763d5dfa9d98afed544`
  - current commit: `4155a0f2ea68832368edd763d5dfa9d98afed544`
- summary size:
  - `codenexus summary --subsystems | wc -l`: `145`
- first-screen representative slots:
  - `State` present in first-screen hotspot slots: `no`
  - `Centering` present in first-screen owner slots: `no`
  - `Bot Sweep Adapter` present in first-screen representative slots: `no`
- first-screen subsystem rows:
  - `Spotlight`
    - `top_owners`: `Safe Tile Controller`
    - `top_hotspots`: none emitted
    - `top_lifecycle_chokepoints`: `Run → GetPivot`
  - `Bot`
    - `top_owners`: `Bot Service Runtime`, `Bot Dance Controller`
    - `top_hotspots`: `Bot Registry`, `Bot Math`
    - `top_lifecycle_chokepoints`: `Update → New`
  - `Lighting`
    - `top_owners`: `Environment Lighting Service`, `Lighting Show Service Bindings`
    - `top_hotspots`: `Lighting Show Service Runtime`, `Lighting Controller`
  - `UI`
    - `top_owners`: `Device Profile`
    - `top_hotspots`: none emitted
    - `top_lifecycle_chokepoints`: `BuildUI → BindHistoryActions`
- `Paths` interpretation:
  - top-line `risk`: `CRITICAL`
  - `risk_split.summary_line`: `change risk: critical; local refactor pressure: low`
  - `risk_split.change_risk.level`: `critical`
  - `risk_split.refactor_pressure.level`: `low`
  - `risk_split.refactor_pressure.drivers`:
    - `file_size`: `low`
    - `function_surface`: `low`
    - `local_concentration`: `low`
    - `extraction_seams`: `low`
- overloaded-offender comparison:
  - `impact OrchestratorPlaybackRuntime --direction upstream`
    - `risk_split.summary_line`: `change risk: medium; local refactor pressure: high`
    - `refactor_pressure.level`: `high`
- protected surfaces:
  - `query "client ui shell" --owners`: UI-led
  - `impact SweepController --direction upstream`: resolved
  - `impact OrchestratorPlaybackRuntime --direction upstream`: resolved
  - `detect-changes` on clean repo:
    - `changed_count`: `0`
    - `affected_count`: `0`
    - `risk_level`: `none`
    - `message`: `No changes detected.`

### Outcome

- The exact reported helper-level first-screen labels were removed from representative slots without adding repo-specific logic.
- `impact` now exposes a stable machine-readable split between change risk and local refactor pressure, and `Paths` reads as a central seam instead of an implied local structural offender.
- Freshness consistency, obvious-name resolution, summary compactness, query relevance, and clean-tree `detect-changes` all remained intact on the installed-build rerun.
