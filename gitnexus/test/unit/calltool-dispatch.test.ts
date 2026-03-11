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

vi.mock('../../src/core/ingestion/roblox/rojo-project.js', () => ({
  loadRojoProjectIndex: vi.fn().mockImplementation(async () => ({
    getTargetsForFile(filePath: string) {
      if (filePath === 'src/shared/Spotlight/SpotlightRegistry.lua') {
        return [{ dataModelPath: 'ReplicatedStorage/Shared/Spotlight/SpotlightRegistry', runtimeArea: 'shared' }];
      }
      if (filePath === 'src/server/Lighting/LightingShowService.lua') {
        return [{ dataModelPath: 'ServerScriptService/Lighting/LightingShowService', runtimeArea: 'server' }];
      }
      if (filePath === 'src/server/Game/UIService.lua') {
        return [{ dataModelPath: 'ServerScriptService/Game/UIService', runtimeArea: 'server' }];
      }
      if (filePath === 'src/client/UI/UIService.lua') {
        return [{ dataModelPath: 'StarterPlayer/StarterPlayerScripts/UI/UIService', runtimeArea: 'client' }];
      }
      if (filePath === 'src/server/WorldBootstrap.server.lua') {
        return [{ dataModelPath: 'ServerScriptService/WorldBootstrap', runtimeArea: 'server' }];
      }
      return [];
    },
  })),
}));

import { LocalBackend, CYPHER_WRITE_RE, isWriteQuery, VALID_RELATION_TYPES } from '../../src/mcp/local/local-backend.js';
import { loadRepo, resolveRepoBoundary } from '../../src/storage/repo-manager.js';
import { initKuzu, executeQuery, executeParameterized, isKuzuReady, closeKuzu } from '../../src/mcp/core/kuzu-adapter.js';
import { searchFTSFromKuzu } from '../../src/core/search/bm25-index.js';

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

  it('ranks Roblox module symbols and includes Roblox-aware summaries', async () => {
    (searchFTSFromKuzu as any).mockImplementation(async (query: string) => {
      if (query === 'SpotlightRegistry') {
        return [
          {
            nodeId: 'module:SpotlightRegistry',
            name: 'SpotlightRegistry',
            type: 'Module',
            filePath: 'src/shared/Spotlight/SpotlightRegistry.lua',
            runtimeArea: 'shared',
            description: 'luau-module:strong:named-return-table',
            score: 3.5,
            rank: 1,
          },
          {
            nodeId: 'file:SpotlightRegistry',
            name: 'SpotlightRegistry.lua',
            type: 'File',
            filePath: 'src/shared/Spotlight/SpotlightRegistry.lua',
            runtimeArea: 'shared',
            score: 2.9,
            rank: 2,
          },
        ];
      }
      if (query === 'lighting show service') {
        return [
          {
            nodeId: 'file:LightingShowService',
            name: 'LightingShowService.lua',
            type: 'File',
            filePath: 'src/server/Lighting/LightingShowService.lua',
            runtimeArea: 'server',
            score: 1.2,
            rank: 1,
          },
          {
            nodeId: 'file:LightingShowArchive',
            name: 'LightingShowService.lua',
            type: 'File',
            filePath: 'docs/archive/LightingShowService.lua',
            score: 3.8,
            rank: 2,
          },
        ];
      }
      if (query === 'world bootstrap') {
        return [
          {
            nodeId: 'file:WorldBootstrapArchive',
            name: 'WorldBootstrap.lua',
            type: 'File',
            filePath: 'docs/archive/WorldBootstrap.lua',
            score: 4.2,
            rank: 1,
          },
          {
            nodeId: 'file:WorldBootstrap',
            name: 'WorldBootstrap.server.lua',
            type: 'File',
            filePath: 'src/server/WorldBootstrap.server.lua',
            runtimeArea: 'server',
            score: 1.3,
            rank: 2,
          },
        ];
      }
      if (query === 'client shared boundary') {
        return [
          {
            nodeId: 'file:ClientSharedBoundaryArchive',
            name: 'ClientSharedBoundary.lua',
            type: 'File',
            filePath: 'docs/archive/ClientSharedBoundary.lua',
            score: 4.1,
            rank: 1,
          },
          {
            nodeId: 'file:UIServiceServer',
            name: 'UIService.lua',
            type: 'File',
            filePath: 'src/server/Game/UIService.lua',
            runtimeArea: 'server',
            score: 1.2,
            rank: 2,
          },
          {
            nodeId: 'file:UIServiceClient',
            name: 'UIService.lua',
            type: 'File',
            filePath: 'src/client/UI/UIService.lua',
            runtimeArea: 'client',
            score: 1.1,
            rank: 3,
          },
        ];
      }
      return [];
    });

    (executeQuery as any).mockImplementation(async (repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n:File)')) {
        return [
          { filePath: 'src/shared/Spotlight/SpotlightRegistry.lua' },
          { filePath: 'src/server/Lighting/LightingShowService.lua' },
          { filePath: 'src/server/Game/UIService.lua' },
          { filePath: 'src/client/UI/UIService.lua' },
          { filePath: 'src/server/WorldBootstrap.server.lua' },
          { filePath: 'docs/archive/LightingShowService.lua' },
          { filePath: 'docs/archive/WorldBootstrap.lua' },
          { filePath: 'docs/archive/ClientSharedBoundary.lua' },
        ];
      }
      return [];
    });

    (executeParameterized as any).mockImplementation(async (repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (m:Module)')) {
        if (params.filePath === 'src/shared/Spotlight/SpotlightRegistry.lua') {
          return [{ name: 'SpotlightRegistry', description: 'luau-module:strong:named-return-table', startLine: 1 }];
        }
        if (params.filePath === 'src/server/Lighting/LightingShowService.lua') {
          return [{ name: 'LightingShowService', description: 'luau-module:strong:named-return-table', startLine: 1 }];
        }
        if (params.filePath === 'src/server/Game/UIService.lua') {
          return [{ name: 'UIService', description: 'luau-module:strong:named-return-table', startLine: 1 }];
        }
        if (params.filePath === 'src/client/UI/UIService.lua') {
          return [{ name: 'handlers', description: 'luau-module:weak:return-table-literal', startLine: 1 }];
        }
        return [];
      }
      if (cypher.includes('MATCH (n:Module)') && cypher.includes('UNION') && params.compactQuery) {
        if (params.compactQuery === 'spotlightregistry') {
          return [
            {
              nodeId: 'module:SpotlightRegistry',
              name: 'SpotlightRegistry',
              type: 'Module',
              filePath: 'src/shared/Spotlight/SpotlightRegistry.lua',
              startLine: 1,
              endLine: 1,
              runtimeArea: 'shared',
              description: 'luau-module:strong:named-return-table',
            },
            {
              nodeId: 'file:SpotlightRegistry',
              name: 'SpotlightRegistry.lua',
              type: 'File',
              filePath: 'src/shared/Spotlight/SpotlightRegistry.lua',
              startLine: 0,
              endLine: 0,
              runtimeArea: 'shared',
              description: '',
            },
          ];
        }
        if (params.compactQuery === 'uiservice') {
          return [
            {
              nodeId: 'module:UIService',
              name: 'UIService',
              type: 'Module',
              filePath: 'src/server/Game/UIService.lua',
              startLine: 1,
              endLine: 1,
              runtimeArea: 'server',
              description: 'luau-module:strong:named-return-table',
            },
            {
              nodeId: 'file:UIServiceServer',
              name: 'UIService.lua',
              type: 'File',
              filePath: 'src/server/Game/UIService.lua',
              startLine: 0,
              endLine: 0,
              runtimeArea: 'server',
              description: '',
            },
            {
              nodeId: 'file:UIServiceClient',
              name: 'UIService.lua',
              type: 'File',
              filePath: 'src/client/UI/UIService.lua',
              startLine: 0,
              endLine: 0,
              runtimeArea: 'client',
              description: '',
            },
          ];
        }
        if (params.compactQuery === 'lightingshowservice') {
          return [
            {
              nodeId: 'module:LightingShowService',
              name: 'LightingShowService',
              type: 'Module',
              filePath: 'src/server/Lighting/LightingShowService.lua',
              startLine: 1,
              endLine: 1,
              runtimeArea: 'server',
              description: 'luau-module:strong:named-return-table',
            },
            {
              nodeId: 'file:LightingShowService',
              name: 'LightingShowService.lua',
              type: 'File',
              filePath: 'src/server/Lighting/LightingShowService.lua',
              startLine: 0,
              endLine: 0,
              runtimeArea: 'server',
              description: '',
            },
          ];
        }
        if (params.compactQuery === 'worldbootstrap') {
          return [
            {
              nodeId: 'file:WorldBootstrap',
              name: 'WorldBootstrap.server.lua',
              type: 'File',
              filePath: 'src/server/WorldBootstrap.server.lua',
              startLine: 0,
              endLine: 0,
              runtimeArea: 'server',
              description: '',
            },
          ];
        }
        return [];
      }
      if (cypher.includes("MATCH (src {filePath: $filePath})-[r:CodeRelation {type: 'IMPORTS'}]->(dst)")) {
        if (params.filePath === 'src/shared/Spotlight/SpotlightRegistry.lua') {
          return [{ name: 'Log', filePath: 'src/shared/Log.lua', runtimeArea: 'shared' }];
        }
        if (params.filePath === 'src/server/Lighting/LightingShowService.lua') {
          return [{ name: 'LightingController', filePath: 'src/shared/Lighting/LightingController.lua', runtimeArea: 'shared' }];
        }
        if (params.filePath === 'src/server/Game/UIService.lua') {
          return [
            { name: 'UIValidation', filePath: 'src/shared/UIValidation.lua', runtimeArea: 'shared' },
            { name: 'UIEvents', filePath: 'src/shared/UIEvents.lua', runtimeArea: 'shared' },
          ];
        }
        return [];
      }
      return [];
    });

    const spotlight = await backend.callTool('query', { query: 'SpotlightRegistry' });
    expect(spotlight.definitions[0]).toMatchObject({
      name: 'SpotlightRegistry',
      type: 'Module',
      module_symbol: 'SpotlightRegistry',
      runtimeArea: 'shared',
      data_model_path: 'ReplicatedStorage/Shared/Spotlight/SpotlightRegistry',
    });

    const lighting = await backend.callTool('query', { query: 'lighting show service' });
    expect(lighting.definitions[0]).toMatchObject({
      name: 'LightingShowService',
      filePath: 'src/server/Lighting/LightingShowService.lua',
      module_symbol: 'LightingShowService',
      runtimeArea: 'server',
      data_model_path: 'ServerScriptService/Lighting/LightingShowService',
    });
    expect(lighting.definitions[0].boundary_imports).toContainEqual({
      name: 'LightingController',
      filePath: 'src/shared/Lighting/LightingController.lua',
      runtimeArea: 'shared',
    });

    const ui = await backend.callTool('query', { query: 'UI service' });
    expect(ui.definitions[0]).toMatchObject({
      name: 'UIService',
      filePath: 'src/server/Game/UIService.lua',
      module_symbol: 'UIService',
      runtimeArea: 'server',
      data_model_path: 'ServerScriptService/Game/UIService',
    });

    const worldBootstrap = await backend.callTool('query', { query: 'world bootstrap' });
    expect(worldBootstrap.definitions[0]).toMatchObject({
      name: 'WorldBootstrap.server.lua',
      filePath: 'src/server/WorldBootstrap.server.lua',
      runtimeArea: 'server',
      data_model_path: 'ServerScriptService/WorldBootstrap',
    });

    const clientSharedBoundary = await backend.callTool('query', { query: 'client shared boundary' });
    expect([
      'src/server/Game/UIService.lua',
      'src/client/UI/UIService.lua',
    ]).toContain(clientSharedBoundary.definitions[0]?.filePath);
    expect(['server', 'client']).toContain(clientSharedBoundary.definitions[0]?.runtimeArea);
    expect(clientSharedBoundary.definitions[0]?.data_model_path).toBeTruthy();
    expect(clientSharedBoundary.definitions[0]?.filePath).not.toBe('docs/archive/ClientSharedBoundary.lua');
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
