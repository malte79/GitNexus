# Change Contract Benchmark Capture Guide

This directory holds the preserved benchmark evidence for Epic 20.

For this epic, the shipping gate is the reduced six-task orientation slice captured in:
- `/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/orientation-shipping-slice.json`

The fuller `baseline.json` / `candidate.json` / `comparison.json` workflow remains available for a deeper future study, but it is not the ship blocker for Epic 20.

## Worktree Targets

- Baseline worktree:
  - path: `/Users/alex/Projects/GitNexusFork-agent-1/.bench-worktrees/baseline`
  - commit: `c59f7233cbc691ea630957c4ff5144b3fb438be5`
  - port: `4751`
- Candidate worktree:
  - path: `/Users/alex/Projects/GitNexusFork-agent-1/.bench-worktrees/candidate`
  - commit: `a304562ab60f9f07eeeb27366a5d7ad8448d02af`
  - port: `4752`

Both benchmark worktrees are currently clean checkouts. After any future checkout or rebuild, do a hard repo-local service restart before trusting captured output:
- `node dist/cli/index.js manage stop`
- `node dist/cli/index.js manage start`
- `node dist/cli/index.js manage status`

A stale background service can make a clean candidate lane look falsely regressed.

## Shipping Slice

Epic 20 closes on this pinned six-task slice:
- `planning-repo-manager-split`
- `planning-local-backend-ranking`
- `engineering-new-cli-surface`
- `engineering-new-mcp-tool`
- `qa-runtime-rename-regression`
- `security-change-contract-overconfidence`

Baseline evidence comes from:
- `/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-planning-pilot.json`
- `/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-engineering-pilot.json`
- `/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/baseline-qa-security-pilot.json`

Candidate evidence comes from:
- `/Users/alex/Projects/GitNexusFork-agent-1/test/fixtures/change-contract-benchmark/results/candidate-surface-pilot.json`

## Reduced Comparison Rules

The reduced orientation benchmark asks only:
1. Did candidate regress initial-plan correctness on any selected task?
2. Did candidate regress QA or security expected-test coverage on the selected slice?
3. Did candidate succeed on more selected tasks than baseline?
4. On tasks where both baseline and candidate reached a viable initial plan, did candidate use less wall-clock time and fewer tool calls?

For this epic, a viable initial plan means:
- complete gold-surface coverage for the task
- complete expected-test coverage for the task

## Evidence Notes

- The preserved pilot artifacts are real measured observations from the clean baseline and clean candidate benchmark worktrees.
- The baseline pilot artifacts predate the final reduced-bar closeout, so some run-level fields like `repo_clean` are not embedded inside those JSON files. Clean benchmark worktree status was re-verified locally before closeout.
- The candidate pilot artifact does embed `repo_clean: true`.

## Optional Deeper Study

If a later epic wants a fuller telemetry benchmark, use the existing harness:
- `/Users/alex/Projects/GitNexusFork-agent-1/scripts/change-contract-benchmark-support.ts`
- `/Users/alex/Projects/GitNexusFork-agent-1/scripts/run-change-contract-benchmark.ts`

That deeper study can still preserve:
- `baseline.json`
- `candidate.json`
- `comparison.json`

but Epic 20 itself no longer requires those files for ship/no-ship.
