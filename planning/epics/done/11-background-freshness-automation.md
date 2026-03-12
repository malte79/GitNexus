Title: Background Freshness Automation
Assigned to: Agent 1
Lane: Runtime
Status: done
Objective: Add background freshness automation so a running CodeNexus service can keep itself reasonably fresh without requiring users to manually reindex after every branch switch or code change, while keeping manual `codenexus index` as the immediate override path.
In scope: periodic repo-change detection while the background service is running; configurable auto-index enable/disable and interval; default 5-minute cadence; serialized auto-index jobs; auto-index failure/backoff handling; status visibility for auto-index state; branch switches treated as normal repo-change triggers; docs and tests for the new behavior.
Out of scope: per-branch index storage; branch-specific index selection; file watching; delta indexing; auto-indexing for foreground `codenexus serve`; world projection; embeddings; transport redesign.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/planning/archive/epics-todo.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/archive/epics-todo.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-state-model.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); current lifecycle/runtime surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/service-runtime.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/service-runtime.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index-command.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index-command.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/info.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/info.ts).
Risks: if auto-index is too eager, it could thrash on dirty repos; if background indexing overlaps with itself, runtime stability will suffer; if status does not surface auto-index state clearly, users will not trust it; if branch changes are treated specially again, the epic will drift back toward per-branch index complexity; if auto-index runs on foreground `serve`, foreground debugging will become noisy and unpredictable; if change detection uses timestamps alone, it may reindex unnecessarily or miss the intended generation semantics already established in Epic 10.
Rollback strategy: keep auto-index owned by the background service only; if a trigger or interval policy proves too aggressive, make it more conservative rather than adding branch-specific machinery; if failures occur, back off and report them instead of retrying endlessly; if the first trigger model is noisy, narrow it to the same deterministic freshness inputs already used by repo-state evaluation rather than introducing new ad hoc heuristics.

### [x] 100 Lock The Background Freshness Automation Contract

Surface: durable docs under `docs/architecture/`; `docs/cli/commands.md`; `planning/master-intent.md`
Work: Lock the exact contract for automatic background freshness. This unit must define the config knobs, default behavior, what kinds of repo changes trigger auto-index, how branch switches are treated, and how manual `codenexus index` relates to auto-index. It must also explicitly state that auto-index belongs to background mode only, does not run during foreground `serve`, and uses the same deterministic freshness inputs already present in repo-state evaluation instead of path mtimes or file watching. Done when there is one durable contract for automatic freshness behavior.
Tests: Validate the contract against normal edit/reindex flow, branch switch, dirty worktree, background service disabled, and foreground `serve`.
Docs: Update `docs/architecture/mcp-http-runtime.md`, `docs/architecture/repo-state-model.md`, `docs/cli/commands.md`, and `planning/master-intent.md`.

### [x] 101 Add Configurable Auto-Index Settings

Surface: `gitnexus/src/storage/repo-manager.ts`; `.codenexus/config.toml`; config tests
Work: Add repo-local config fields for background freshness automation, including enable/disable and interval. Default the interval to 5 minutes. The config must be explicit, repo-local, and surfaced through status. Done when the background service has deterministic configuration for auto-index behavior.
Tests: Add config parsing/validation tests for default values, explicit disable, explicit interval override, and invalid values.
Docs: Update `docs/architecture/repo-state-model.md` and `docs/cli/commands.md` with the new config fields.

### [x] 102 Implement Serialized Background Change Detection And Auto-Index

Surface: `gitnexus/src/server/service-runtime.ts`; `gitnexus/src/cli/index-command.ts`; runtime tests
Work: Implement periodic repo-change detection owned by the background service. This unit must check whether the repo has diverged from the indexed state using the same deterministic inputs already used for freshness evaluation, trigger reindex when needed, and ensure only one auto-index job runs at a time. Branch switches should simply appear as repo divergence, not as a separate index-management mode. This unit must also make clear that a currently running manual `codenexus index` or live reload is respected and not raced by the background loop. Done when background `start` can keep a repo reasonably fresh on a timer without requiring manual intervention for the normal path.
Tests: Add runtime tests covering:

- no-op polling when nothing changed
- auto-index after working tree change
- auto-index after HEAD/branch change
- skipping when an index job is already running
- no auto-index activity during foreground `serve`
- no duplicate index trigger while live reload from a prior index is still in flight

Docs: Update `docs/architecture/mcp-http-runtime.md` and `docs/architecture/repo-local-implementation.md` with the implemented background indexing behavior.

### [x] 103 Add Failure Handling, Backoff, And Operator Visibility

Surface: `gitnexus/src/server/service-runtime.ts`; `gitnexus/src/cli/status.ts`; runtime/status tests
Work: Make auto-index safe and observable. This unit must add failure tracking, simple backoff after repeated failures, and clear status output showing whether auto-index is enabled, the interval, last attempt, last success, and last failure if any. It must also define whether auto-index pauses temporarily after repeated failures and when it resumes automatically. Done when operators can tell whether background freshness automation is healthy and not silently thrashing or broken.
Tests: Add tests for repeated auto-index failure, backoff behavior, recovery after success, pause/resume-after-success semantics if implemented, and status visibility of auto-index state.
Docs: Update `docs/cli/commands.md`, `docs/architecture/repo-state-model.md`, and `docs/architecture/mcp-http-runtime.md` to reflect failure/backoff/operator visibility.

### [x] 104 Align User-Facing Guidance With The New Freshness Model

Surface: `gitnexus/src/cli/info.ts`; `gitnexus/src/cli/status.ts`; governed docs
Work: Update user-facing guidance so it reflects the new reality: most background-service users should not need to think about branch switches or ordinary code changes as much, because the service will auto-index on its interval, while manual `codenexus index` remains the immediate path when certainty is needed. Done when the product gives a coherent operator story for manual versus automatic freshness.
Tests: Add or update command-output tests for `info` and `status` to ensure the new guidance is explicit and not contradictory.
Docs: Update `docs/cli/commands.md`, `planning/master-intent.md`, and any affected architecture docs.

### [x] 190 Milestone 100 Closeout

Surface: auto-index config; background runtime; status/operator messaging; durable docs; validation evidence
Work: Confirm CodeNexus now supports practical background freshness automation. This closeout must prove that the background service can detect repo changes, reindex on a configurable interval, safely serialize index jobs, report failures/backoff, and reduce the need for users to manually reindex after ordinary branch switches or code changes. It must also clearly separate what Epic 11 solved from later work on smarter delta indexing and other deferred upgrades.
Tests: Run the selected docs, build, unit, integration, and packaged smoke checks for the final background freshness model.
Docs: Record closeout evidence in the epic and ensure the final behavior is reflected in `docs/architecture/mcp-http-runtime.md`, `docs/architecture/repo-state-model.md`, `docs/cli/commands.md`, and `planning/master-intent.md`.

Closeout evidence table (required):

| Unit | Required evidence | Link / Note | Status |
|---|---|---|---|
| 100 | Background freshness automation contract is locked | Durable docs define auto-index scope, triggers, interval, and relation to manual `index`. | [x] |
| 101 | Auto-index config exists and is validated | `.codenexus/config.toml` supports enable/disable and interval with correct defaults. | [x] |
| 102 | Background service performs serialized auto-index | Runtime code and tests show repo changes trigger reindex safely without overlap. | [x] |
| 103 | Failure/backoff and status visibility are implemented | Operators can see auto-index state and failures; repeated failures do not thrash. | [x] |
| 104 | User-facing guidance matches the new model | `info`, `status`, and docs explain when auto-index helps and when manual `index` is still preferred. | [x] |
| 190 | Validation passed on the final background freshness model | `npm test --prefix gitnexus`; `npx vitest run test/integration/local-backend.test.ts --pool=vmForks`; `npx vitest run test/integration/service-runtime.test.ts --pool=threads`; `npm run lint:docs --prefix gitnexus`; `npm run check:docs-contracts --prefix gitnexus`; `npm run build --prefix gitnexus`; bounded product smoke on a temp repo with 1s interval all passed on 2026-03-11. | [x] |

Blocker criteria (190 cannot close if any are true):

- Auto-index is not configurable.
- Background indexing can overlap with itself or race a manual index/reload path.
- Branch switches still require special-case index machinery instead of being treated as normal repo changes.
- Foreground `serve` also triggers background auto-index behavior.
- Auto-index uses timestamp-only or otherwise ad hoc detection instead of the established repo freshness signals.
- Repeated auto-index failures can thrash without backoff.
- Status/info/docs give conflicting guidance about manual versus automatic freshness.
- Docs, build, unit, integration, or product-smoke validation fail on the resulting behavior.
