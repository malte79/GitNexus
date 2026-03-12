Title: Repo-Local HTTP Service

Assigned to: Agent 1
Lane: Runtime
Status: done
Objective: Turn `codenexus serve` from an honest placeholder into the real repo-local HTTP service for one repo, using `.codenexus` as the only runtime boundary and exposing the agent-facing service over HTTP with correct health, runtime metadata, and status integration.
In scope: implementing the real `codenexus serve` runtime; HTTP server startup and shutdown; port binding from `.codenexus/config.toml`; live health probing; runtime metadata creation and cleanup in `.codenexus/runtime.json`; duplicate-serve detection; stale-runtime recovery; single-repo binding with no repo routing; status integration against the live service; tests and docs for the real service lifecycle.
Out of scope: changing the CLI surface; changing the `.codenexus` state model beyond what the live service needs; branch-aware behavior; delta refresh; automatic indexing; Luau/Roblox/Rojo support; world projection; adding extra daemon-management commands beyond `serve`; preserving stdio as the primary runtime model.
Dependencies: `planning/master-intent.md`; `planning/archive/epics-todo.md`; `docs/policy.md`; `docs/cli/commands.md`; `docs/architecture/mcp-http-runtime.md`; `docs/architecture/repo-state-model.md`; `docs/architecture/repo-local-implementation.md`; current retained runtime surfaces in `gitnexus/src/cli/serve.ts`, `gitnexus/src/server/mcp-http.ts`, `gitnexus/src/mcp/server.ts`, `gitnexus/src/mcp/local/local-backend.ts`, `gitnexus/src/storage/repo-manager.ts`, and `gitnexus/src/cli/status.ts`.
Risks: if Epic 05 preserves any stdio-first or multi-repo assumptions, the runtime model will stay muddled; if the service writes runtime metadata loosely, `status` and duplicate-serve detection will become unreliable; if the health check is too weak or does not prove repo identity, unrelated processes on the configured port could be mistaken for CodeNexus; if graceful shutdown and crash recovery rules stay implicit, `runtime.json` drift will become a chronic source of false state; if the epic tries to solve refresh or branch-awareness now, it will sprawl beyond the runtime-lifecycle problem it actually owns.
Rollback strategy: keep the runtime model single-repo and HTTP-only; if a startup or metadata behavior proves wrong, fix the live-service contract rather than reintroducing placeholder behavior; if a test or runtime path depends on old MCP assumptions, rewrite it to the repo-local HTTP model instead of preserving a split transport story; if a probe is not strong enough to prove service identity, tighten it to a service-specific health endpoint rather than falling back to raw port reachability.

### [x] 100 Lock The Real Service Lifecycle Contract

Surface: `gitnexus/src/cli/serve.ts`; `gitnexus/src/server/mcp-http.ts`; `gitnexus/src/storage/repo-manager.ts`; durable runtime docs under `docs/architecture/` and `docs/cli/`
Work: Lock the exact lifecycle that `codenexus serve` will implement in this epic. This unit must define startup preconditions, duplicate-serve behavior, port-conflict behavior, graceful shutdown expectations, crash-recovery expectations, health-check semantics, runtime metadata ownership, and the relationship between stale index state and service startup. It must also explicitly state that the runtime is HTTP-based and single-repo-bound, that live service identity must be proven by a service-specific HTTP health endpoint returning repo-bound facts, and that `serve` is now real rather than a placeholder. Done when the repo has one durable runtime contract that later implementation can follow mechanically.
Tests: Validate the lifecycle contract against the already-locked repo-state and CLI contracts, including missing config, invalid config, initialized-but-unindexed repos, indexed-current repos, indexed-stale repos, duplicate serve attempts, graceful shutdown, crash-recovery, and stale runtime metadata.
Docs: Update `docs/architecture/mcp-http-runtime.md`, `docs/cli/commands.md`, and `docs/architecture/repo-local-implementation.md` with the concrete Epic 05 service lifecycle.

### [x] 101 Implement Real `codenexus serve` Startup And HTTP Binding

Surface: `gitnexus/src/cli/serve.ts`; `gitnexus/src/server/mcp-http.ts`; `gitnexus/src/mcp/server.ts`; `gitnexus/src/mcp/local/local-backend.ts`
Work: Implement `codenexus serve` so it starts a real repo-local HTTP service bound to the current repo boundary and the configured port from `.codenexus/config.toml`. This unit must remove the placeholder failure behavior, start exactly one HTTP runtime for the resolved repo, expose a service-specific health endpoint, and ensure the served backend is the already-single-repo engine from Epic 03. It must not reintroduce any repo-selection or shared-control-plane behavior. Done when `codenexus serve` actually starts the local service and keeps it running for the current repo only.
Tests: Add or update runtime tests proving successful startup on a valid initialized repo, refusal on missing/invalid config, refusal on missing index, degraded startup on stale index, presence of the service-specific health endpoint, and absence of any multi-repo routing behavior.
Docs: Update `docs/cli/commands.md`, `docs/architecture/mcp-http-runtime.md`, and `docs/architecture/repo-local-implementation.md` to reflect the actual startup behavior.

### [x] 102 Implement Runtime Metadata, Health Probe, And Duplicate-Serve Detection

Surface: `gitnexus/src/storage/repo-manager.ts`; runtime metadata handling; service health endpoint or equivalent probe; `gitnexus/src/cli/status.ts`
Work: Make runtime metadata and live-service detection correct enough to support `status` and duplicate-serve behavior. This unit must write and update `.codenexus/runtime.json`, provide a real live probe that distinguishes the CodeNexus service from an unrelated process on the same port by validating service-specific repo-bound facts, recover from stale runtime metadata, and fail duplicate same-repo serve attempts clearly while reporting the existing live service details. Runtime metadata must remain advisory, but live health must become the authoritative signal. Done when the repo has a trustworthy live-service signal and duplicate-serve / stale-runtime cases are handled deterministically.
Tests: Add coverage for live healthy service, stale runtime file with no service, mismatched runtime metadata, unrelated process on configured port, duplicate same-repo serve attempt, graceful shutdown cleanup, and post-crash stale-metadata recovery.
Docs: Update `docs/architecture/repo-state-model.md`, `docs/architecture/mcp-http-runtime.md`, and `docs/cli/commands.md` with the implemented runtime metadata and health rules.

### [x] 103 Integrate `codenexus status` With The Live Service Model

Surface: `gitnexus/src/cli/status.ts`; `gitnexus/src/storage/repo-manager.ts`; status tests
Work: Integrate `codenexus status` with the live repo-local service so serving states are based on the real health probe and runtime contract from Epic 05 rather than placeholder or heuristic behavior. This unit must ensure `status` reports canonical serving states and detail flags correctly for live healthy service, live stale service, stale runtime metadata, and non-serving indexed repos. It must also keep `status` bounded and read-only. Done when `codenexus status` accurately reflects the real runtime state model for both on-disk and live-service conditions.
Tests: Add or update CLI/status tests for `serving_current`, `serving_stale`, `indexed_current`, `indexed_stale`, and `runtime_metadata_stale`, including live HTTP-service scenarios.
Docs: Update `docs/cli/commands.md` and `docs/architecture/repo-state-model.md` so the documented status behavior matches the implemented runtime.

### [x] 104 Remove Remaining Placeholder Or Transport-Leakage From The Serve Surface

Surface: `gitnexus/src/cli/serve.ts`; retained docs/comments/tests; any help text or runtime messages that still describe Epic 04 placeholder behavior or stdio-first MCP assumptions
Work: Remove the remaining placeholder language and transport leakage now that `serve` is real. This unit must eliminate stale “not implemented yet” messaging, rewrite any retained runtime text that still frames the system around the old MCP process model instead of the repo-local HTTP service, and keep the product surface centered on `codenexus serve` rather than internal transport vocabulary. Done when the runtime surface looks like the intended product, not like a partially renamed GitNexus transport wrapper.
Tests: Re-run docs and code search sweeps for stale placeholder serve text, flat `mcp` user-facing command references, and repo-discovery/runtime-leakage language in retained surfaces.
Docs: Update `docs/architecture/mcp-http-runtime.md`, `docs/cli/commands.md`, `docs/architecture/repo-local-product-shape.md`, and any affected governed docs to reflect the real service.

### [x] 190 Milestone 100 Closeout

Surface: `codenexus serve`; runtime metadata and health; status integration; durable docs; validation evidence
Work: Confirm the repo-local HTTP runtime is now real: `codenexus serve` starts the service for one repo, the runtime can identify its own live service reliably, duplicate-serve and stale-runtime cases are handled correctly, and `codenexus status` reflects the live service model. This closeout must also clearly separate what Epic 05 solved from later work on refresh, branch handling, and language support.
Tests: Run the selected docs, build, unit, integration, and packaged smoke checks for the final runtime tree and verify the installed `codenexus` package can execute the real serve/status flow in a temp repo.
Docs: Record closeout evidence in the epic and ensure the final runtime behavior is reflected in `docs/architecture/mcp-http-runtime.md`, `docs/architecture/repo-state-model.md`, `docs/cli/commands.md`, and `planning/master-intent.md`.

Closeout evidence table (required):

| Unit | Required evidence | Link / Note | Status |
|---|---|---|---|
| 100 | Real service lifecycle contract is locked | [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md), and [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md) now define startup, failure, duplicate-serve, stale-index, graceful shutdown, crash recovery, and service-identity health behavior for `codenexus serve`. | [x] |
| 101 | `codenexus serve` starts a real repo-local HTTP service | [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/serve.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/serve.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/service-runtime.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/server/service-runtime.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/service-runtime.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/integration/service-runtime.test.ts) show the command binds one repo-local HTTP runtime on the configured port. | [x] |
| 102 | Runtime metadata and health probing are trustworthy | [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts) and [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/repo-manager.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/repo-manager.test.ts) implement and cover `.codenexus/runtime.json`, service-identity health probing, stale-runtime recovery, graceful shutdown cleanup, and duplicate-serve behavior. | [x] |
| 103 | `codenexus status` reflects the live runtime model | [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts), [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/storage/repo-manager.ts), and the live-service tests now report serving and non-serving states against the real service, not placeholder heuristics. | [x] |
| 104 | Placeholder and transport-leakage messaging is removed | [/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/serve.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/serve.ts), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md), and [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md) no longer describe `serve` as “not implemented yet” or frame the user-facing runtime around stale transport wording. | [x] |
| 190 | Validation passed on the real runtime | `npm run lint:docs --prefix gitnexus`, `npm run check:docs-contracts --prefix gitnexus`, `npm run build --prefix gitnexus`, `npm test --prefix gitnexus`, `npm run test:integration --prefix gitnexus`, `npm run test:all --prefix gitnexus`, plus the packed-install smoke flow for `init -> index -> serve -> status -> duplicate serve -> shutdown cleanup` all passed. | [x] |

Blocker criteria (190 cannot close if any are true):

- `codenexus serve` still only fails with placeholder behavior.
- The runtime is not clearly single-repo-bound.
- Runtime health detection can confuse an unrelated process with CodeNexus or fail to prove repo identity.
- `status` still relies on placeholder heuristics instead of the implemented live-service contract.
- Duplicate same-repo serve attempts are not handled deterministically.
- Graceful shutdown or crash-recovery behavior for `runtime.json` is still implicit or untested.
- Placeholder or stdio-first transport language remains active in the user-facing serve surface.
- Docs, build, unit, integration, or packaged smoke validation fail on the resulting runtime.
