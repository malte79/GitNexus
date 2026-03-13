import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import kuzu from 'kuzu';
import { createTempDir, type TestDBHandle } from '../helpers/test-db.js';
import {
  initKuzu,
  executeQuery,
  executeParameterized,
  closeKuzu,
} from '../../src/mcp/core/kuzu-adapter.js';
import { NODE_SCHEMA_QUERIES, REL_SCHEMA_QUERIES } from '../../src/core/kuzu/schema.js';
import {
  CYPHER_WRITE_RE,
  VALID_RELATION_TYPES,
  isWriteQuery,
} from '../../src/mcp/local/local-backend.js';

export interface LocalBackendIntegrationContext {
  repoId: string;
  tmpHandle: TestDBHandle;
  dbPath: string;
  ownerFilePath: string;
}

export interface LocalBackendIntegrationCase {
  name: string;
  run: (ctx: LocalBackendIntegrationContext) => Promise<void> | void;
}

const REPO_ID = 'backend-test';
export const LOCAL_BACKEND_OWNER_FILE = '.local-backend-owner.json';

async function createTestDB(dbDir: string): Promise<void> {
  const db = new kuzu.Database(dbDir);
  const conn = new kuzu.Connection(db);

  for (const q of NODE_SCHEMA_QUERIES) {
    await conn.query(q);
  }
  for (const q of REL_SCHEMA_QUERIES) {
    await conn.query(q);
  }

  await conn.query(`CREATE (f:File {id: 'file:auth.ts', name: 'auth.ts', filePath: 'src/auth.ts', content: 'auth module'})`);
  await conn.query(`CREATE (f:File {id: 'file:utils.ts', name: 'utils.ts', filePath: 'src/utils.ts', content: 'utils module'})`);
  await conn.query(`CREATE (fn:Function {id: 'func:login', name: 'login', filePath: 'src/auth.ts', startLine: 1, endLine: 15, isExported: true, content: 'function login() {}', description: 'User login'})`);
  await conn.query(`CREATE (fn:Function {id: 'func:validate', name: 'validate', filePath: 'src/auth.ts', startLine: 17, endLine: 25, isExported: true, content: 'function validate() {}', description: 'Validate input'})`);
  await conn.query(`CREATE (fn:Function {id: 'func:hash', name: 'hash', filePath: 'src/utils.ts', startLine: 1, endLine: 8, isExported: true, content: 'function hash() {}', description: 'Hash utility'})`);
  await conn.query(`CREATE (c:Class {id: 'class:AuthService', name: 'AuthService', filePath: 'src/auth.ts', startLine: 30, endLine: 60, isExported: true, content: 'class AuthService {}', description: 'Authentication service'})`);
  await conn.query(`CREATE (c:Community {id: 'comm:auth', label: 'Auth', heuristicLabel: 'Authentication', keywords: ['auth', 'login'], description: 'Auth module', enrichedBy: 'heuristic', cohesion: 0.8, symbolCount: 3})`);
  await conn.query(`CREATE (p:Process {id: 'proc:login-flow', label: 'LoginFlow', heuristicLabel: 'User Login', processType: 'intra_community', stepCount: 2, communities: ['auth'], entryPointId: 'func:login', terminalId: 'func:validate'})`);

  await conn.query(`
    MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:validate'
    CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 1.0, reason: 'direct', step: 0}]->(b)
  `);
  await conn.query(`
    MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:hash'
    CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 0.9, reason: 'import-resolved', step: 0}]->(b)
  `);
  await conn.query(`
    MATCH (a:Function), (c:Community) WHERE a.id = 'func:login' AND c.id = 'comm:auth'
    CREATE (a)-[:CodeRelation {type: 'MEMBER_OF', confidence: 1.0, reason: '', step: 0}]->(c)
  `);
  await conn.query(`
    MATCH (a:Function), (p:Process) WHERE a.id = 'func:login' AND p.id = 'proc:login-flow'
    CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 1}]->(p)
  `);
  await conn.query(`
    MATCH (a:Function), (p:Process) WHERE a.id = 'func:validate' AND p.id = 'proc:login-flow'
    CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 2}]->(p)
  `);

  conn.close();
  db.close();
}

export async function setupLocalBackendIntegration(): Promise<LocalBackendIntegrationContext> {
  const tmpHandle = await createTempDir('backend-test-');
  const dbPath = path.join(tmpHandle.dbPath, 'kuzu');
  const ownerFilePath = path.join(tmpHandle.dbPath, LOCAL_BACKEND_OWNER_FILE);
  await fs.writeFile(ownerFilePath, JSON.stringify({
    pid: process.pid,
    startedAt: Date.now(),
  }));
  await createTestDB(dbPath);
  await initKuzu(REPO_ID, dbPath);
  return { repoId: REPO_ID, tmpHandle, dbPath, ownerFilePath };
}

export async function cleanupLocalBackendIntegration(
  ctx: LocalBackendIntegrationContext,
  options: { closePool?: boolean } = {},
): Promise<void> {
  if (options.closePool) {
    await closeKuzu(ctx.repoId);
  }
  try {
    await ctx.tmpHandle.cleanup();
  } catch {
    // best-effort cleanup
  }
}

export const LOCAL_BACKEND_INTEGRATION_CASES: LocalBackendIntegrationCase[] = [
  ...['CREATE', 'DELETE', 'SET', 'MERGE', 'REMOVE', 'DROP', 'ALTER', 'COPY', 'DETACH'].map((keyword) => ({
    name: `blocks ${keyword} query`,
    run: () => {
      assert.equal(isWriteQuery(`MATCH (n) ${keyword} n.name = "x"`), true);
    },
  })),
  {
    name: 'allows valid read queries through the pool',
    run: async (ctx) => {
      const rows = await executeQuery(ctx.repoId, 'MATCH (n:Function) RETURN n.name AS name ORDER BY n.name');
      assert.ok(rows.length >= 3);
    },
  },
  {
    name: 'finds exact match with parameter',
    run: async (ctx) => {
      const rows = await executeParameterized(
        ctx.repoId,
        'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name, n.filePath AS filePath',
        { name: 'login' },
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'login');
      assert.equal(rows[0].filePath, 'src/auth.ts');
    },
  },
  {
    name: 'injection is harmless',
    run: async (ctx) => {
      const rows = await executeParameterized(
        ctx.repoId,
        'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name',
        { name: "login' OR '1'='1" },
      );
      assert.equal(rows.length, 0);
    },
  },
  {
    name: 'only allows valid relation types in queries',
    run: () => {
      for (const t of ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']) {
        assert.equal(VALID_RELATION_TYPES.has(t), true);
      }
      for (const t of ['CONTAINS', 'STEP_IN_PROCESS', 'MEMBER_OF', 'DROP_TABLE']) {
        assert.equal(VALID_RELATION_TYPES.has(t), false);
      }
    },
  },
  {
    name: 'can query relationships with valid types',
    run: async (ctx) => {
      const rows = await executeQuery(
        ctx.repoId,
        `MATCH (a:Function)-[r:CodeRelation {type: 'CALLS'}]->(b:Function) RETURN a.name AS caller, b.name AS callee ORDER BY b.name`,
      );
      assert.ok(rows.length >= 2);
    },
  },
  {
    name: 'can find processes',
    run: async (ctx) => {
      const rows = await executeQuery(ctx.repoId, 'MATCH (p:Process) RETURN p.heuristicLabel AS label, p.stepCount AS steps');
      assert.ok(rows.length >= 1);
      assert.equal(rows[0].label, 'User Login');
    },
  },
  {
    name: 'can trace process steps',
    run: async (ctx) => {
      const rows = await executeQuery(
        ctx.repoId,
        `MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
         WHERE p.id = 'proc:login-flow'
         RETURN s.name AS symbol, r.step AS step
         ORDER BY r.step`,
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].symbol, 'login');
      assert.equal(rows[0].step, 1);
      assert.equal(rows[1].symbol, 'validate');
      assert.equal(rows[1].step, 2);
    },
  },
  {
    name: 'can find communities',
    run: async (ctx) => {
      const rows = await executeQuery(ctx.repoId, 'MATCH (c:Community) RETURN c.heuristicLabel AS label');
      assert.ok(rows.length >= 1);
      assert.equal(rows[0].label, 'Authentication');
    },
  },
  {
    name: 'can find community members',
    run: async (ctx) => {
      const rows = await executeQuery(
        ctx.repoId,
        `MATCH (f)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
         WHERE c.heuristicLabel = 'Authentication'
         RETURN f.name AS name`,
      );
      assert.ok(rows.length >= 1);
      assert.equal(rows[0].name, 'login');
    },
  },
  {
    name: 'rejects write operations at DB level',
    run: async (ctx) => {
      await assert.rejects(
        () => executeQuery(ctx.repoId, `CREATE (n:Function {id: 'new', name: 'new', filePath: '', startLine: 0, endLine: 0, isExported: false, content: '', description: ''})`),
      );
    },
  },
  {
    name: 'CYPHER_WRITE_RE is non-global (no sticky lastIndex)',
    run: () => {
      assert.equal(CYPHER_WRITE_RE.global, false);
      assert.equal(CYPHER_WRITE_RE.sticky, false);
    },
  },
  {
    name: 'works correctly across multiple consecutive calls',
    run: () => {
      assert.deepEqual(
        [
          isWriteQuery('CREATE (n)'),
          isWriteQuery('MATCH (n) RETURN n'),
          isWriteQuery('DELETE n'),
          isWriteQuery('MATCH (n) RETURN n'),
          isWriteQuery('SET n.x = 1'),
        ],
        [true, false, true, false, true],
      );
    },
  },
  {
    name: 'can retrieve symbol content',
    run: async (ctx) => {
      const rows = await executeQuery(
        ctx.repoId,
        `MATCH (n:Function) WHERE n.name = 'login' RETURN n.content AS content`,
      );
      assert.equal(rows.length, 1);
      assert.match(String(rows[0].content), /function login/);
    },
  },
];
