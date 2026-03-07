/**
 * P1 Integration Tests: Cluster Enricher & Augmentation Engine
 *
 * Part 1 — Cluster Enricher: enrichClusters / enrichClustersBatch with mock LLM
 *   - Valid JSON response populates enrichments
 *   - Invalid JSON response falls back to heuristic label
 *   - Batch processing with enrichClustersBatch
 *   - Empty members use heuristicLabel fallback
 *
 * Part 2 — Augmentation Engine: augment() against a real indexed KuzuDB
 *   - Matching pattern returns non-empty string with callers/callees
 *   - Non-matching pattern returns empty string
 *   - Pattern shorter than 3 chars returns empty string
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  enrichClusters,
  enrichClustersBatch,
  type LLMClient,
  type ClusterMemberInfo,
} from '../../src/core/ingestion/cluster-enricher.js';
import type { CommunityNode } from '../../src/core/ingestion/community-processor.js';
import {
  createTestKuzuDB,
  seedTestData,
  type IndexedDBHandle,
} from '../helpers/test-indexed-db.js';
import { initKuzu, createFTSIndex, loadFTSExtension } from '../../src/core/kuzu/kuzu-adapter.js';
import { initKuzu as poolInitKuzu } from '../../src/mcp/core/kuzu-adapter.js';

// ═════════════════════════════════════════════════════════════════════
// Part 1: Cluster Enricher
// ═════════════════════════════════════════════════════════════════════

describe('enrichClusters', () => {
  const communities: CommunityNode[] = [
    {
      id: 'comm_0',
      label: 'Auth',
      heuristicLabel: 'Authentication',
      cohesion: 0.8,
      symbolCount: 3,
    },
    {
      id: 'comm_1',
      label: 'Utils',
      heuristicLabel: 'Utilities',
      cohesion: 0.5,
      symbolCount: 2,
    },
  ];

  const memberMap = new Map<string, ClusterMemberInfo[]>([
    [
      'comm_0',
      [
        { name: 'login', filePath: 'src/auth.ts', type: 'Function' },
        { name: 'validate', filePath: 'src/auth.ts', type: 'Function' },
        { name: 'AuthService', filePath: 'src/auth.ts', type: 'Class' },
      ],
    ],
    [
      'comm_1',
      [
        { name: 'hash', filePath: 'src/utils.ts', type: 'Function' },
        { name: 'format', filePath: 'src/utils.ts', type: 'Function' },
      ],
    ],
  ]);

  it('populates enrichments when LLM returns valid JSON', async () => {
    const mockLLM: LLMClient = {
      generate: vi.fn()
        .mockResolvedValueOnce('{"name": "Auth Module", "description": "Handles authentication"}')
        .mockResolvedValueOnce('{"name": "Utility Helpers", "description": "Common utilities"}'),
    };

    const result = await enrichClusters(communities, memberMap, mockLLM);

    expect(result.enrichments.size).toBe(2);

    const auth = result.enrichments.get('comm_0')!;
    expect(auth.name).toBe('Auth Module');
    expect(auth.description).toBe('Handles authentication');

    const utils = result.enrichments.get('comm_1')!;
    expect(utils.name).toBe('Utility Helpers');
    expect(utils.description).toBe('Common utilities');

    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(mockLLM.generate).toHaveBeenCalledTimes(2);
  });

  it('falls back to heuristic label when LLM returns invalid JSON', async () => {
    const badLLM: LLMClient = {
      generate: vi.fn().mockResolvedValue('this is not json at all'),
    };

    const result = await enrichClusters(communities, memberMap, badLLM);

    expect(result.enrichments.size).toBe(2);

    // Invalid JSON -> parseEnrichmentResponse falls back to heuristicLabel
    const auth = result.enrichments.get('comm_0')!;
    expect(auth.name).toBe('Authentication');
    expect(auth.keywords).toEqual([]);
    expect(auth.description).toBe('');

    const utils = result.enrichments.get('comm_1')!;
    expect(utils.name).toBe('Utilities');
  });

  it('uses heuristicLabel fallback for clusters with empty members', async () => {
    const emptyMemberMap = new Map<string, ClusterMemberInfo[]>([
      ['comm_0', []],
      ['comm_1', []],
    ]);

    const mockLLM: LLMClient = {
      generate: vi.fn().mockResolvedValue('{"name": "Should Not Appear", "description": "nope"}'),
    };

    const result = await enrichClusters(communities, emptyMemberMap, mockLLM);

    expect(result.enrichments.size).toBe(2);

    // Empty members -> skip LLM, use heuristic directly
    const auth = result.enrichments.get('comm_0')!;
    expect(auth.name).toBe('Authentication');
    expect(auth.keywords).toEqual([]);
    expect(auth.description).toBe('');

    // LLM should never be called for empty members
    expect(mockLLM.generate).not.toHaveBeenCalled();
  });

  it('calls onProgress callback with correct current/total', async () => {
    const mockLLM: LLMClient = {
      generate: vi.fn().mockResolvedValue('{"name": "X", "description": "Y"}'),
    };
    const progress: Array<[number, number]> = [];

    await enrichClusters(communities, memberMap, mockLLM, (current, total) => {
      progress.push([current, total]);
    });

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('enrichClustersBatch', () => {
  const communities: CommunityNode[] = [
    { id: 'comm_0', label: 'Auth', heuristicLabel: 'Authentication', cohesion: 0.8, symbolCount: 3 },
    { id: 'comm_1', label: 'Utils', heuristicLabel: 'Utilities', cohesion: 0.5, symbolCount: 2 },
    { id: 'comm_2', label: 'Router', heuristicLabel: 'Routing', cohesion: 0.6, symbolCount: 2 },
  ];

  const memberMap = new Map<string, ClusterMemberInfo[]>([
    ['comm_0', [{ name: 'login', filePath: 'src/auth.ts', type: 'Function' }]],
    ['comm_1', [{ name: 'hash', filePath: 'src/utils.ts', type: 'Function' }]],
    ['comm_2', [{ name: 'route', filePath: 'src/router.ts', type: 'Function' }]],
  ]);

  it('processes all clusters in batches and returns enrichments', async () => {
    const batchResponse = JSON.stringify([
      { id: 'comm_0', name: 'Auth Module', keywords: ['auth', 'login'], description: 'Authentication logic' },
      { id: 'comm_1', name: 'Utility Helpers', keywords: ['utils'], description: 'Common utilities' },
    ]);
    const batchResponse2 = JSON.stringify([
      { id: 'comm_2', name: 'HTTP Router', keywords: ['routing'], description: 'Request routing' },
    ]);

    const mockLLM: LLMClient = {
      generate: vi.fn()
        .mockResolvedValueOnce(batchResponse)
        .mockResolvedValueOnce(batchResponse2),
    };

    const result = await enrichClustersBatch(communities, memberMap, mockLLM, 2);

    expect(result.enrichments.size).toBe(3);

    const auth = result.enrichments.get('comm_0')!;
    expect(auth.name).toBe('Auth Module');
    expect(auth.keywords).toEqual(['auth', 'login']);
    expect(auth.description).toBe('Authentication logic');

    const utils = result.enrichments.get('comm_1')!;
    expect(utils.name).toBe('Utility Helpers');

    const router = result.enrichments.get('comm_2')!;
    expect(router.name).toBe('HTTP Router');

    expect(result.tokensUsed).toBeGreaterThan(0);
    // 3 communities with batchSize=2 -> 2 LLM calls
    expect(mockLLM.generate).toHaveBeenCalledTimes(2);
  });

  it('falls back to heuristic labels on batch parse failure', async () => {
    const mockLLM: LLMClient = {
      generate: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };

    const result = await enrichClustersBatch(communities, memberMap, mockLLM, 5);

    // All communities should get heuristic fallback
    expect(result.enrichments.size).toBe(3);
    expect(result.enrichments.get('comm_0')!.name).toBe('Authentication');
    expect(result.enrichments.get('comm_1')!.name).toBe('Utilities');
    expect(result.enrichments.get('comm_2')!.name).toBe('Routing');
  });
});

// ═════════════════════════════════════════════════════════════════════
// Part 2: Augmentation Engine
// ═════════════════════════════════════════════════════════════════════

// Mock repo-manager so augment() finds our test DB
vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn(),
}));

describe('augment()', () => {
  let handle: IndexedDBHandle;
  let augment: (pattern: string, cwd?: string) => Promise<string>;

  beforeAll(async () => {
    handle = await createTestKuzuDB('augment');

    // Seed data: functions with CALLS relationships
    await seedTestData(handle.dbPath, [
      // Files
      `CREATE (n:File {id: 'file:auth.ts', name: 'auth.ts', filePath: 'src/auth.ts', content: 'authentication module for user login'})`,
      `CREATE (n:File {id: 'file:utils.ts', name: 'utils.ts', filePath: 'src/utils.ts', content: 'utility functions for hashing'})`,

      // Functions
      `CREATE (n:Function {id: 'func:login', name: 'login', filePath: 'src/auth.ts', startLine: 1, endLine: 15, isExported: true, content: 'function login authenticates user credentials', description: 'user login'})`,
      `CREATE (n:Function {id: 'func:validate', name: 'validate', filePath: 'src/auth.ts', startLine: 17, endLine: 25, isExported: true, content: 'function validate checks user input', description: 'input validation'})`,
      `CREATE (n:Function {id: 'func:hash', name: 'hash', filePath: 'src/utils.ts', startLine: 1, endLine: 8, isExported: true, content: 'function hash computes bcrypt hash', description: 'password hashing'})`,

      // Classes
      `CREATE (n:Class {id: 'class:AuthService', name: 'AuthService', filePath: 'src/auth.ts', startLine: 30, endLine: 60, isExported: true, content: 'class AuthService handles authentication', description: 'auth service'})`,

      // Methods
      `CREATE (n:Method {id: 'method:AuthService.login', name: 'loginMethod', filePath: 'src/auth.ts', startLine: 35, endLine: 50, isExported: false, content: 'method login in AuthService', description: 'login method'})`,

      // Interfaces
      `CREATE (n:Interface {id: 'iface:Creds', name: 'Credentials', filePath: 'src/auth.ts', startLine: 1, endLine: 5, isExported: true, content: 'interface Credentials for login authentication', description: 'credentials type'})`,

      // Community
      `CREATE (n:Community {id: 'comm:auth', label: 'Auth', heuristicLabel: 'Authentication', keywords: ['auth'], description: 'Auth cluster', enrichedBy: 'heuristic', cohesion: 0.8, symbolCount: 3})`,

      // Process
      `CREATE (n:Process {id: 'proc:login-flow', label: 'LoginFlow', heuristicLabel: 'User Login', processType: 'intra_community', stepCount: 2, communities: ['auth'], entryPointId: 'func:login', terminalId: 'func:validate'})`,

      // CALLS relationships
      `MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:validate'
       CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 1.0, reason: 'direct', step: 0}]->(b)`,
      `MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:hash'
       CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 0.9, reason: 'import-resolved', step: 0}]->(b)`,

      // MEMBER_OF
      `MATCH (a:Function), (c:Community) WHERE a.id = 'func:login' AND c.id = 'comm:auth'
       CREATE (a)-[:CodeRelation {type: 'MEMBER_OF', confidence: 1.0, reason: '', step: 0}]->(c)`,

      // STEP_IN_PROCESS
      `MATCH (a:Function), (p:Process) WHERE a.id = 'func:login' AND p.id = 'proc:login-flow'
       CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 1}]->(p)`,
      `MATCH (a:Function), (p:Process) WHERE a.id = 'func:validate' AND p.id = 'proc:login-flow'
       CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 2}]->(p)`,
    ]);

    // Initialize core adapter (writable) to create FTS indexes
    await initKuzu(handle.dbPath);
    await loadFTSExtension();
    await createFTSIndex('File', 'file_fts', ['name', 'content']);
    await createFTSIndex('Function', 'function_fts', ['name', 'content', 'description']);
    await createFTSIndex('Class', 'class_fts', ['name', 'content', 'description']);
    await createFTSIndex('Method', 'method_fts', ['name', 'content', 'description']);
    await createFTSIndex('Interface', 'interface_fts', ['name', 'content', 'description']);

    // Close core adapter so the pool can open read-only
    const { closeKuzu: closeCoreKuzu } = await import('../../src/core/kuzu/kuzu-adapter.js');
    await closeCoreKuzu();

    // Initialize MCP pool adapter (read-only) for augment() to use
    await poolInitKuzu(handle.repoId, handle.dbPath);

    // Configure mock listRegisteredRepos to return our test DB
    const { listRegisteredRepos } = await import('../../src/storage/repo-manager.js');
    (listRegisteredRepos as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: handle.repoId,
        path: handle.dbPath, // augment uses path.resolve(entry.path) for cwd matching
        storagePath: handle.tmpHandle.dbPath, // parent of 'kuzu' dir
        indexedAt: new Date().toISOString(),
        lastCommit: 'abc123',
      },
    ]);

    // Dynamically import augment after mocks are in place
    const engine = await import('../../src/core/augmentation/engine.js');
    augment = engine.augment;
  }, 30000);

  afterAll(async () => {
    await handle.cleanup();
  });

  it('returns non-empty string with relationship info for a matching pattern', async () => {
    // Use handle.dbPath as cwd so findRepoForCwd matches our test entry
    const result = await augment('login', handle.dbPath);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('[GitNexus]');
    expect(result).toContain('login');
  });

  it('returns empty string for a non-matching pattern', async () => {
    const result = await augment('nonexistent_xyz', handle.dbPath);
    expect(result).toBe('');
  });

  it('returns empty string for patterns shorter than 3 characters', async () => {
    const result = await augment('ab', handle.dbPath);
    expect(result).toBe('');
  });

  it('returns empty string for empty pattern', async () => {
    const result = await augment('', handle.dbPath);
    expect(result).toBe('');
  });
});
