/**
 * P0 Integration Tests: Local Backend — callTool dispatch
 *
 * Tests the full LocalBackend.callTool() dispatch with a real KuzuDB
 * instance, verifying cypher, context, impact, and query tools work
 * end-to-end against seeded graph data with FTS indexes.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';
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
