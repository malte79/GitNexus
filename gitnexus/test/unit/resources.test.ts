import { describe, it, expect, vi } from 'vitest';
import {
  getResourceDefinitions,
  getResourceTemplates,
  readResource,
} from '../../src/mcp/resources.js';

function createMockBackend(overrides: Partial<Record<string, any>> = {}): any {
  return {
    resolveRepo: vi.fn().mockResolvedValue({
      name: 'test-repo',
      repoPath: '/tmp/test-repo',
      lastCommit: 'abc1234',
    }),
    getContext: vi.fn().mockReturnValue({
      projectName: 'test-repo',
      stats: { fileCount: 10, functionCount: 50, communityCount: 3, processCount: 5 },
    }),
    queryClusters: vi.fn().mockResolvedValue({ clusters: [] }),
    queryProcesses: vi.fn().mockResolvedValue({ processes: [] }),
    queryClusterDetail: vi.fn().mockResolvedValue({ error: 'Not found' }),
    queryProcessDetail: vi.fn().mockResolvedValue({ error: 'Not found' }),
    ...overrides,
  };
}

describe('getResourceDefinitions', () => {
  it('returns repo-local static resources', () => {
    const defs = getResourceDefinitions();
    expect(defs.map(d => d.uri)).toEqual([
      'gitnexus://context',
      'gitnexus://clusters',
      'gitnexus://processes',
      'gitnexus://schema',
    ]);
  });
});

describe('getResourceTemplates', () => {
  it('returns repo-local dynamic templates', () => {
    const templates = getResourceTemplates();
    expect(templates.map(t => t.uriTemplate)).toEqual([
      'gitnexus://cluster/{clusterName}',
      'gitnexus://process/{processName}',
    ]);
  });
});

describe('readResource', () => {
  it('routes gitnexus://context correctly', async () => {
    const backend = createMockBackend();
    const result = await readResource('gitnexus://context', backend);
    expect(backend.resolveRepo).toHaveBeenCalled();
    expect(result).toContain('test-repo');
  });

  it('routes gitnexus://schema correctly', async () => {
    const backend = createMockBackend();
    const result = await readResource('gitnexus://schema', backend);
    expect(result).toContain('GitNexus Graph Schema');
  });

  it('routes gitnexus://clusters correctly', async () => {
    const backend = createMockBackend({
      queryClusters: vi.fn().mockResolvedValue({
        clusters: [{ heuristicLabel: 'Auth', symbolCount: 10, cohesion: 0.9 }],
      }),
    });
    const result = await readResource('gitnexus://clusters', backend);
    expect(backend.queryClusters).toHaveBeenCalledWith(100);
    expect(result).toContain('Auth');
  });

  it('routes gitnexus://processes correctly', async () => {
    const backend = createMockBackend({
      queryProcesses: vi.fn().mockResolvedValue({
        processes: [{ heuristicLabel: 'LoginFlow', processType: 'intra_community', stepCount: 3 }],
      }),
    });
    const result = await readResource('gitnexus://processes', backend);
    expect(backend.queryProcesses).toHaveBeenCalledWith(50);
    expect(result).toContain('LoginFlow');
  });

  it('routes gitnexus://cluster/{name} correctly', async () => {
    const backend = createMockBackend({
      queryClusterDetail: vi.fn().mockResolvedValue({
        cluster: { heuristicLabel: 'Auth', symbolCount: 5, cohesion: 0.85 },
        members: [{ name: 'login', type: 'Function', filePath: 'src/auth.ts' }],
      }),
    });
    const result = await readResource('gitnexus://cluster/Auth', backend);
    expect(backend.queryClusterDetail).toHaveBeenCalledWith('Auth');
    expect(result).toContain('login');
  });

  it('routes gitnexus://process/{name} correctly', async () => {
    const backend = createMockBackend({
      queryProcessDetail: vi.fn().mockResolvedValue({
        process: { heuristicLabel: 'LoginFlow', processType: 'intra_community', stepCount: 3 },
        steps: [{ step: 1, name: 'login', filePath: 'src/auth.ts' }],
      }),
    });
    const result = await readResource('gitnexus://process/LoginFlow', backend);
    expect(backend.queryProcessDetail).toHaveBeenCalledWith('LoginFlow');
    expect(result).toContain('login');
  });

  it('throws for unknown resource URI', async () => {
    const backend = createMockBackend();
    await expect(readResource('gitnexus://repo/test/context', backend))
      .rejects.toThrow('Unknown resource URI');
  });
});
