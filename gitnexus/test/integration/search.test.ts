/**
 * P0 Integration Tests: BM25/FTS Search against real KuzuDB
 *
 * Tests: searchFTSFromKuzu via both core adapter (no repoId) and
 * MCP pool adapter (with repoId) paths against indexed test data.
 * Verifies ranked result ordering, score merging, and empty-match behavior.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestKuzuDB,
  seedTestData,
  type IndexedDBHandle,
} from '../helpers/test-indexed-db.js';
import { initKuzu, createFTSIndex, loadFTSExtension } from '../../src/core/kuzu/kuzu-adapter.js';
import { initKuzu as poolInitKuzu } from '../../src/mcp/core/kuzu-adapter.js';
import { searchFTSFromKuzu, type BM25SearchResult } from '../../src/core/search/bm25-index.js';

let handle: IndexedDBHandle;

beforeAll(async () => {
  handle = await createTestKuzuDB('search');

  // Seed test data with varying relevance to "user authentication"
  await seedTestData(handle.dbPath, [
    // File nodes — content is the searchable field
    `CREATE (n:File {id: 'file:auth.ts', name: 'auth.ts', filePath: 'src/auth.ts', content: 'authentication module for user login and session management'})`,
    `CREATE (n:File {id: 'file:router.ts', name: 'router.ts', filePath: 'src/router.ts', content: 'HTTP request routing and middleware pipeline'})`,
    `CREATE (n:File {id: 'file:utils.ts', name: 'utils.ts', filePath: 'src/utils.ts', content: 'general utility functions for string manipulation'})`,

    // Function nodes — content + name are searchable
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
  ]);

  // Initialize the core adapter (writable) so we can create FTS indexes
  await initKuzu(handle.dbPath);
  await loadFTSExtension();

  // Create FTS indexes on all searchable tables
  await createFTSIndex('File', 'file_fts', ['name', 'content']);
  await createFTSIndex('Function', 'function_fts', ['name', 'content', 'description']);
  await createFTSIndex('Class', 'class_fts', ['name', 'content', 'description']);
  await createFTSIndex('Method', 'method_fts', ['name', 'content', 'description']);
  await createFTSIndex('Interface', 'interface_fts', ['name', 'content', 'description']);
}, 30000);

afterAll(async () => {
  await handle.cleanup();
});

// ─── Core adapter path (no repoId) ──────────────────────────────────

describe('searchFTSFromKuzu — core adapter (no repoId)', () => {
  it('returns ranked results for a matching query', async () => {
    const results = await searchFTSFromKuzu('user authentication', 10);

    expect(results.length).toBeGreaterThan(0);

    // Every result should have the BM25SearchResult shape
    for (const r of results) {
      expect(r).toHaveProperty('filePath');
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('rank');
      expect(typeof r.filePath).toBe('string');
      expect(typeof r.score).toBe('number');
      expect(typeof r.rank).toBe('number');
      expect(r.score).toBeGreaterThan(0);
    }

    // Ranks should be sequential starting from 1
    results.forEach((r, i) => {
      expect(r.rank).toBe(i + 1);
    });
  });

  it('results are ordered by descending score', async () => {
    const results = await searchFTSFromKuzu('user authentication', 10);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('auth-related files rank higher than unrelated files', async () => {
    const results = await searchFTSFromKuzu('user authentication', 10);
    const filePaths = results.map((r) => r.filePath);

    // src/auth.ts should appear (multiple nodes contribute scores)
    expect(filePaths).toContain('src/auth.ts');

    // If src/utils.ts appears at all, it should rank lower than src/auth.ts
    const authIdx = filePaths.indexOf('src/auth.ts');
    const utilsIdx = filePaths.indexOf('src/utils.ts');
    if (utilsIdx !== -1) {
      expect(authIdx).toBeLessThan(utilsIdx);
    }
  });

  it('merges scores from multiple node types for the same filePath', async () => {
    const results = await searchFTSFromKuzu('user authentication', 20);

    // src/auth.ts has File + Function + Class + Method + Interface nodes
    // Its merged score should be higher than any single-node file
    const authResult = results.find((r) => r.filePath === 'src/auth.ts');
    expect(authResult).toBeDefined();

    // router.ts only has File + Function — should have a lower score
    const routerResult = results.find((r) => r.filePath === 'src/router.ts');
    if (routerResult) {
      expect(authResult!.score).toBeGreaterThan(routerResult.score);
    }
  });

  it('respects limit parameter', async () => {
    const results = await searchFTSFromKuzu('user authentication', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for a non-matching query', async () => {
    const results = await searchFTSFromKuzu('xyzzyplughtwisty', 10);
    expect(results).toEqual([]);
  });
});

// ─── MCP pool adapter path (with repoId) ────────────────────────────

describe('searchFTSFromKuzu — MCP pool adapter (with repoId)', () => {
  beforeAll(async () => {
    // Close the core adapter's writable connection first so the pool
    // can open read-only without lock conflicts.
    const { closeKuzu: closeCoreKuzu } = await import('../../src/core/kuzu/kuzu-adapter.js');
    await closeCoreKuzu();

    // Initialize MCP pool adapter (read-only) for this repoId
    await poolInitKuzu(handle.repoId, handle.dbPath);
  }, 30000);

  it('returns ranked results via pool adapter', async () => {
    const results = await searchFTSFromKuzu('user authentication', 10, handle.repoId);

    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r).toHaveProperty('filePath');
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('rank');
      expect(r.score).toBeGreaterThan(0);
    }

    // Auth file should be present
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
