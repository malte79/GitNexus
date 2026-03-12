Title: CLI Reshape
Assigned to: Agent 1
Lane: Product
Status: done
Objective: Turn the repo-local architecture from Epic 03 into the actual CodeNexus CLI product surface by introducing the `codenexus` executable, implementing `codenexus init`, aligning `codenexus index` and `codenexus status` to the locked contracts, and establishing the `codenexus serve` command shape that Epic 05 will complete.
In scope: adding `codenexus` as the canonical CLI entrypoint; removing user-facing `gitnexus` CLI naming entirely; implementing `codenexus init`; renaming or reshaping the retained indexing surface into `codenexus index`; aligning status output and behavior to the canonical repo-state model; defining the `codenexus serve` CLI surface and failure behavior before the HTTP lifecycle exists; package/bin/help text updates; docs and tests for the new CLI contract.
Out of scope: implementing the repo-local HTTP MCP lifecycle itself; owning `.codenexus/runtime.json` through a real HTTP service; Luau or Roblox support; branch-aware indexing; automatic refresh or delta indexing; full repo/package rename sweep beyond the CLI/product surface; preserving old `gitnexus` UX for compatibility.
Dependencies: `planning/master-intent.md`; `planning/archive/epics-todo.md`; `docs/policy.md`; `docs/cli/commands.md`; `docs/architecture/product-and-runtime-boundary.md`; `docs/architecture/repo-state-model.md`; `docs/architecture/mcp-http-runtime.md`; `docs/architecture/repo-local-implementation.md`; current CLI/package surfaces in `gitnexus/package.json`, `gitnexus/src/cli/index.ts`, `gitnexus/src/cli/index-command.ts`, `gitnexus/src/cli/status.ts`, `gitnexus/src/cli/init.ts`, and `gitnexus/src/cli/serve.ts`.
Risks: if Epic 04 reopens state-model or repo-boundary questions already settled in Epics 01 and 03, it will blur responsibilities and slow Epic 05; if `codenexus init` is underspecified or too clever, it may silently rewrite user config or reintroduce repo mutations outside `.codenexus`; if `gitnexus` is left as any active user-facing binary, the product surface will remain confusing; if `codenexus serve` pretends to be complete before Epic 05, the CLI will overpromise behavior the runtime does not yet provide.
Rollback strategy: keep Epic 04 focused on CLI surface and package/bin behavior only; if a command shape proves wrong, revise the CLI surface and docs together rather than layering aliases and compatibility branches; if any user-facing `gitnexus` path remains misleading, remove it rather than preserving compatibility.

### [x] 100 Lock The Canonical CLI Surface

Surface: `gitnexus/package.json`; `gitnexus/src/cli/index.ts`; durable CLI/product docs under `docs/cli/` and `docs/architecture/`
Work: Lock the exact CLI surface CodeNexus will present after Epic 04. This unit must define `codenexus` as the canonical executable, remove `gitnexus` as a user-facing CLI entirely, name the exact command tree to ship in this epic, and explicitly separate what Epic 04 owns from what Epic 05 still owns. It must also lock the failure posture for commands whose full runtime is not available yet, especially `codenexus serve`. Done when there is one durable description of the shipped CLI surface and no ambiguity about which executable name and commands are canonical.
Tests: Validate the planned CLI surface against the locked command contracts in `docs/cli/commands.md` and the implemented architecture from Epic 03. Confirm `codenexus init`, `codenexus index`, and `codenexus status` are fully owned here, while `codenexus serve` is introduced only to the extent consistent with Epic 05 ownership.
Docs: Update `docs/cli/commands.md` and create or update a durable CLI surface summary under `docs/architecture/` or `docs/cli/` that names `codenexus` as the only canonical executable and locks the command tree `codenexus init`, `codenexus index`, `codenexus status`, `codenexus serve`.

### [x] 101 Add The `codenexus` Executable And Canonical Command Tree

Surface: `gitnexus/package.json`; `gitnexus/src/cli/index.ts`; package metadata and help text
Work: Add `codenexus` as the canonical CLI entrypoint and shape the visible command tree around the CodeNexus product. This unit must update package bin metadata, help text, and command registration so the primary surface is `codenexus init`, `codenexus index`, `codenexus status`, and `codenexus serve`. `gitnexus` must no longer be shipped or presented as a user-facing binary. Done when installing or running the package exposes the correct CodeNexus command names and the CLI help output matches the product direction.
Tests: Add or update CLI tests to verify the canonical command tree, help output, and package bin wiring. Confirm users can invoke `codenexus` and that `gitnexus` is no longer a shipped or tested user-facing path.
Docs: Update `docs/cli/commands.md`, package description/help surfaces, and any governed docs that still present `gitnexus` as the primary CLI.

### [x] 102 Implement `codenexus init` And Repo Activation

Surface: new or updated CLI command module for `init`; `gitnexus/src/storage/repo-manager.ts`; `.codenexus/config.toml` ownership; command tests
Work: Implement `codenexus init` as the explicit repo activation command. This unit must create `.codenexus/` and `.codenexus/config.toml` when missing, obey the locked TOML config contract, remain idempotent, and refuse to silently rewrite existing valid config. It must also fail clearly for invalid existing config rather than guessing or repairing in place. Done when a repo can be activated cleanly and predictably without creating index or runtime state and without mutating files outside `.codenexus/`.
Tests: Add command and storage tests for first init, repeat init, invalid existing config, nested repo boundaries, worktree behavior, and no-mutation-outside-`.codenexus`. Confirm `codenexus init` does not create index or runtime files.
Docs: Update `docs/cli/commands.md`, `docs/architecture/repo-state-model.md`, and any relevant product docs so the implemented `codenexus init` behavior matches the locked contract.

### [x] 103 Align `codenexus index` And `codenexus status` With The Canonical Product Surface

Surface: `gitnexus/src/cli/index-command.ts`; `gitnexus/src/cli/status.ts`; `gitnexus/src/cli/index.ts`; command output/help text; tests
Work: Replace the transitional retained command naming with the canonical product naming and behavior for indexing and status. This unit must make `codenexus index` the primary indexing command, ensure its help/output/error text reflects the CodeNexus product, and align `codenexus status` output with the canonical base states and detail flags already implemented in Epic 03. It must also ensure the commands fail clearly when activation/config is missing, rather than hiding that requirement. Done when indexing and status are exposed as stable CodeNexus commands rather than inherited `gitnexus` shims in disguise.
Tests: Update CLI tests for `codenexus index` and `codenexus status` covering uninitialized, invalid-config, initialized-unindexed, indexed-current, indexed-stale, and serving-state reporting. Confirm old command naming is no longer the primary tested surface.
Docs: Update `docs/cli/commands.md`, `planning/master-intent.md`, and any governed docs that still describe `analyze` as the primary user-facing indexing command.

### [x] 104 Establish The `codenexus serve` CLI Surface Without Overstepping Epic 05

Surface: `gitnexus/src/cli/serve.ts`; `gitnexus/src/cli/index.ts`; command help and error behavior; tests; CLI/runtime docs
Work: Establish the CodeNexus-side CLI surface for `codenexus serve` while preserving Epic 05 ownership of the real HTTP service lifecycle. This unit must decide what the command does in Epic 04, how it fails when the HTTP runtime is not fully implemented yet, and how the command/help text avoids overpromising. The visible command must be `codenexus serve`; Epic 04 may not leave an inherited `mcp` command in the visible product surface. The command should fail clearly until Epic 05 implements the actual service lifecycle. Done when the CLI surface is shaped correctly and users are no longer forced through inherited CLI naming from the pre-CodeNexus product surface, even if the full HTTP runtime still lands in the next epic.
Tests: Add or update CLI tests for `codenexus serve` help, failure cases, and transitional messaging. Confirm the command surface is correct and that no hidden bootstrap or compatibility behavior leaks back in.
Docs: Update `docs/cli/commands.md`, `docs/architecture/mcp-http-runtime.md`, and any CLI-facing docs to make the Epic 04 versus Epic 05 boundary explicit.

### [x] 190 Milestone 100 Closeout

Surface: canonical CLI surface; package/bin wiring; `codenexus init`; `codenexus index`; `codenexus status`; `codenexus serve` CLI shape; durable docs; validation evidence
Work: Confirm CodeNexus now has a real CLI product surface on top of the repo-local architecture from Epic 03. This closeout must prove that `codenexus` is the canonical executable, repo activation exists, indexing and status are exposed under the right names, and the serve command is correctly shaped for the next epic without pretending the HTTP runtime is already complete. It must also clearly state what remains for Epic 05 so the next work starts from a correct CLI surface rather than another transitional command rewrite.
Tests: Run the selected docs, build, unit, and integration gates for the resulting tree and verify the shipped CLI/help/bin surface matches the locked contract.
Docs: Record closeout evidence in the epic and ensure the final CLI/product surface is reflected in `docs/cli/commands.md`, `docs/architecture/repo-local-implementation.md`, and `planning/master-intent.md`.

Closeout evidence table (required):

| Unit | Required evidence | Link / Note | Status |
|---|---|---|---|
| 100 | Canonical CLI surface is locked | [commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md), [mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md), and [master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md) now define `codenexus` as the only user-facing executable and `codenexus serve` as the final command shape. | [x] |
| 101 | `codenexus` executable and command tree exist | [package.json](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/package.json) ships only the `codenexus` binary, [index.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index.ts) exposes `init/index/status/serve`, and [cli-commands.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/cli-commands.test.ts) verifies the visible tree. | [x] |
| 102 | `codenexus init` works as the explicit repo activation path | [init.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/init.ts) creates only `.codenexus/config.toml`, and [init-command.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/init-command.test.ts) covers first init, repeat init, invalid config, nested repos, and worktrees. | [x] |
| 103 | `codenexus index` and `codenexus status` are aligned to the CodeNexus surface | [index-command.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/index-command.ts) and [status.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/status.ts) now present the canonical names and error posture, with command/help coverage in [cli-commands.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/cli-commands.test.ts). | [x] |
| 104 | `codenexus serve` CLI shape is established without overpromising Epic 05 behavior | [serve.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/src/cli/serve.ts) provides the final command shape with explicit failure, [serve-command.test.ts](/Users/alex/Projects/GitNexusFork-agent-1/gitnexus/test/unit/serve-command.test.ts) verifies that posture, and [mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md) documents the Epic 04 versus Epic 05 boundary. | [x] |
| 190 | Validation passed on the reshaped CLI | `npm run lint:docs --prefix gitnexus`, `npm run check:docs-contracts --prefix gitnexus`, `npm run build --prefix gitnexus`, `npm test --prefix gitnexus`, `npm run test:integration --prefix gitnexus`, and `npm run test:all --prefix gitnexus` all passed on the resulting tree. | [x] |

Blocker criteria (190 cannot close if any are true):

- `codenexus` is not the canonical CLI surface.
- `gitnexus` remains a shipped or user-facing CLI surface.
- `codenexus init` does not exist or silently mutates more than `.codenexus/`.
- The primary indexing/status surface is not presented as `codenexus index` and `codenexus status`.
- The visible service command is not `codenexus serve`.
- `codenexus serve` is presented as fully complete even though Epic 05 still owns the real HTTP runtime lifecycle.
- Docs, build, unit, or integration validation fail on the resulting tree.
