Title: Change Contracts For Agent Work Planning
Assigned to: Agent 1
Lane: Workflow
Status: done
Objective: Add a bounded-confidence `change contract` capability to gnexus that helps planning, engineering, QA, and security agents reach a viable initial edit-and-test plan faster and more safely without claiming full codebase understanding. Success for this epic is measured on one pinned six-task orientation slice, not a full telemetry study: candidate `plan-change` must not regress initial-plan correctness, must not regress QA or security expected-test coverage, must succeed on more tasks than baseline, and must show lower wall-clock time plus lower tool-call count on the tasks where both baseline and candidate reach a viable initial plan.
In scope: a first-class CLI and repo-local MCP surface for generating bounded-confidence change contracts; a strict evidence model that distinguishes direct graph facts from structural inference and hypotheses; change-contract output that names exact candidate files, symbols, boundaries, tests, and risk surfaces; a post-change verification path that checks whether an implementation matches the contract and flags missed likely surfaces; a pinned orientation benchmark slice across planning, engineering, QA, and security tasks; preserved baseline-versus-candidate evidence for initial-plan correctness, expected-test coverage, wall-clock time, and tool-call count.
Out of scope: pretending gnexus fully understands arbitrary codebases; silent overclaiming of certainty; a feature that emits one flat edit list without evidence classes; fully autonomous patch generation; a full telemetry study for tokens, rework, or trustworthiness as a ship blocker for this epic; changing the storage engine, MCP transport, or repo-local state model beyond what the feature contract requires; shipping the feature if the reduced orientation benchmark shows regressions in correctness or expected-test coverage.
Dependencies: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md); current structural-analysis surfaces in [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local), [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/tools.ts), [/Users/alex/Projects/GitNexusFork-agent-1/src/cli/](/Users/alex/Projects/GitNexusFork-agent-1/src/cli), and [/Users/alex/Projects/GitNexusFork-agent-1/src/core/](/Users/alex/Projects/GitNexusFork-agent-1/src/core); benchmark artifacts under [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results).
Risks: the feature becomes harmful if it overstates confidence or collapses evidence classes into one authoritative answer; benchmark claims are meaningless if baseline and candidate runs are not compared on the same pinned tasks and clean benchmark worktrees; a speed-only benchmark would be misleading if candidate lost required edit surfaces or expected tests, so the reduced bar still requires role-segmented correctness first; orientation savings can be overclaimed if candidate success comes from easier prompts rather than the pinned task slice, so the comparison must reuse preserved baseline and candidate artifacts for the same task ids.
Rollback strategy: if the reduced orientation slice does not show non-regressing correctness plus a strictly better success count, do not ship the feature; if the shared-success tasks do not show lower wall-clock time and lower tool-call count, do not claim orientation savings; if the evidence model cannot remain explicit and trustworthy, revert the feature rather than keeping a misleading planner surface in production.

### [x] 101 Lock The Change Contract Product And Confidence Model

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md); [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md)
Work: Lock the bounded-confidence product contract before implementation. Define the evidence buckets `grounded`, `strong_inference`, and `hypothesis`; define the minimum output fields for `plan-change`; define the minimum mismatch categories for `verify-change`; and reject “full codebase understanding” as a product claim.
Tests: `npm run lint:docs`; `npm run check:docs-contracts`
Docs: Update the governed docs above

### [x] 102 Build The Pinned Orientation Corpus And Comparison Harness

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/test/](/Users/alex/Projects/GitNexusFork-agent-1/test); [/Users/alex/Projects/GitNexusFork-agent-1/scripts/](/Users/alex/Projects/GitNexusFork-agent-1/scripts); benchmark fixtures under [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures)
Work: Create the pinned task corpus and the repo-owned comparison harness before closing the feature. The harness must preserve task ids, role segmentation, gold edit surfaces, expected tests, and the benchmark worktree identity used for baseline and candidate evidence. For this epic, the shipping slice is one pinned six-task orientation benchmark:

- `planning-repo-manager-split`
- `planning-local-backend-ranking`
- `engineering-new-cli-surface`
- `engineering-new-mcp-tool`
- `qa-runtime-rename-regression`
- `security-change-contract-overconfidence`

Done when the repo can preserve baseline and candidate observations for those same tasks and compare them field-for-field.
Tests: `npm test`; `node --import tsx scripts/run-change-contract-benchmark.ts --fixtures test/fixtures/change-contract-benchmark`
Docs: Update benchmark workflow docs only if needed

### [x] 103 Capture The Baseline Without Change Contracts

Surface: pinned orientation corpus from `102`; existing `query`, `context`, `impact`, `summary`, and repo-tool flows
Work: Capture the preserved baseline orientation slice without `plan-change`. The preserved evidence must record task success, recovered gold surfaces, recovered expected tests, wall-clock time, and tool-call count for the six pinned tasks, using the clean baseline benchmark worktree at commit `c59f7233cbc691ea630957c4ff5144b3fb438be5`.
Tests: baseline artifacts preserved and referenced from the final comparison artifact
Docs: baseline evidence recorded in this epic and in the comparison artifact

### [x] 190 Milestone 100 Closeout

Surface: bounded-confidence contract docs; pinned orientation corpus; preserved baseline evidence
Work: Prove the product contract and the reduced shipping gate are locked before implementation closeout. This milestone is complete when the docs define the bounded-confidence surface, the pinned orientation slice exists, and the baseline evidence has been preserved for the six shipping tasks.
Tests: `npm run lint:docs`; `npm run check:docs-contracts`; `npm test`; benchmark harness smoke checks from `102`
Docs: keep the governed docs and this epic in lockstep

### [x] 201 Implement `plan-change` As A First-Class Bounded-Confidence Surface

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local); [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/tools.ts); [/Users/alex/Projects/GitNexusFork-agent-1/src/cli/](/Users/alex/Projects/GitNexusFork-agent-1/src/cli); any new contract types under [/Users/alex/Projects/GitNexusFork-agent-1/src/](/Users/alex/Projects/GitNexusFork-agent-1/src)
Work: Implement the pre-change contract generator. Reuse existing graph/search/context/impact data rather than inventing a parallel planner substrate, and keep uncertainty first-class instead of flattening inferences into one authoritative answer.
Tests: `npm test`; `npm run test:integration`
Docs: Update [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md), and [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md)

### [x] 202 Implement `verify-change` Against The Contract

Surface: [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local); [/Users/alex/Projects/GitNexusFork-agent-1/src/cli/](/Users/alex/Projects/GitNexusFork-agent-1/src/cli); fixture support under [/Users/alex/Projects/GitNexusFork-agent-1/test/](/Users/alex/Projects/GitNexusFork-agent-1/test)
Work: Implement the post-change verification path. Preserve the same evidence vocabulary used by `plan-change`, distinguish contract insufficiency from implementation misses, and keep out-of-contract touched surfaces visible.
Tests: `npm test`; `npm run test:integration`
Docs: Update governed CLI and MCP/runtime docs touched by the verification surface

### [x] 203 Prove Orientation Gains And Shipping Thresholds

Surface: pinned orientation corpus and preserved baseline/candidate artifacts from `102` and `103`; `plan-change` outputs from `201`; `verify-change` outputs from `202`
Work: Compare baseline and candidate on the pinned six-task orientation slice and record one honest ship verdict. The comparison must show:

- no regression in initial-plan correctness
- no regression in QA or security expected-test coverage
- strictly more successful tasks than baseline
- lower wall-clock time and lower tool-call count on the tasks where both baseline and candidate reach a viable initial plan

Tests: comparison artifact preserved at [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/orientation-shipping-slice.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/orientation-shipping-slice.json)
Docs: record the shipping verdict in this epic

### [x] 290 Milestone 200 Closeout

Surface: `plan-change`; `verify-change`; reduced benchmark comparison evidence; governed CLI and MCP docs
Work: Prove the feature is both real and worth shipping under the reduced bar. This milestone is complete when agents can generate and verify bounded-confidence change contracts through supported surfaces and the pinned six-task orientation slice shows better task success without regressions in correctness or QA/security expected-test coverage.
Tests: `npm run lint:docs`; `npm run check:docs-contracts`; `npm test`; `npm run test:integration`; preserved orientation comparison from `203`
Docs: final governed docs already updated by `201` and `202`; record milestone evidence in this epic

### [x] 490 Epic Closeout

Surface: bounded-confidence planning contract; verification surface; orientation benchmark evidence; governed docs and workflows
Work: Epic closeout is complete when gnexus ships a bounded-confidence change-contract capability that measurably improves initial orientation for planning, engineering, QA, and security agents on the pinned six-task slice without pretending to fully understand the codebase. The final record must show the exact selected tasks, the preserved baseline and candidate artifacts used for comparison, the role-segmented result counts, the shared-success time and tool-call comparison, and the final ship verdict.
Tests: `npm run lint:docs`; `npm run check:docs-contracts`; `npm test`; `npm run test:integration`
Docs: None

Current evidence:

- Governed docs updated in [/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md](/Users/alex/Projects/GitNexusFork-agent-1/planning/master-intent.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/cli/commands.md), [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/mcp-http-runtime.md), and [/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/repo-local-implementation.md)
- Runtime surface added at [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/tools.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/tools.ts), [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/server.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/server.ts), [/Users/alex/Projects/GitNexusFork-agent-1/src/cli/index.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/index.ts), [/Users/alex/Projects/GitNexusFork-agent-1/src/cli/plan-change.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/plan-change.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/src/cli/verify-change.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/cli/verify-change.ts)
- Focused Local Backend owners added at [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-types.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-types.ts), [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-evidence-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-evidence-support.ts), [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-change-contract-support.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-verify-change-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/src/mcp/local/local-backend-verify-change-support.ts)
- Benchmark harness and pinned corpus added at [/Users/alex/Projects/GitNexusFork-agent-1/scripts/change-contract-benchmark-support.ts](/Users/alex/Projects/GitNexusFork-agent-1/scripts/change-contract-benchmark-support.ts), [/Users/alex/Projects/GitNexusFork-agent-1/scripts/run-change-contract-benchmark.ts](/Users/alex/Projects/GitNexusFork-agent-1/scripts/run-change-contract-benchmark.ts), and [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json)
- Preserved baseline pilot slices:

  - planning: [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-planning-pilot.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-planning-pilot.json)
  - engineering: [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-engineering-pilot.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-engineering-pilot.json)
  - QA and security: [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-qa-security-pilot.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-qa-security-pilot.json)
- Preserved current candidate pilot: [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/candidate-surface-pilot.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/candidate-surface-pilot.json)
- Final reduced-bar comparison artifact: [/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/orientation-shipping-slice.json](/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/orientation-shipping-slice.json)

Final orientation verdict:

- Selected shipping slice: `planning-repo-manager-split`, `planning-local-backend-ranking`, `engineering-new-cli-surface`, `engineering-new-mcp-tool`, `qa-runtime-rename-regression`, `security-change-contract-overconfidence`
- Baseline success count: `1/6`
- Candidate success count: `6/6`
- Role breakdown:

  - planning: baseline `1/2`, candidate `2/2`
  - engineering: baseline `0/2`, candidate `2/2`
  - qa: baseline `0/1`, candidate `1/1`
  - security: baseline `0/1`, candidate `1/1`
- QA and security expected-test coverage did not regress; it improved from zero preserved baseline coverage on the selected slice to complete candidate coverage on both selected QA and security tasks.
- Shared-success comparison:

  - only shared-success task: `planning-repo-manager-split`
  - baseline viable-initial-plan time: `1.11s`
  - candidate viable-initial-plan time: `0.898s`
  - baseline tool calls: `2`
  - candidate tool calls: `1`
- Ship verdict: earned under this reduced orientation benchmark.
