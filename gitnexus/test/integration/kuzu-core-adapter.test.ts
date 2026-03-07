/**
 * P0 Integration Tests: Core KuzuDB Adapter
 *
 * Tests: loadGraphToKuzu CSV round-trip, createFTSIndex, getKuzuStats.
 *
 * IMPORTANT: All core adapter tests share ONE coreHandle and ONE coreInitKuzu
 * call because the core adapter is a module-level singleton. Calling
 * coreInitKuzu with a different path would close the previous native DB
 * handle, which segfaults in forked processes. Sharing a single handle
 * avoids this entirely.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { withTestKuzuDB } from '../helpers/test-indexed-db.js';

// ─── Core KuzuDB Adapter ─────────────────────────────────────────────

withTestKuzuDB('core-adapter', (handle) => {
  describe('core adapter', () => {
    it('loadGraphToKuzu: loads a minimal graph and node counts match', async () => {
      const { executeQuery: coreExecuteQuery } = await import('../../src/core/kuzu/kuzu-adapter.js');

      // createMinimalTestGraph has 2 File, 2 Function, 1 Class, 1 Folder = 6 nodes
      const fileRows = await coreExecuteQuery('MATCH (n:File) RETURN n.id AS id');
      expect(fileRows).toHaveLength(2);

      const funcRows = await coreExecuteQuery('MATCH (n:Function) RETURN n.id AS id');
      expect(funcRows).toHaveLength(2);

      const classRows = await coreExecuteQuery('MATCH (n:Class) RETURN n.id AS id');
      expect(classRows).toHaveLength(1);

      const folderRows = await coreExecuteQuery('MATCH (n:Folder) RETURN n.id AS id');
      expect(folderRows).toHaveLength(1);
    });

    it('createFTSIndex: creates FTS index on Function table without error', async () => {
      const { createFTSIndex } = await import('../../src/core/kuzu/kuzu-adapter.js');

      await expect(
        createFTSIndex('Function', 'function_fts', ['name', 'content']),
      ).resolves.toBeUndefined();
    });

    it('getKuzuStats: returns correct node and edge counts for seeded data', async () => {
      const { getKuzuStats } = await import('../../src/core/kuzu/kuzu-adapter.js');

      const stats = await getKuzuStats();

      // createMinimalTestGraph: 6 nodes (2 File, 2 Function, 1 Class, 1 Folder)
      expect(stats.nodes).toBe(6);

      // 4 relationships (2 CALLS, 2 CONTAINS)
      expect(stats.edges).toBe(4);
    });
  });
}, {
  afterSetup: async (handle) => {
    // Load a minimal graph via CSV round-trip (core adapter is already initialized by wrapper)
    const { loadGraphToKuzu } = await import('../../src/core/kuzu/kuzu-adapter.js');
    const { createMinimalTestGraph } = await import('../helpers/test-graph.js');

    const graph = createMinimalTestGraph();
    const storagePath = path.join(handle.tmpHandle.dbPath, 'storage');
    await fs.mkdir(storagePath, { recursive: true });

    await loadGraphToKuzu(graph, '/test/repo', storagePath);
  },
});
