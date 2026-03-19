# Change Contract Benchmark Capture Guide

This directory holds the real preserved benchmark artifacts for Epic 20:
- `baseline.json`
- `candidate.json`
- optional `comparison.json`

Do not invent these files from synthetic unit-test data. Every numeric field must come from a real run or explicit human adjudication against the pinned corpus.

## Prepared Worktrees

- Baseline worktree:
  - path: `/Users/alex/Projects/GitNexusFork-agent-1/.bench-worktrees/baseline`
  - commit: `c59f7233cbc691ea630957c4ff5144b3fb438be5`
  - port: `4751`
- Candidate worktree:
  - path: `/Users/alex/Projects/GitNexusFork-agent-1/.bench-worktrees/candidate`
  - commit: `000ead1`
  - port: `4752`

Both worktrees are initialized and indexed. Run benchmark tasks against those exact paths unless the corpus is intentionally repinned.

## Run Discipline

For every task:
1. Start at the task's orientation boundary.
2. Use only the allowed product surface for that mode:
   - baseline: existing `query`, `context`, `impact`, `summary`, repo tools
   - candidate: `plan-change` and `verify-change`, plus any existing tools needed by the task
3. Record:
   - time to first correct edit or test surface
   - total task time
   - orientation-token count before first correct surface
   - wrong-surface count
   - rework count
   - recommended-test recall and precision
   - trustworthiness fields
4. Judge correctness against the pinned `gold` section in the corpus.

## Result File Shape

Use the schema enforced by:
- `/Users/alex/Projects/GitNexusFork-agent-1/scripts/change-contract-benchmark-support.ts`

Required run-level fields:
- `corpus_version`
- `mode`
- `runtime_signature`
- `variance.repeated_runs`
- `variance.measurement_method`
- `task_results`

Required per-task fields:
- `task_id`
- `role`
- `agent_runtime`
- `freshness_prerequisites`
- `orientation_boundary`
- `success`
- `metrics.*`
- `trustworthiness.*`

## Suggested Runtime Signatures

Use one consistent runtime signature across the compared pair. Example:
- `codex-gpt-5.x-pinned-corpus-v1`

If the compared runs do not share the same runtime signature, comparison is invalid.

## Capture Worksheet

### Planning

1. `planning-repo-manager-split`
   - baseline command chain:
     - `node dist/cli/index.js query "Split repo state evaluation away from runtime coordination in repo-manager" --owners`
     - `node dist/cli/index.js context getRepoState --file-path src/storage/repo-manager.ts`
   - candidate command:
     - `node dist/cli/index.js plan-change "Split repo state evaluation away from runtime coordination in repo-manager"`
   - gold correct surfaces:
     - `src/storage/repo-manager.ts`
     - `src/server/service-runtime.ts`

2. `planning-local-backend-ranking`
   - baseline command chain:
     - `node dist/cli/index.js summary --subsystems`
     - `node dist/cli/index.js query "Reduce authority concentration in Local Backend ranking and graph recovery" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Reduce authority concentration in Local Backend ranking and graph recovery"`

3. `planning-ingestion-call-surface`
   - baseline command chain:
     - `node dist/cli/index.js summary --subsystems`
     - `node dist/cli/index.js query "Reduce truth-family concentration around call resolution in ingestion" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Reduce truth-family concentration around call resolution in ingestion"`

### Engineering

4. `engineering-new-cli-surface`
   - baseline command chain:
     - `node dist/cli/index.js query "Add a new top-level analysis command that routes through the MCP HTTP runtime" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Add a new top-level analysis command that routes through the MCP HTTP runtime"`

5. `engineering-new-mcp-tool`
   - baseline command chain:
     - `node dist/cli/index.js query "Add a new agent-facing tool that reuses existing Local Backend analysis seams" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Add a new agent-facing tool that reuses existing Local Backend analysis seams"`

6. `engineering-structural-guard`
   - baseline command chain:
     - `node dist/cli/index.js query "Add a structure test that prevents Local Backend analysis from regrowing into a monolith" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Add a structure test that prevents Local Backend analysis from regrowing into a monolith"`

### QA

7. `qa-runtime-rename-regression`
   - baseline command chain:
     - `node dist/cli/index.js query "Identify the highest-value regression checks for command, state-dir, and runtime identity rename work" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Identify the highest-value regression checks for command, state-dir, and runtime identity rename work"`

8. `qa-change-contract-tests`
   - baseline command chain:
     - `node dist/cli/index.js query "Identify the regression tests needed for plan-change and verify-change to remain trustworthy" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Identify the regression tests needed for plan-change and verify-change to remain trustworthy"`

9. `qa-flattening-regression`
   - baseline command chain:
     - `node dist/cli/index.js query "Identify what should be tested so old nested package paths do not silently linger" --owners`
   - candidate command:
     - `node dist/cli/index.js plan-change "Identify what should be tested so old nested package paths do not silently linger"`

### Security

10. `security-runtime-boundary-audit`
    - baseline command chain:
      - `node dist/cli/index.js query "Identify the security-sensitive boundaries touched by repo-local MCP over HTTP startup and repo matching" --owners`
    - candidate command:
      - `node dist/cli/index.js plan-change "Identify the security-sensitive boundaries touched by repo-local MCP over HTTP startup and repo matching"`

11. `security-change-contract-overconfidence`
    - baseline command chain:
      - `node dist/cli/index.js query "Identify how plan-change and verify-change could overclaim certainty or hide contract defects" --owners`
    - candidate command:
      - `node dist/cli/index.js plan-change "Identify how plan-change and verify-change could overclaim certainty or hide contract defects"`

12. `security-rename-command-boundary`
    - baseline command chain:
      - `node dist/cli/index.js query "Identify the security-sensitive boundaries touched by the coordinated rename surface" --owners`
    - candidate command:
      - `node dist/cli/index.js plan-change "Identify the security-sensitive boundaries touched by the coordinated rename surface"`

## After Capture

1. Save the finished run files:
   - `test/fixtures/change-contract-benchmark/results/baseline.json`
   - `test/fixtures/change-contract-benchmark/results/candidate.json`
2. Validate them:
   - `node --import tsx scripts/run-change-contract-benchmark.ts --fixtures test/fixtures/change-contract-benchmark --run test/fixtures/change-contract-benchmark/results/baseline.json`
   - `node --import tsx scripts/run-change-contract-benchmark.ts --fixtures test/fixtures/change-contract-benchmark --run test/fixtures/change-contract-benchmark/results/candidate.json`
3. Compare them:
   - `node --import tsx scripts/run-change-contract-benchmark.ts --fixtures test/fixtures/change-contract-benchmark --baseline test/fixtures/change-contract-benchmark/results/baseline.json --candidate test/fixtures/change-contract-benchmark/results/candidate.json --write-comparison test/fixtures/change-contract-benchmark/results/comparison.json`
