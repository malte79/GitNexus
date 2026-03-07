/**
 * Vitest global setup file.
 *
 * KuzuDB's C++ destructors segfault when Node.js garbage-collects
 * native Database/Connection objects during forked process exit.
 *
 * We detach (null out) references WITHOUT calling .close() so that
 * GC cannot find the native objects and run their destructors.
 * The native handles leak intentionally — the OS reclaims them on exit.
 */
import { afterAll } from 'vitest';

afterAll(async () => {
  try {
    const { detachKuzu } = await import('../src/core/kuzu/kuzu-adapter.js');
    detachKuzu();
  } catch { /* never opened */ }

  try {
    const { detachKuzu } = await import('../src/mcp/core/kuzu-adapter.js');
    detachKuzu();
  } catch { /* never opened */ }
});
