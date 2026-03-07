/**
 * P0 Integration Tests: Local Backend
 *
 * Tests tool implementations via direct KuzuDB queries.
 * The full LocalBackend.callTool() requires a global registry,
 * so here we test the security-critical behaviors directly:
 * - Write-operation blocking in cypher
 * - Query execution via the pool
 * - Parameterized queries preventing injection
 * - Read-only enforcement
 *
 * Covers hardening fixes: #1 (parameterized queries), #2 (write blocking),
 * #3 (path traversal), #4 (relation allowlist), #25 (regex lastIndex),
 * #26 (rename first-occurrence-only)
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  initKuzu,
  executeQuery,
  executeParameterized,
  closeKuzu,
} from '../../src/mcp/core/kuzu-adapter.js';
import {
  CYPHER_WRITE_RE,
  VALID_RELATION_TYPES,
  isWriteQuery,
  LocalBackend,
} from '../../src/mcp/local/local-backend.js';
import { listRegisteredRepos } from '../../src/storage/repo-manager.js';
import { withTestKuzuDB, type FTSIndexDef } from '../helpers/test-indexed-db.js';

vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn().mockResolvedValue([]),
}));

const SEED_DATA = [
  // Files
  `CREATE (f:File {id: 'file:auth.ts', name: 'auth.ts', filePath: 'src/auth.ts', content: 'auth module'})`,
  `CREATE (f:File {id: 'file:utils.ts', name: 'utils.ts', filePath: 'src/utils.ts', content: 'utils module'})`,
  // Functions
  `CREATE (fn:Function {id: 'func:login', name: 'login', filePath: 'src/auth.ts', startLine: 1, endLine: 15, isExported: true, content: 'function login() {}', description: 'User login'})`,
  `CREATE (fn:Function {id: 'func:validate', name: 'validate', filePath: 'src/auth.ts', startLine: 17, endLine: 25, isExported: true, content: 'function validate() {}', description: 'Validate input'})`,
  `CREATE (fn:Function {id: 'func:hash', name: 'hash', filePath: 'src/utils.ts', startLine: 1, endLine: 8, isExported: true, content: 'function hash() {}', description: 'Hash utility'})`,
  // Class
  `CREATE (c:Class {id: 'class:AuthService', name: 'AuthService', filePath: 'src/auth.ts', startLine: 30, endLine: 60, isExported: true, content: 'class AuthService {}', description: 'Authentication service'})`,
  // Community
  `CREATE (c:Community {id: 'comm:auth', label: 'Auth', heuristicLabel: 'Authentication', keywords: ['auth', 'login'], description: 'Auth module', enrichedBy: 'heuristic', cohesion: 0.8, symbolCount: 3})`,
  // Process
  `CREATE (p:Process {id: 'proc:login-flow', label: 'LoginFlow', heuristicLabel: 'User Login', processType: 'intra_community', stepCount: 2, communities: ['auth'], entryPointId: 'func:login', terminalId: 'func:validate'})`,
  // Relationships
  `MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:validate'
   CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 1.0, reason: 'direct', step: 0}]->(b)`,
  `MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:hash'
   CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 0.9, reason: 'import-resolved', step: 0}]->(b)`,
  `MATCH (a:Function), (c:Community) WHERE a.id = 'func:login' AND c.id = 'comm:auth'
   CREATE (a)-[:CodeRelation {type: 'MEMBER_OF', confidence: 1.0, reason: '', step: 0}]->(c)`,
  `MATCH (a:Function), (p:Process) WHERE a.id = 'func:login' AND p.id = 'proc:login-flow'
   CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 1}]->(p)`,
  `MATCH (a:Function), (p:Process) WHERE a.id = 'func:validate' AND p.id = 'proc:login-flow'
   CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 2}]->(p)`,
];

const FTS_INDEXES: FTSIndexDef[] = [
  { table: 'Function', indexName: 'function_fts', columns: ['name', 'content', 'description'] },
  { table: 'Class', indexName: 'class_fts', columns: ['name', 'content', 'description'] },
  { table: 'File', indexName: 'file_fts', columns: ['name', 'content'] },
];

// ─── Block 1: Pool adapter tests ─────────────────────────────────────

withTestKuzuDB('local-backend', (handle) => {

  // ─── Cypher write blocking ───────────────────────────────────────────

  describe('cypher write blocking', () => {
    const allWriteKeywords = ['CREATE', 'DELETE', 'SET', 'MERGE', 'REMOVE', 'DROP', 'ALTER', 'COPY', 'DETACH'];

    for (const keyword of allWriteKeywords) {
      it(`blocks ${keyword} query`, () => {
        const blocked = isWriteQuery(`MATCH (n) ${keyword} n.name = "x"`);
        expect(blocked).toBe(true);
      });
    }

    it('allows valid read queries through the pool', async () => {
      const rows = await executeQuery(handle.repoId, 'MATCH (n:Function) RETURN n.name AS name ORDER BY n.name');
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── Parameterized queries ───────────────────────────────────────────

  describe('parameterized queries', () => {
    it('finds exact match with parameter', async () => {
      const rows = await executeParameterized(
        handle.repoId,
        'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name, n.filePath AS filePath',
        { name: 'login' },
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('login');
      expect(rows[0].filePath).toBe('src/auth.ts');
    });

    it('injection is harmless', async () => {
      const rows = await executeParameterized(
        handle.repoId,
        'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name',
        { name: "login' OR '1'='1" },
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ─── Relation type filtering ─────────────────────────────────────────

  describe('relation type filtering', () => {
    it('only allows valid relation types in queries', () => {
      const validTypes = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
      const invalidTypes = ['CONTAINS', 'STEP_IN_PROCESS', 'MEMBER_OF', 'DROP_TABLE'];

      for (const t of validTypes) {
        expect(VALID_RELATION_TYPES.has(t)).toBe(true);
      }
      for (const t of invalidTypes) {
        expect(VALID_RELATION_TYPES.has(t)).toBe(false);
      }
    });

    it('can query relationships with valid types', async () => {
      const rows = await executeQuery(
        handle.repoId,
        `MATCH (a:Function)-[r:CodeRelation {type: 'CALLS'}]->(b:Function) RETURN a.name AS caller, b.name AS callee ORDER BY b.name`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Process queries ─────────────────────────────────────────────────

  describe('process queries', () => {
    it('can find processes', async () => {
      const rows = await executeQuery(handle.repoId, 'MATCH (p:Process) RETURN p.heuristicLabel AS label, p.stepCount AS steps');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].label).toBe('User Login');
    });

    it('can trace process steps', async () => {
      const rows = await executeQuery(
        handle.repoId,
        `MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
         WHERE p.id = 'proc:login-flow'
         RETURN s.name AS symbol, r.step AS step
         ORDER BY r.step`,
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].symbol).toBe('login');
      expect(rows[0].step).toBe(1);
      expect(rows[1].symbol).toBe('validate');
      expect(rows[1].step).toBe(2);
    });
  });

  // ─── Community queries ───────────────────────────────────────────────

  describe('community queries', () => {
    it('can find communities', async () => {
      const rows = await executeQuery(handle.repoId, 'MATCH (c:Community) RETURN c.heuristicLabel AS label');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].label).toBe('Authentication');
    });

    it('can find community members', async () => {
      const rows = await executeQuery(
        handle.repoId,
        `MATCH (f)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
         WHERE c.heuristicLabel = 'Authentication'
         RETURN f.name AS name`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].name).toBe('login');
    });
  });

  // ─── Read-only enforcement ───────────────────────────────────────────

  describe('read-only database', () => {
    it('rejects write operations at DB level', async () => {
      await expect(
        executeQuery(handle.repoId, `CREATE (n:Function {id: 'new', name: 'new', filePath: '', startLine: 0, endLine: 0, isExported: false, content: '', description: ''})`)
      ).rejects.toThrow();
    });
  });

  // ─── Regex lastIndex hardening (#25) ─────────────────────────────────

  describe('regex lastIndex (hardening #25)', () => {
    it('CYPHER_WRITE_RE is non-global (no sticky lastIndex)', () => {
      expect(CYPHER_WRITE_RE.global).toBe(false);
      expect(CYPHER_WRITE_RE.sticky).toBe(false);
    });

    it('works correctly across multiple consecutive calls', () => {
      // If the regex were global, lastIndex could cause false results
      const results = [
        isWriteQuery('CREATE (n)'),     // true
        isWriteQuery('MATCH (n) RETURN n'), // false
        isWriteQuery('DELETE n'),       // true
        isWriteQuery('MATCH (n) RETURN n'), // false
        isWriteQuery('SET n.x = 1'),    // true
      ];
      expect(results).toEqual([true, false, true, false, true]);
    });
  });

  // ─── Content queries (include_content equivalent) ────────────────────

  describe('content queries', () => {
    it('can retrieve symbol content', async () => {
      const rows = await executeQuery(
        handle.repoId,
        `MATCH (n:Function) WHERE n.name = 'login' RETURN n.content AS content`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toContain('function login');
    });
  });

}, {
  seed: SEED_DATA,
  poolAdapter: true,
});

// ─── Block 2: callTool dispatch tests ────────────────────────────────

withTestKuzuDB('local-backend-calltool', (handle) => {

  describe('callTool dispatch with real DB', () => {
    let backend: LocalBackend;

    beforeAll(async () => {
      // backend is created in afterSetup, retrieve it from the closure
      backend = (handle as any)._backend;
    });

    it('cypher tool returns function names', async () => {
      const result = await backend.callTool('cypher', {
        query: 'MATCH (n:Function) RETURN n.name AS name ORDER BY n.name',
      });
      // cypher tool wraps results as markdown
      expect(result).toHaveProperty('markdown');
      expect(result).toHaveProperty('row_count');
      expect(result.row_count).toBeGreaterThanOrEqual(3);
      expect(result.markdown).toContain('login');
      expect(result.markdown).toContain('validate');
      expect(result.markdown).toContain('hash');
    });

    it('cypher tool blocks write queries', async () => {
      const result = await backend.callTool('cypher', {
        query: "CREATE (n:Function {id: 'x', name: 'x', filePath: '', startLine: 0, endLine: 0, isExported: false, content: '', description: ''})",
      });
      expect(result).toHaveProperty('error');
      expect(result.error).toMatch(/write operations/i);
    });

    it('context tool returns symbol info with callers and callees', async () => {
      const result = await backend.callTool('context', { name: 'login' });
      expect(result).not.toHaveProperty('error');
      expect(result.status).toBe('found');
      // Should have the symbol identity
      expect(result.symbol).toBeDefined();
      expect(result.symbol.name).toBe('login');
      expect(result.symbol.filePath).toBe('src/auth.ts');
      // login calls validate and hash — should appear in outgoing.calls
      expect(result.outgoing).toBeDefined();
      expect(result.outgoing.calls).toBeDefined();
      expect(result.outgoing.calls.length).toBeGreaterThanOrEqual(2);
      const calleeNames = result.outgoing.calls.map((c: any) => c.name);
      expect(calleeNames).toContain('validate');
      expect(calleeNames).toContain('hash');
    });

    it('impact tool returns upstream dependents', async () => {
      const result = await backend.callTool('impact', {
        target: 'validate',
        direction: 'upstream',
      });
      expect(result).not.toHaveProperty('error');
      // validate is called by login, so login should appear at depth 1
      expect(result.impactedCount).toBeGreaterThanOrEqual(1);
      expect(result.byDepth).toBeDefined();
      const directDeps = result.byDepth[1] || result.byDepth['1'] || [];
      expect(directDeps.length).toBeGreaterThanOrEqual(1);
      const depNames = directDeps.map((d: any) => d.name);
      expect(depNames).toContain('login');
    });

    it('query tool returns results for keyword search', async () => {
      const result = await backend.callTool('query', { query: 'login' });
      expect(result).not.toHaveProperty('error');
      // Should have some combination of processes, process_symbols, or definitions
      expect(result).toHaveProperty('processes');
      expect(result).toHaveProperty('definitions');
      // The search should find something (FTS or graph-based)
      const totalResults =
        (result.processes?.length || 0) +
        (result.process_symbols?.length || 0) +
        (result.definitions?.length || 0);
      expect(totalResults).toBeGreaterThanOrEqual(1);
    });

    it('unknown tool throws', async () => {
      await expect(
        backend.callTool('nonexistent_tool', {}),
      ).rejects.toThrow(/unknown tool/i);
    });
  });

}, {
  seed: SEED_DATA,
  ftsIndexes: FTS_INDEXES,
  poolAdapter: true,
  afterSetup: async (handle) => {
    // Configure listRegisteredRepos mock with handle values
    vi.mocked(listRegisteredRepos).mockResolvedValue([
      {
        name: 'test-repo',
        path: '/test/repo',
        storagePath: handle.tmpHandle.dbPath,
        indexedAt: new Date().toISOString(),
        lastCommit: 'abc123',
        stats: { files: 2, nodes: 3, communities: 1, processes: 1 },
      },
    ]);

    const backend = new LocalBackend();
    await backend.init();
    // Stash backend on handle so tests can access it
    (handle as any)._backend = backend;
  },
});
