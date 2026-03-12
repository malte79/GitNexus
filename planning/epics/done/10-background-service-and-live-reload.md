Title: Background Service And Live Reload

Assigned to: Agent 1
Lane: Runtime
Status: done
Objective: Add real background service lifecycle commands and automatic live index adoption so CodeNexus can run as a daemonized repo-local service and pick up rebuilt indexes without requiring manual restart.
In scope: `codenexus start`, `codenexus stop`, and `codenexus restart`; detached/background service startup; PID/runtime lifecycle management; graceful shutdown; service status integration; automatic detection of rebuilt on-disk indexes; safe backend hot-reload to the newest index generation; tests, docs, and packaged smoke validation for the new service lifecycle.
Out of scope: branch-aware index switching; delta indexing; file watching beyond what is needed to detect rebuilt on-disk index state; world projection; embeddings; transport redesign; multi-repo service management; OS-specific service managers like launchd/systemd integration.
Dependencies: `planning/master-intent.md`; `planning/archive/epics-todo.md`; `docs/architecture/mcp-http-runtime.md`; `docs/architecture/repo-state-model.md`; `docs/architecture/repo-local-implementation.md`; current runtime surfaces in `gitnexus/src/cli/serve.ts`, `gitnexus/src/cli/status.ts`, `gitnexus/src/server/service-runtime.ts`, `gitnexus/src/server/mcp-http.ts`, and `gitnexus/src/storage/repo-manager.ts`
Risks: if daemonization is bolted onto `serve` sloppily, foreground and background lifecycle behavior will diverge; if detached startup uses a different runtime path than foreground `serve`, later fixes will split across two service implementations; if live index adoption is not atomic and serialized, overlapping rebuild/reload events could race and expose inconsistent backend state; if reload failure handling is weak, the service could end up serving no index or a partially swapped backend; if stale-runtime cleanup is not tightened, `start`/`stop` will become unreliable.
Rollback strategy: keep `serve` as the foreground/debug path and make `start` a lifecycle wrapper over the same runtime rather than a second service implementation; if hot-reload proves unstable, fall back to serving the previous loaded index while clearly reporting reload failure rather than serving half-swapped state; if background lifecycle control is flaky, prefer explicit failure over hidden retries or force-kill behavior.

### [x] 100 Lock The Background Service And Live-Reload Contract

Surface: durable docs under `docs/architecture/`; `docs/cli/commands.md`; `planning/master-intent.md`
Work: Lock the exact contract for daemonized service management and live index adoption. This unit must define what `codenexus serve`, `codenexus start`, `codenexus stop`, and `codenexus restart` each mean; what detached mode owns; how runtime metadata and PID tracking behave; and what “automatic pickup of a rebuilt index” means without implying unsafe in-place mutation. It must explicitly require that foreground and detached mode share the same underlying runtime implementation, define the single loaded-index identity/generation signal used by health and reload checks, define reload serialization rules, and state whether background mode is per-repo only. Done when the repo has one durable service-lifecycle contract for foreground mode, detached mode, and live reload.
Tests: Validate the contract against successful background start, duplicate start, stop with no live service, restart behavior, graceful shutdown, index rebuild while service is live, and reload failure cases.
Docs: Update `docs/architecture/mcp-http-runtime.md`, `docs/architecture/repo-state-model.md`, `docs/cli/commands.md`, and `planning/master-intent.md` with the concrete lifecycle contract.

### [x] 101 Add Detached Service Lifecycle Commands

Surface: CLI command surface under `gitnexus/src/cli/`; runtime lifecycle code under `gitnexus/src/server/`; runtime metadata in `.codenexus/runtime.json`
Work: Implement `codenexus start`, `codenexus stop`, and `codenexus restart` as the daemonized service lifecycle commands. This unit must make `codenexus serve` remain the foreground/debug path, while `start` launches the same repo-local service runtime in detached mode, `stop` shuts it down deterministically, and `restart` performs a stop/start cycle. Detached mode must remain repo-local and must not require global service management or introduce a second service codepath. Done when the product supports a stable background lifecycle without overloading `serve` semantics.
Tests: Add or update CLI/runtime tests for detached start, duplicate start refusal, stop on a live service, stop on stale runtime metadata, and restart behavior.
Docs: Update `docs/cli/commands.md` and `docs/architecture/mcp-http-runtime.md` with the implemented daemon lifecycle.

### [x] 102 Strengthen Runtime Metadata And Process Control

Surface: `gitnexus/src/storage/repo-manager.ts`; `gitnexus/src/server/service-runtime.ts`; status/runtime tests
Work: Tighten runtime metadata so detached lifecycle control is trustworthy. This unit must ensure `.codenexus/runtime.json` carries the right PID/process identity, that stale metadata is detected and cleaned up correctly, and that `stop`/`restart` can distinguish a real CodeNexus process from an unrelated process. It must preserve the rule that live service identity is authoritative and runtime metadata is advisory. Done when background lifecycle control is deterministic and stale runtime state is handled cleanly.
Tests: Add coverage for stale runtime metadata, dead PID, unrelated PID/port mismatch, graceful shutdown cleanup, and forceful stale-state recovery logic.
Docs: Update `docs/architecture/repo-state-model.md` and `docs/architecture/mcp-http-runtime.md` to reflect the final runtime metadata/process-control behavior.

### [x] 103 Implement Safe Live Index Adoption

Surface: `gitnexus/src/server/service-runtime.ts`; `gitnexus/src/mcp/local/local-backend.ts`; `gitnexus/src/storage/repo-manager.ts`; health/runtime docs and tests
Work: Implement automatic adoption of rebuilt on-disk indexes by the running service. This unit must detect that the on-disk index generation changed, create a fresh backend against the new index, and atomically swap the live service to that backend only after the replacement is ready. It must use one deterministic loaded-index identity or generation signal shared across `.codenexus/meta.json`, `.codenexus/runtime.json`, and the health endpoint; it must serialize reload attempts so overlapping rebuilds cannot race; it must not require manual restart for the normal successful path; and it must keep serving the previous loaded index if reload fails. Done when `codenexus index` on a live repo can cause the service to adopt the new index automatically and safely.

Tests: Add runtime tests for:

- live service adopts new index after rebuild
- in-flight requests stay valid during swap
- overlapping rebuild/reload events do not race into double-swap or broken state
- reload failure leaves old backend serving
- service health reflects the new loaded index after successful reload

Docs: Update `docs/architecture/mcp-http-runtime.md`, `docs/architecture/repo-state-model.md`, and `docs/cli/commands.md` so the automatic adoption contract is explicit.

### [x] 104 Update Status And Operator Messaging For The New Lifecycle

Surface: `gitnexus/src/cli/status.ts`; `gitnexus/src/cli/index-command.ts`; governed docs
Work: Update `status` and indexing/operator messaging so they tell the truth after daemonization and live reload. This unit must remove now-obsolete “restart after reindex” guidance for the normal successful path, report background/foreground service state clearly, and show when auto-reload succeeded or when the service is still on an older loaded index due to reload failure. Done when the user-facing story for `index`, `status`, `serve`, `start`, `stop`, and `restart` is coherent and current.
Tests: Add or update CLI tests for status output, index messaging while service is live, and restart-required behavior only when reload actually fails.
Docs: Update `docs/cli/commands.md`, `docs/architecture/repo-state-model.md`, `docs/architecture/mcp-http-runtime.md`, and any affected product docs to reflect the final operator story.

### [x] 190 Milestone 100 Closeout

Surface: detached lifecycle commands; runtime metadata/process control; live index adoption; status/operator messaging; durable docs; validation evidence
Work: Confirm CodeNexus now supports a real background lifecycle and automatic live adoption of rebuilt indexes. This closeout must prove that `start`/`stop`/`restart` work reliably, that the running service can adopt new indexes without manual restart in the normal path, and that failure modes remain explicit and safe. It must also clearly separate what this epic solved from later work on branch-aware indexing and deferred advanced capabilities.
Tests: Run the selected docs, build, unit, integration, and packaged smoke checks for the final service lifecycle.
Docs: Record closeout evidence in the epic and ensure the final lifecycle is reflected in `docs/architecture/mcp-http-runtime.md`, `docs/architecture/repo-state-model.md`, `docs/cli/commands.md`, and `planning/master-intent.md`.

Closeout evidence table (required):

| Unit | Required evidence | Link / Note | Status |
|---|---|---|---|
| 100 | Background lifecycle and live-reload contract is locked | `docs/architecture/mcp-http-runtime.md`, `docs/architecture/repo-state-model.md`, `docs/cli/commands.md`, and `planning/master-intent.md` now define `serve`, `start`, `stop`, `restart`, shared runtime implementation, deterministic loaded-index identity, and automatic live adoption. | [x] |
| 101 | Detached lifecycle commands work | `gitnexus/src/cli/start.ts`, `gitnexus/src/cli/stop.ts`, `gitnexus/src/cli/restart.ts`, and `gitnexus/src/server/service-runtime.ts` implement repo-local detached lifecycle control over the same runtime used by foreground `serve`; covered by `gitnexus/test/integration/service-runtime.test.ts` and CLI unit tests. | [x] |
| 102 | Runtime metadata and process control are trustworthy | `gitnexus/src/storage/repo-manager.ts` and `gitnexus/src/server/service-runtime.ts` now carry PID, mode, repo/worktree identity, loaded index identity, and reload error state; stale/foreign-service cases are covered in `gitnexus/test/unit/repo-manager.test.ts` and `gitnexus/test/integration/service-runtime.test.ts`. | [x] |
| 103 | Live index adoption is safe and real | `gitnexus/src/server/service-runtime.ts`, `gitnexus/src/mcp/local/local-backend.ts`, and `gitnexus/src/mcp/core/kuzu-adapter.ts` implement serialized backend reload with deterministic generation matching and safe fallback; validated in `gitnexus/test/integration/service-runtime.test.ts` and packaged smoke. | [x] |
| 104 | User-facing lifecycle messaging is coherent | `gitnexus/src/cli/status.ts`, `gitnexus/src/cli/index-command.ts`, `gitnexus/src/cli/info.ts`, and `docs/cli/commands.md` now reflect background lifecycle, automatic live adoption, and reload-failure fallback clearly. | [x] |
| 190 | Validation passed on the final lifecycle | `npm run build --prefix gitnexus`, `npm run test:integration --prefix gitnexus`, `npm run test:all --prefix gitnexus`, `npm run lint:docs --prefix gitnexus`, and `npm run check:docs-contracts --prefix gitnexus` all pass; packaged smoke proved detached start/stop, automatic live adoption, and cross-repo port conflict detection. | [x] |

Blocker criteria (190 cannot close if any are true):

- `start`/`stop`/`restart` do not work reliably on a repo-local service.
- `start` uses a different service implementation than foreground `serve`.
- The service still requires manual restart after successful reindex in the normal path.
- Live reload can leave the service in a partially swapped or unusable state.
- Live reload depends only on loose timestamp or mtime checks instead of one deterministic loaded-index identity signal.
- Overlapping rebuild/reload events can race into inconsistent service state.
- Runtime metadata/process control cannot distinguish stale state from a real live service.
- User-facing docs or status output still give conflicting guidance about restart requirements.
- Docs, build, unit, integration, or product-smoke validation fail on the resulting lifecycle.
