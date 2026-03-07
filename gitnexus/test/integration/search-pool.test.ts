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

const SEED_DATA = [
  // File nodes — content is the searchable field
  `CREATE (n:File {id: 'file:auth.ts', name: 'auth.ts', filePath: 'src/auth.ts', content: 'authentication module for user login and session management'})`,
  `CREATE (n:File {id: 'file:router.ts', name: 'router.ts', filePath: 'src/router.ts', content: 'HTTP request routing and middleware pipeline'})`,
  `CREATE (n:File {id: 'file:utils.ts', name: 'utils.ts', filePath: 'src/utils.ts', content: 'general utility functions for string manipulation'})`,

  // Function nodes
  `CREATE (n:Function {id: 'func:validateUser', name: 'validateUser', filePath: 'src/auth.ts', startLine: 10, endLine: 30, isExported: true, content: 'validates user credentials and authentication tokens', description: 'user auth validator'})`,
  `CREATE (n:Function {id: 'func:hashPassword', name: 'hashPassword', filePath: 'src/auth.ts', startLine: 35, endLine: 50, isExported: true, content: 'hashes user password with bcrypt for secure authentication', description: 'password hashing'})`,
  `CREATE (n:Function {id: 'func:handleRoute', name: 'handleRoute', filePath: 'src/router.ts', startLine: 1, endLine: 20, isExported: true, content: 'handles HTTP request routing to controllers', description: 'route handler'})`,
  `CREATE (n:Function {id: 'func:formatString', name: 'formatString', filePath: 'src/utils.ts', startLine: 1, endLine: 10, isExported: true, content: 'formats a string with template placeholders', description: 'string formatter'})`,

  // Class nodes
  `CREATE (n:Class {id: 'class:AuthService', name: 'AuthService', filePath: 'src/auth.ts', startLine: 55, endLine: 120, isExported: true, content: 'authentication service handling user login logout and token refresh', description: 'auth service class'})`,

  // Method nodes
  `CREATE (n:Method {id: 'method:AuthService.login', name: 'login', filePath: 'src/auth.ts', startLine: 60, endLine: 80, isExported: false, content: 'authenticates user with username and password returning JWT token', description: 'login method'})`,

  // Interface nodes
  `CREATE (n:Interface {id: 'iface:UserCredentials', name: 'UserCredentials', filePath: 'src/auth.ts', startLine: 1, endLine: 8, isExported: true, content: 'interface for user authentication credentials username password', description: 'credentials interface'})`,
];

const FTS_INDEXES = [
  { table: 'File', indexName: 'file_fts', columns: ['name', 'content'] },
  { table: 'Function', indexName: 'function_fts', columns: ['name', 'content', 'description'] },
  { table: 'Class', indexName: 'class_fts', columns: ['name', 'content', 'description'] },
  { table: 'Method', indexName: 'method_fts', columns: ['name', 'content', 'description'] },
  { table: 'Interface', indexName: 'interface_fts', columns: ['name', 'content', 'description'] },
];

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
  seed: SEED_DATA,
  ftsIndexes: FTS_INDEXES,
  poolAdapter: true,
});
