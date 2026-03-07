/**
 * Vitest global setup file.
 *
 * KuzuDB's C++ destructors hang when Node.js garbage-collects
 * native Database/Connection objects during forked process exit.
 *
 * Problem chain:
 *   test completes → fork exits → GC finds orphaned native objects
 *   → C++ destructors fire on torn-down runtime → hang (Ubuntu)
 *   or segfault (Windows).
 *
 * Fix: force process.exit(0) on `beforeExit` — this fires when
 * the event loop has drained (all test results already sent via IPC)
 * and BEFORE GC runs finalizers.  The OS reclaims all native
 * resources on process exit, so no cleanup is needed.
 */
import { afterAll } from 'vitest';

// ── Prevent GC-triggered C++ destructor hangs ────────────────────────
// `beforeExit` fires when the event loop is empty (tests done, results
// sent to parent).  Calling process.exit(0) skips the GC phase that
// would otherwise trigger native KuzuDB destructors.
process.on('beforeExit', () => process.exit(0));

afterAll(async () => {
  // Detach (null out) all native refs.  This prevents any JS-level
  // use after teardown.  We intentionally do NOT call closeKuzu()
  // here — the `beforeExit` handler above guarantees the process
  // exits before GC can trigger C++ destructors on these objects.
  try { (await import('../src/core/kuzu/kuzu-adapter.js')).detachKuzu(); } catch {}
  try { (await import('../src/mcp/core/kuzu-adapter.js')).detachKuzu(); } catch {}
});
