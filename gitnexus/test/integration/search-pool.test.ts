/**
 * P0 Integration Tests: BM25/FTS Search against real KuzuDB
 *
 * Tests: searchFTSFromKuzu via MCP pool adapter (with repoId) path
 * against indexed test data. Verifies ranked result ordering and
 * empty-match behavior through the pool adapter.
 *
 * Uses withTestKuzuDB wrapper for full lifecycle management.
 */
import { describe, it, expect } from 'vitest';
import { withTestKuzuDB } from '../helpers/test-indexed-db.js';
import { searchFTSFromKuzu } from '../../src/core/search/bm25-index.js';
import { SEARCH_SEED_DATA, SEARCH_FTS_INDEXES } from '../fixtures/search-seed.js';

// ─── MCP pool adapter path (with repoId) ────────────────────────────

withTestKuzuDB('search-pool', (handle) => {
  describe('searchFTSFromKuzu — MCP pool adapter (with repoId)', () => {
    it('returns ranked results via pool adapter', async () => {
      const results = await searchFTSFromKuzu('user authentication', 10, handle.repoId);

      expect(results.length).toBeGreaterThan(0);

      for (const r of results) {
        expect(r).toHaveProperty('filePath');
        expect(r).toHaveProperty('score');
        expect(r).toHaveProperty('rank');
        expect(r.score).toBeGreaterThan(0);
      }

      const filePaths = results.map((r) => r.filePath);
      expect(filePaths).toContain('src/auth.ts');
    });

    it('results are ordered by descending score via pool adapter', async () => {
      const results = await searchFTSFromKuzu('user authentication', 10, handle.repoId);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('returns empty array for non-matching query via pool adapter', async () => {
      const results = await searchFTSFromKuzu('xyzzyplughtwisty', 10, handle.repoId);
      expect(results).toEqual([]);
    });

    it('respects limit parameter via pool adapter', async () => {
      const results = await searchFTSFromKuzu('user authentication', 1, handle.repoId);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });
}, {
  seed: SEARCH_SEED_DATA,
  ftsIndexes: SEARCH_FTS_INDEXES,
  poolAdapter: true,
});
