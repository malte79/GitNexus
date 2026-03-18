#!/bin/sh
set -eu

run_test() {
  file="$1"
  pool="${2:-}"

  if [ -n "$pool" ]; then
    npx vitest run "$file" "--pool=$pool"
  else
    npx vitest run "$file"
  fi
}

run_test test/integration/csv-pipeline.test.ts
run_test test/integration/filesystem-walker.test.ts
# Direct `npx tsx <file>` is unstable here with native Kuzu teardown under Node 23.
# `node --import tsx` runs the same harness without the intermittent segfault.
node --import tsx scripts/run-local-backend-integration.ts
run_test test/integration/kuzu-pool.test.ts forks
run_test test/integration/parsing.test.ts
run_test test/integration/pipeline.test.ts
run_test test/integration/service-runtime.test.ts threads
run_test test/integration/tree-sitter-languages.test.ts
run_test test/integration/luau-indexing.test.ts
run_test test/integration/roblox-rojo-indexing.test.ts
run_test test/integration/worker-pool.test.ts
