/**
 * Vitest global setup file.
 *
 * KuzuDB's C++ destructors can segfault or hang when Node.js
 * garbage-collects native Database/Connection objects during
 * forked process exit.
 *
 * Strategy: first try closeKuzu() to properly close native handles
 * during active execution (destructor becomes a no-op on GC).
 * Then detachKuzu() as safety net to null out any remaining refs.
 */
import { afterAll } from 'vitest';

afterAll(async () => {
  // --- Core adapter (single db/conn) ---
  try {
    const core = await import('../src/core/kuzu/kuzu-adapter.js');
    try { await core.closeKuzu(); } catch { /* close failed — fall through to detach */ }
    core.detachKuzu();
  } catch { /* never opened */ }

  // --- MCP pool adapter (per-repo connection pool) ---
  try {
    const pool = await import('../src/mcp/core/kuzu-adapter.js');
    try { await pool.closeKuzu(); } catch { /* close failed — fall through to detach */ }
    pool.detachKuzu();
  } catch { /* never opened */ }
});
