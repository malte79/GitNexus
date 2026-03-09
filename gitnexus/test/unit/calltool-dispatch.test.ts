import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/mcp/core/kuzu-adapter.js', () => ({
  initKuzu: vi.fn().mockResolvedValue(undefined),
  executeQuery: vi.fn().mockResolvedValue([]),
  executeParameterized: vi.fn().mockResolvedValue([]),
  closeKuzu: vi.fn().mockResolvedValue(undefined),
  isKuzuReady: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/storage/repo-manager.js', () => ({
  loadRepo: vi.fn().mockResolvedValue(null),
  resolveRepoBoundary: vi.fn().mockReturnValue({ repoRoot: '/tmp/test-project', worktreeRoot: '/tmp/test-project' }),
}));

vi.mock('../../src/core/search/bm25-index.js', () => ({
  searchFTSFromKuzu: vi.fn().mockResolvedValue([]),
}));

import { LocalBackend, CYPHER_WRITE_RE, isWriteQuery, VALID_RELATION_TYPES } from '../../src/mcp/local/local-backend.js';
import { loadRepo, resolveRepoBoundary } from '../../src/storage/repo-manager.js';
import { initKuzu, executeQuery, executeParameterized, isKuzuReady, closeKuzu } from '../../src/mcp/core/kuzu-adapter.js';

const MOCK_REPO = {
  repoPath: '/tmp/test-project',
  worktreeRoot: '/tmp/test-project',
  storagePath: '/tmp/test-project/.codenexus',
  kuzuPath: '/tmp/test-project/.codenexus/kuzu',
  metaPath: '/tmp/test-project/.codenexus/meta.json',
  runtimePath: '/tmp/test-project/.codenexus/runtime.json',
  config: { version: 1, port: 4747 },
  meta: {
    version: 1,
    indexed_head: 'abc1234567890',
    indexed_branch: 'main',
    indexed_at: '2024-06-01T12:00:00Z',
    indexed_dirty: false,
    worktree_root: '/tmp/test-project',
    stats: { files: 10, nodes: 50, edges: 100, communities: 3, processes: 5 },
  },
};

describe('LocalBackend.init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when a usable repo-local index exists', async () => {
    (loadRepo as any).mockResolvedValue(MOCK_REPO);
    const backend = new LocalBackend();
    const result = await backend.init();
    expect(result).toBe(true);
  });

  it('returns false when no repo boundary exists', async () => {
    (resolveRepoBoundary as any).mockReturnValueOnce(null);
    const backend = new LocalBackend();
    const result = await backend.init();
    expect(result).toBe(false);
  });

  it('returns false when no usable local index exists', async () => {
    (loadRepo as any).mockResolvedValue(null);
    const backend = new LocalBackend();
    const result = await backend.init();
    expect(result).toBe(false);
  });
});

describe('LocalBackend.callTool', () => {
  let backend: LocalBackend;

  beforeEach(async () => {
    vi.clearAllMocks();
    (loadRepo as any).mockResolvedValue(MOCK_REPO);
    backend = new LocalBackend();
    await backend.init();
  });

  it('dispatches query without repo routing', async () => {
    (executeParameterized as any).mockResolvedValue([]);
    const result = await backend.callTool('query', { query: 'auth' });
    expect(result).toHaveProperty('processes');
  });

  it('rejects legacy repo parameters', async () => {
    await expect(backend.callTool('query', { query: 'auth', repo: 'old-repo' }))
      .rejects.toThrow('no longer supported');
  });

  it('throws for unknown tool name', async () => {
    await expect(backend.callTool('list_repos', {}))
      .rejects.toThrow('Unknown tool: list_repos');
  });

  it('returns a bound repo context', () => {
    const context = backend.getContext();
    expect(context?.projectName).toBe('test-project');
    expect(context?.stats.fileCount).toBe(10);
  });

  it('returns null when asking for a different repo id', () => {
    expect(backend.getContext('other-repo')).toBeNull();
  });

  it('calls initKuzu on first tool call', async () => {
    (executeParameterized as any).mockResolvedValue([]);
    await backend.callTool('query', { query: 'test' });
    expect(initKuzu).toHaveBeenCalled();
  });

  it('retries initKuzu if the connection was evicted', async () => {
    (executeParameterized as any).mockResolvedValue([]);
    await backend.callTool('query', { query: 'test' });
    expect(initKuzu).toHaveBeenCalledTimes(1);

    (isKuzuReady as any).mockReturnValueOnce(false);
    await backend.callTool('query', { query: 'test' });
    expect(initKuzu).toHaveBeenCalledTimes(2);
  });

  it('blocks write queries through cypher', async () => {
    const result = await backend.callTool('cypher', { query: 'CREATE (n:Test)' });
    expect(result.error).toContain('Write operations');
  });

  it('allows read queries through cypher', async () => {
    (executeQuery as any).mockResolvedValue([{ name: 'test' }]);
    const result = await backend.callTool('cypher', { query: 'MATCH (n:Function) RETURN n.name AS name' });
    expect(result.markdown).toContain('test');
  });

  it('disconnect clears the bound repo and closes Kuzu', async () => {
    await backend.disconnect();
    expect(closeKuzu).toHaveBeenCalled();
    await expect(backend.callTool('query', { query: 'auth' }))
      .rejects.toThrow('No usable local index');
  });
});

describe('query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executeCypher uses the bound repo', async () => {
    (loadRepo as any).mockResolvedValue(MOCK_REPO);
    (executeQuery as any).mockResolvedValue([]);
    const backend = new LocalBackend();
    await backend.init();
    const result = await backend.executeCypher('MATCH (n) RETURN n LIMIT 1');
    expect(result).toEqual([]);
  });
});

describe('hardening helpers', () => {
  it('CYPHER_WRITE_RE is non-global', () => {
    expect(CYPHER_WRITE_RE.global).toBe(false);
    expect(CYPHER_WRITE_RE.sticky).toBe(false);
  });

  it('isWriteQuery works across multiple calls', () => {
    expect(isWriteQuery('CREATE (n)')).toBe(true);
    expect(isWriteQuery('MATCH (n) RETURN n')).toBe(false);
    expect(isWriteQuery('DELETE n')).toBe(true);
  });

  it('only allows valid relation types in impact filters', () => {
    expect(VALID_RELATION_TYPES.has('CALLS')).toBe(true);
    expect(VALID_RELATION_TYPES.has('STEP_IN_PROCESS')).toBe(false);
  });
});
