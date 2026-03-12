Title: Repo-Local State And Single-Repo Architecture
Assigned to: Agent 1
Lane: Architecture
Status: done
Objective: Replace the inherited global-registry and multi-repo control plane with a repo-local, single-repo architecture rooted in `.codenexus/`, while preserving the reduced headless core and the seams needed for the upcoming CLI reshape and repo-local MCP HTTP service epics.
In scope: repo-local state ownership under `.codenexus/`; replacement of the global registry model in storage and backend layers; conversion of the retained backend/query layer from multi-repo routing to one bound repo boundary; implementation of the v1 config, meta, Kuzu, and runtime file ownership model; repo-bound resolution rules for nearest git root, nested repos, and worktrees; minimal compatibility updates to retained `gitnexus` commands so the architecture is actually exercised; removal of multi-repo assumptions from retained package surfaces where they are architectural rather than transport-only.
Out of scope: introducing the `cn` CLI surface; implementing `cn init`; implementing the repo-local MCP HTTP service lifecycle itself; Luau or Roblox support; branch-aware index stores; automatic refresh or delta indexing; a full rename sweep from `gitnexus` to `codenexus`; compatibility shims that preserve the old global registry as a parallel runtime path.
Dependencies: `planning/master-intent.md`; `planning/archive/epics-todo.md`; `docs/policy.md`; `docs/architecture/product-and-runtime-boundary.md`; `docs/architecture/repo-state-model.md`; `docs/architecture/mcp-http-runtime.md`; `docs/architecture/core-surface-reduction.md`; retained seams in `gitnexus/src/storage/`, `gitnexus/src/mcp/`, `gitnexus/src/server/mcp-http.ts`, `gitnexus/src/cli/analyze.ts`, `gitnexus/src/cli/status.ts`, `gitnexus/src/cli/mcp.ts`, and the ingestion/graph/Kuzu core under `gitnexus/src/core/`.
Risks: if the repo-local state rewrite leaves any hidden dependency on the global registry, later CLI and HTTP service epics will inherit split-brain behavior; if `.codenexus` ownership is implemented loosely, repo boundary rules for nested repos and worktrees will remain ambiguous; if this epic tries to solve HTTP runtime lifecycle in full, it will overlap badly with Epic 05; if it preserves repo parameters, `list_repos`, repo-scoped discovery resources, or repo-named resource URIs “for now,” the architectural pivot will remain incomplete and later epics will pay for that indecision; if it spends effort preserving inherited `gitnexus` behavior during the cutover, it will slow the architectural pivot and leave more legacy assumptions in place than we want.
Rollback strategy: implement the new repo-local architecture as the only active path, not as a shadow path beside the registry model; if a cutover breaks retained commands, repair the repo-local path rather than resurrecting the global registry; if a state-file schema choice proves wrong, revise the `.codenexus` implementation and durable docs together rather than adding fallback readers for old formats; prefer explicit failure with a clear contract message over implicit bootstrap behavior or compatibility preservation; prefer deleting repo-discovery affordances now over carrying them into Epic 05.

### [x] 100 Lock The Implementation Architecture For Repo-Local Single-Repo Ownership

Surface: `gitnexus/src/storage/`; `gitnexus/src/mcp/local/`; retained CLI seams; durable architecture docs under `docs/architecture/`
Work: Produce the canonical implementation architecture for the repo-local single-repo pivot before changing production code. This unit must map the Epic 01 contracts onto the retained codebase after Epic 02, identify the exact modules that will own config, index metadata, Kuzu paths, runtime metadata, and repo-bound backend state, and explicitly state which old multi-repo surfaces are being removed rather than adapted. It must also lock the hard-cut migration posture: no global registry, no shared control plane, no parallel legacy state path. Done when the repo has one durable implementation plan for how `.codenexus` ownership and single-repo backend binding will actually replace the inherited registry architecture.
Tests: Validate the architecture against the Epic 01 contracts for nearest-git-root resolution, nested repo boundaries, worktrees as separate runtime boundaries, advisory runtime metadata, and repo-local `.codenexus` ownership. Confirm the plan preserves the seams needed for Epic 04 CLI reshape and Epic 05 HTTP service. Confirm the architecture explicitly chooses how retained `gitnexus` commands behave before `cn init` exists, and that the choice does not violate the locked command contract by silently creating config.
Docs: Create `docs/architecture/repo-local-implementation.md` with the implementation architecture and update `planning/master-intent.md` with a short sync note.

### [x] 101 Replace Global Registry Storage With Repo-Local State Ownership

Surface: `gitnexus/src/storage/repo-manager.ts`; `gitnexus/src/storage/git.ts`; `.codenexus` path ownership; metadata/config/runtime file readers and writers
Work: Replace the inherited global-registry storage model with repo-local `.codenexus` ownership. This unit must remove `~/.gitnexus/registry.json` and any active reliance on shared registry discovery, move the active on-disk state boundary from `.gitnexus/` to `.codenexus/`, implement repo-local path resolution for `.codenexus/config.toml`, `.codenexus/meta.json`, `.codenexus/kuzu/`, and `.codenexus/runtime.json`, and align the actual on-disk schemas with the Epic 01 contracts. It must also make nearest-git-root, nested-repo, and worktree handling explicit in the storage layer rather than leaving them to callers. Done when storage ownership is repo-local only, `.gitnexus/` is no longer an active runtime boundary, and no active code path needs a shared global registry to find or validate a repo index.
Tests: Add or update storage tests for repo-root resolution, nested repo precedence, worktree distinction, missing config, invalid config, missing meta, missing Kuzu files, stale advisory runtime metadata, and absence of active `.gitnexus/` state usage. Confirm no code path still reads or writes the old registry.
Docs: Update `docs/architecture/repo-state-model.md` and `docs/architecture/repo-local-implementation.md` with the concrete implemented storage ownership.

### [x] 102 Convert The Backend From Multi-Repo Routing To One Bound Repo Engine

Surface: `gitnexus/src/mcp/local/local-backend.ts`; retained MCP/server seams; backend tests
Work: Turn the retained backend into a repo-bound engine instead of a multi-repo router. This unit must remove lazy registry refresh and repo selection logic as the primary model, bind the backend to one resolved repo boundary, and ensure all query, context, impact, change-detection, and rename operations run against that one local index. It must also remove or hard-cut the active multi-repo affordances from the backend surface, including `list_repos`, repo selection routing, and any active dependence on `repo` parameters for correctness. Done when the backend’s core execution model is “one engine, one repo boundary, one `.codenexus` index,” even if the external CLI name still says `gitnexus`.
Tests: Update backend unit and integration tests so they prove bound-repo behavior, no registry dependency, correct handling of missing or stale local state, and absence of ambiguous multi-repo routing errors. Confirm `list_repos` is removed from the active backend contract and that `repo` parameters are no longer part of active routing semantics.
Docs: Update `docs/architecture/repo-local-implementation.md`, `docs/architecture/product-and-runtime-boundary.md`, and any affected CLI/runtime docs to reflect the bound-repo backend model.

### [x] 103 Rewire Retained Commands To Exercise The New Repo-Local Architecture

Surface: `gitnexus/src/cli/analyze.ts`; `gitnexus/src/cli/status.ts`; `gitnexus/src/cli/mcp.ts`; `gitnexus/src/cli/index.ts`; retained MCP resource/tool surfaces
Work: Rewire the currently retained `gitnexus` command seams so they run through the new repo-local architecture instead of the removed registry model. This unit is not the final CLI reshape, but it must make the architecture real and testable. `gitnexus analyze` should write repo-local state in the new format, `gitnexus status` should report against the canonical base states and detail flags, and `gitnexus mcp` should start only against the resolved local repo boundary instead of serving an arbitrary shared registry view. It must also hard-cut inherited command behavior where necessary: retained commands may fail clearly against missing config or missing repo-local state, and this is acceptable during the transition, but they must not silently bootstrap user-owned config or preserve the old registry model just for compatibility. Done when the retained commands are thin, consistent shims over the new repo-local state architecture rather than special cases holding onto the old system.
Tests: Run command-level tests for analyze/status/mcp against initialized, uninitialized, stale, invalid-config, and nested-repo/worktree scenarios. Confirm no retained command mutates outside `.codenexus`, no retained command depends on the old registry, no retained command silently creates `config.toml`, and explicit failure is the accepted behavior where the old `gitnexus` surface no longer matches the new contract.
Docs: Update `docs/cli/commands.md`, `docs/architecture/repo-state-model.md`, and `docs/architecture/repo-local-implementation.md` so the implemented behavior matches the locked contract.

### [x] 104 Remove Residual Multi-Repo Architecture Leakage From The Reduced Surface

Surface: retained MCP resources/tools/docs/comments/tests that still describe global multi-repo behavior
Work: Remove the architectural leakage left after Epic 02 from the retained headless core. This includes stale multi-repo comments, resource descriptions, tool definitions, resource URIs, and behavior that still present the system as a registry-backed multi-repo service. This unit should prefer deleting or rewriting the leakage now rather than leaving “temporary” compatibility language around. The resulting retained surface should clearly look like the pre-HTTP version of a repo-local CodeNexus core, not a trimmed GitNexus multi-repo platform. Done when the remaining code, tests, and governed docs describe one repo boundary as the active runtime unit and no active surface still depends on repo-discovery affordances such as `gitnexus://repos`, `list_repos`, or repo-name-targeted resource paths.
Tests: Re-run docs and code search sweeps for global-registry and multi-repo language in the retained governed surfaces and core package seams. Confirm remaining references are only intentional planning/history references, not active architecture claims, and confirm repo-discovery affordances and repo-name-targeted resource paths are gone from the active runtime surface.
Docs: Update `docs/architecture/core-surface-reduction.md`, `docs/architecture/repo-local-implementation.md`, and any affected governed docs to reflect the completed pivot.

### [x] 190 Milestone 100 Closeout

Surface: repo-local storage implementation; bound backend; retained commands; durable docs; validation evidence
Work: Confirm the architectural pivot is complete: `.codenexus` is the active state boundary, the global registry is gone from active behavior, the backend is bound to one repo boundary, and the retained commands exercise the repo-local model without reintroducing shared control-plane semantics. This closeout must explicitly state what remains for Epic 04 and Epic 05 so the next work starts from a clean architectural base instead of finishing half-done state work.
Tests: Run the selected docs, build, unit, and integration gates for the resulting tree and verify the repo-local path is the only active architecture.
Docs: Record closeout evidence in the epic and ensure the final implemented architecture is reflected in `docs/architecture/repo-local-implementation.md`, `docs/architecture/repo-state-model.md`, and `planning/master-intent.md`.

Closeout evidence table (required):

| Unit | Required evidence | Link / Note | Status |
|---|---|---|---|
| 100 | Durable implementation architecture exists | `docs/architecture/repo-local-implementation.md` created and linked from `planning/master-intent.md`. | [x] |
| 101 | Global registry is no longer an active storage dependency | `gitnexus/src/storage/repo-manager.ts` now owns only `.codenexus` state; `gitnexus/test/unit/repo-manager.test.ts` covers the repo-local storage contract. | [x] |
| 102 | Backend is bound to one repo boundary | `gitnexus/src/mcp/local/local-backend.ts`, `gitnexus/src/mcp/tools.ts`, and `gitnexus/test/unit/calltool-dispatch.test.ts` now enforce a bound single-repo runtime with no `list_repos` or repo routing. | [x] |
| 103 | Retained commands exercise the repo-local architecture | `gitnexus/src/cli/analyze.ts`, `gitnexus/src/cli/status.ts`, and `gitnexus/src/cli/mcp.ts` now require `.codenexus` state and fail explicitly without hidden bootstrap behavior. | [x] |
| 104 | Residual multi-repo leakage is removed from retained surfaces | `gitnexus/src/mcp/resources.ts`, `gitnexus/src/mcp/server.ts`, `docs/architecture/core-surface-reduction.md`, and the rewritten unit tests remove active repo-discovery affordances. | [x] |
| 190 | Validation passed on the repo-local architecture | `npm run lint:docs --prefix gitnexus`, `npm run check:docs-contracts --prefix gitnexus`, `npm run build --prefix gitnexus`, `npm test --prefix gitnexus`, and `npm run test:integration --prefix gitnexus` all passed. | [x] |

Blocker criteria (190 cannot close if any are true):

- Any active code path still depends on `~/.gitnexus/registry.json`.
- `.codenexus` is not the sole active repo-state boundary.
- `.gitnexus/` still functions as an active runtime boundary.
- The backend still fundamentally routes across multiple repos instead of binding to one repo boundary.
- `list_repos`, `gitnexus://repos`, repo-selection routing, or repo-name-targeted resource paths remain active runtime affordances.
- Retained commands still require the old registry model to function.
- Retained commands silently create or rewrite user-owned config outside the locked contract.
- The epic preserves inherited `gitnexus` behavior only for transition comfort rather than cutting to the new contract.
- Multi-repo behavior remains active in retained MCP/tool/resource surfaces without explicit justification as a temporary transport concern for Epic 05.
- The epic introduces a parallel compatibility path instead of completing the hard cut to repo-local ownership.
- Docs, build, unit, or integration validation fail on the resulting tree.
