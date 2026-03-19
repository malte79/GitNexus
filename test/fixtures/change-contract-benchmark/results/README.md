# Change Contract Benchmark Results

This directory is reserved for preserved benchmark run artifacts for Epic 20.

Expected files:
- `baseline.json`: captured against the pre-feature product state
- `candidate.json`: captured against the change-contract feature state
- `comparison.json`: optional output from `scripts/run-change-contract-benchmark.ts --baseline ... --candidate ... --write-comparison ...`

These files must come from real pinned-corpus runs. Do not fabricate or backfill them from synthetic test data.
