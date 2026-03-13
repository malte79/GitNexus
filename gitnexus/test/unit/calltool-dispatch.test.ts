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

  it('dispatches summary without repo routing', async () => {
    (executeQuery as any).mockImplementation(async (repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (f:File)')) {
        return [{ filePath: 'src/app.py' }, { filePath: 'tests/test_app.py' }];
      }
      if (cypher.includes('RETURN n.id AS id') && cypher.includes('COUNT(*) AS fanIn')) {
        return [
          { id: 'func:main', name: 'main', type: 'Function', filePath: 'scripts/run_runtime_stability_burn_in.py', fanIn: 77 },
          { id: 'func:assertTrue', name: 'assertTrue', type: 'Function', filePath: 'tests/test_handler.py', fanIn: 41 },
          { id: 'class:CommandBridgeHandler', name: 'CommandBridgeHandler', type: 'Class', filePath: 'src/bridge/handler.py', fanIn: 7 },
        ];
      }
      if (cypher.includes('MATCH (c:Community)')) {
        return [{ id: 'comm:bridge', label: 'Bridge', heuristicLabel: 'Bridge', cohesion: 0.9, symbolCount: 12 }];
      }
      if (cypher.includes('MATCH (p:Process)')) {
        return [{ id: 'proc:bridge', label: 'BridgeFlow', heuristicLabel: 'Bridge Flow', processType: 'runtime', stepCount: 4 }];
      }
      return [];
    });

    const result = await backend.callTool('summary', {});
    expect(result.production_vs_test).toEqual({
      production_files: 1,
      test_files: 1,
    });
    expect(result.top_symbols[0]).toMatchObject({
      name: 'CommandBridgeHandler',
      fan_in: 7,
    });
    expect(result.top_symbols).toHaveLength(1);
    expect(result.clusters[0]).toMatchObject({
      heuristicLabel: 'Bridge',
    });
    expect(result.coverage).toMatchObject({
      confidence: 'grounded',
      sections: {
        production_vs_test: 'grounded',
        top_symbols: 'grounded',
        clusters: 'grounded',
        processes: 'grounded',
      },
    });
  });

  it('surfaces partial summary coverage instead of fake empty values when summary queries fail', async () => {
    (executeQuery as any).mockImplementation(async (repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (f:File)')) {
        throw new Error('file scan failed');
      }
      if (cypher.includes('RETURN n.id AS id') && cypher.includes('COUNT(*) AS fanIn')) {
        throw new Error('fan-in failed');
      }
      if (cypher.includes('MATCH (c:Community)')) {
        return [{ id: 'comm:bridge', label: 'Bridge', heuristicLabel: 'Bridge', cohesion: 0.9, symbolCount: 12 }];
      }
      if (cypher.includes('MATCH (p:Process)')) {
        throw new Error('processes failed');
      }
      return [];
    });

    const result = await backend.callTool('summary', {});
    expect(result.production_vs_test).toBeNull();
    expect(result.top_symbols).toBeNull();
    expect(result.clusters[0]).toMatchObject({
      heuristicLabel: 'Bridge',
    });
    expect(result.processes).toBeNull();
    expect(result.coverage.confidence).toBe('partial');
    expect(result.coverage.sections).toMatchObject({
      production_vs_test: 'partial',
      top_symbols: 'partial',
      clusters: 'grounded',
      processes: 'partial',
    });
    expect(result.coverage.notes.join(' ')).toContain('file scan failed');
    expect(result.coverage.notes.join(' ')).toContain('fan-in failed');
    expect(result.coverage.notes.join(' ')).toContain('processes failed');
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
    expect(result.schema_resource).toBe('gitnexus://schema');
  });

  it('allows read queries through cypher', async () => {
    (executeQuery as any).mockResolvedValue([{ name: 'test' }]);
    const result = await backend.callTool('cypher', { query: 'MATCH (n:Function) RETURN n.name AS name' });
    expect(result.markdown).toContain('test');
  });

  it('adds near-miss Cypher guidance for type(r)', async () => {
    (executeQuery as any).mockRejectedValue(new Error('Catalog exception: function TYPE does not exist.'));
    const result = await backend.callTool('cypher', { query: 'MATCH (a)-[r]->(b) RETURN type(r) AS relType' });
    expect(result.error).toContain('TYPE does not exist');
    expect(result.hint).toContain('CodeRelation `type` property');
    expect(result.schema_resource).toBe('gitnexus://schema');
  });

  it('adds property-specific Cypher guidance for missing node properties', async () => {
    (executeQuery as any).mockRejectedValue(new Error('Binder exception: Cannot find property lineCount for f.'));
    const result = await backend.callTool('cypher', { query: "MATCH (f:File) RETURN f.lineCount AS lines" });
    expect(result.error).toContain('lineCount');
    expect(result.hint).toContain('Property `lineCount` is not available on File');
    expect(result.property_resource).toBe('gitnexus://properties/File');
    expect(result.available_properties).toContain('filePath');
  });

  it('demotes test-heavy matches for broad subsystem discovery queries', async () => {
    (searchFTSFromKuzu as any).mockResolvedValue([
      {
        nodeId: 'func:test_matrix',
        name: 'test_execute_smoke_lifecycle_runs_preflight_stop',
        type: 'Function',
        filePath: 'tests/test_run_connected_studio_smoke_matrix.py',
        score: 6.4,
        rank: 1,
      },
      {
        nodeId: 'func:main',
        name: 'main',
        type: 'Function',
        filePath: 'scripts/run_connected_studio_smoke_matrix.py',
        score: 5.7,
        rank: 2,
      },
      {
        nodeId: 'class:CommandBridgeHandler',
        name: 'CommandBridgeHandler',
        type: 'Class',
        filePath: 'typed/bridge/http/runtime/core.py',
        score: 2.2,
        rank: 3,
      },
      {
        nodeId: 'module:TransportClient',
        name: 'TransportClient',
        type: 'Module',
        filePath: 'typed/plugin/runtime/transport_client.lua',
        score: 5.2,
        rank: 4,
      },
    ]);
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n:File)')) {
        return [
          { nodeId: 'file:studio_system_features', name: 'studio_system_features.py', type: 'File', filePath: 'typed/bridge/http/services/studio_system_features.py', startLine: 0, endLine: 0 },
          { nodeId: 'class:CommandBridgeHandler', name: 'CommandBridgeHandler', type: 'Class', filePath: 'typed/bridge/http/runtime/core.py', startLine: 1, endLine: 100 },
        ];
      }
      return [];
    });
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (n:File)') && cypher.includes('lower(n.filePath) CONTAINS $term')) {
        if (params.term === 'studio' || params.term === 'connected') {
          return [{ filePath: 'typed/bridge/http/services/studio_system_features.py' }];
        }
        return [];
      }
      if (cypher.includes('MATCH (m:Module)')) {
        return [];
      }
      if (cypher.includes('MATCH (n:Module)') && cypher.includes('UNION') && params.compactQuery) {
        return [];
      }
      if (cypher.includes("MATCH (src {filePath: $filePath})-[r:CodeRelation {type: 'IMPORTS'}]->(dst)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $nodeId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $nodeId})-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)")) {
        if (params.nodeId === 'class:CommandBridgeHandler') {
          return [{ cohesion: 0.9, module: 'Bridge' }];
        }
        return [];
      }
      return [];
    });

    const result = await backend.callTool('query', { query: 'connected studio smoke matrix test harness playtest log e2e' });
    expect(result.definitions[0]).toMatchObject({
      name: 'studio_system_features.py',
      filePath: 'typed/bridge/http/services/studio_system_features.py',
    });
    expect(result.definitions[0].filePath).not.toContain('tests/');
    expect(result.definitions[0].filePath).not.toBe('typed/plugin/runtime/transport_client.lua');
  });

  it('surfaces member-derived process participation for module containers when direct process edges are missing', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName')) {
        return [{ id: 'module:runtime_manager', name: 'runtime_manager', type: 'Module', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 801, endLine: 806, description: 'luau-module:weak:return-table-literal' }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'DEFINES'}]->(child)")) {
        return [
          { uid: 'method:new', name: 'new', kind: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 67, endLine: 135 },
        ];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation]->(target)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes("MATCH (caller)-[r:CodeRelation]->(child)") && cypher.includes("'method:new'")) {
        return [];
      }
      if (cypher.includes("MATCH (child)-[r:CodeRelation]->(target)") && cypher.includes("'method:new'")) {
        return [];
      }
      if (cypher.includes("MATCH (child)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)") && cypher.includes("'method:new'")) {
        return [{ pid: 'proc:new', label: 'RuntimeManagerNew', step: 1, stepCount: 4, viaMember: 'new' }];
      }
      return [];
    });

    const result = await backend.callTool('context', {
      name: 'runtime_manager',
      file_path: 'typed/plugin/runtime/runtime_manager.lua',
    });
    expect(result.members).toEqual([
      expect.objectContaining({ name: 'new', kind: 'Method' }),
    ]);
    expect(result.processes).toEqual([
      expect.objectContaining({ name: 'RuntimeManagerNew', via_member: 'new' }),
    ]);
    expect(result.coverage.note).toContain('weak returned-table wrapper');
  });

  it('does not infer module members from same-file file definitions when direct module edges are missing', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName')) {
        return [{ id: 'module:runtime_manager', name: 'runtime_manager', type: 'Module', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 801, endLine: 806 }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'DEFINES'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation]->(target)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes("MATCH (caller)-[r:CodeRelation]->(child)") && cypher.includes("'method:new'")) {
        return [{ relType: 'CALLS', uid: 'func:boot', name: 'boot', filePath: 'typed/plugin/runtime/bootstrap.lua', kind: 'Function', viaMember: 'new' }];
      }
      if (cypher.includes("MATCH (child)-[r:CodeRelation]->(target)") && cypher.includes("'method:new'")) {
        return [{ relType: 'CALLS', uid: 'module:TransportClient', name: 'TransportClient', filePath: 'typed/plugin/runtime/transport_client.lua', kind: 'Module', viaMember: 'start' }];
      }
      return [];
    });

    const result = await backend.callTool('context', {
      name: 'runtime_manager',
      file_path: 'typed/plugin/runtime/runtime_manager.lua',
    });
    expect(result.coverage.confidence).toBe('partial');
    expect(result.coverage.note).toContain('graph coverage may still be incomplete');
    expect(result.members).toEqual([]);
    expect(result.incoming).toEqual({});
  });

  it('recovers file members from grounded file definitions when direct file edges are missing', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (n {id: $uid})')) {
        return [{ id: 'file:runtime_manager', name: 'runtime_manager.lua', type: 'File', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 1, endLine: 900 }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'DEFINES'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (f:File {filePath: $filePath})-[r:CodeRelation {type: 'DEFINES'}]->(child)")) {
        expect(params.filePath).toBe('typed/plugin/runtime/runtime_manager.lua');
        return [
          { uid: 'method:new', name: 'new', kind: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 67, endLine: 135 },
          { uid: 'method:start', name: 'start', kind: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 408, endLine: 424 },
          { uid: 'func:nowSeconds', name: 'nowSeconds', kind: 'Function', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 19, endLine: 21 },
        ];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation]->(target)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes("MATCH (caller)-[r:CodeRelation]->(child)") && cypher.includes("'method:new'")) {
        return [{ relType: 'CALLS', uid: 'func:boot', name: 'boot', filePath: 'typed/plugin/runtime/bootstrap.lua', kind: 'Function', viaMember: 'new' }];
      }
      if (cypher.includes("MATCH (child)-[r:CodeRelation]->(target)") && cypher.includes("'method:new'")) {
        return [{ relType: 'CALLS', uid: 'module:TransportClient', name: 'TransportClient', filePath: 'typed/plugin/runtime/transport_client.lua', kind: 'Module', viaMember: 'start' }];
      }
      return [];
    });

    const result = await backend.callTool('context', { uid: 'file:runtime_manager' });
    expect(result.coverage.confidence).toBe('partial');
    expect(result.coverage.note).toContain('grounded file-level definitions');
    expect(result.members.map((member: any) => member.name)).toEqual(['new', 'start']);
    expect(result.incoming.calls[0]).toMatchObject({
      name: 'boot',
      viaMember: 'new',
    });
  });

  it('reports partial context coverage for central Python classes using inferred immediate members when container edges are missing', async () => {
    (executeParameterized as any).mockImplementation(async (repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName')) {
        return [{ id: 'class:CommandBridgeHandler', name: 'CommandBridgeHandler', type: 'Class', filePath: 'src/bridge/handler.py', startLine: 1, endLine: 40 }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes('MATCH (child:Function)') && cypher.includes('child.filePath = $filePath')) {
        return [
          { uid: 'func:dispatch', name: 'dispatch', kind: 'Function', filePath: 'src/bridge/handler.py', startLine: 5, endLine: 20 },
          { uid: 'func:inner_helper', name: 'inner_helper', kind: 'Function', filePath: 'src/bridge/handler.py', startLine: 10, endLine: 12 },
        ];
      }
      if (cypher.includes("MATCH (caller)-[r:CodeRelation]->(n {id: $symId})")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation]->(target)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (caller)-[r:CodeRelation]->(child)') && cypher.includes("child.id IN ['func:dispatch']")) {
        return [{ relType: 'CALLS', uid: 'func:run', name: 'run', filePath: 'src/main.py', kind: 'Function', viaMember: 'dispatch' }];
      }
      if (cypher.includes('MATCH (child)-[r:CodeRelation]->(target)') && cypher.includes("child.id IN ['func:dispatch']")) {
        return [];
      }
      return [];
    });

    const result = await backend.callTool('context', { name: 'CommandBridgeHandler' });
    expect(result.coverage.confidence).toBe('partial');
    expect(result.coverage.note).toContain('immediate container members');
    expect(result.incoming.calls[0]).toMatchObject({
      name: 'run',
      viaMember: 'dispatch',
    });
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      name: 'dispatch',
      kind: 'Function',
    });
  });

  it('reports partial impact coverage for central Python classes using inferred members when no affected symbols are found', async () => {
    (executeParameterized as any).mockImplementation(async (repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName')) {
        return [{ id: 'class:CommandBridgeHandler', name: 'CommandBridgeHandler', type: 'Class', filePath: 'src/bridge/handler.py', startLine: 1, endLine: 40 }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes('MATCH (child:Function)') && cypher.includes('child.filePath = $filePath')) {
        return [{ uid: 'func:dispatch', name: 'dispatch', kind: 'Function', filePath: 'src/bridge/handler.py', startLine: 5, endLine: 10 }];
      }
      return [];
    });
    (executeQuery as any).mockResolvedValue([]);

    const result = await backend.callTool('impact', {
      target: 'CommandBridgeHandler',
      direction: 'upstream',
    });
    expect(result.coverage.confidence).toBe('partial');
    expect(result.target.member_count).toBe(1);
    expect(result.coverage.note).toContain('immediate container members');
    expect(result.risk).toBe('UNKNOWN');
  });

  it('reports affected areas when central-symbol impact lands on file-level callers without process or module memberships', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName')) {
        return [{ id: 'class:CommandBridgeHandler', name: 'CommandBridgeHandler', type: 'Class', filePath: 'src/bridge/handler.py', startLine: 1, endLine: 40 }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes('MATCH (child:Function)') && cypher.includes('child.filePath = $filePath')) {
        return [{ uid: 'func:dispatch', name: 'dispatch', kind: 'Function', filePath: 'src/bridge/handler.py', startLine: 5, endLine: 10 }];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (caller)-[r:CodeRelation]->(n)')) {
        return [
          { sourceId: 'func:dispatch', id: 'File:typed/bridge/http/services/studio_automation.py', name: 'studio_automation.py', type: 'File', filePath: 'typed/bridge/http/services/studio_automation.py', relType: 'CALLS', confidence: 0.5 },
          { sourceId: 'func:dispatch', id: 'File:typed/bridge/http/routes/studio.py', name: 'studio.py', type: 'File', filePath: 'typed/bridge/http/routes/studio.py', relType: 'CALLS', confidence: 0.5 },
        ];
      }
      if (cypher.includes("MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      if (cypher.includes("MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)")) {
        return [];
      }
      return [];
    });

    const result = await backend.callTool('impact', {
      target: 'CommandBridgeHandler',
      direction: 'upstream',
    });
    expect(result.coverage.confidence).toBe('partial');
    expect(result.affected_areas).toEqual([
      { name: 'typed/bridge/http/routes', files: 1 },
      { name: 'typed/bridge/http/services', files: 1 },
    ]);
    expect(result.coverage.note).toContain('typed/bridge/http/routes');
    expect(result.coverage.note).toContain('typed/bridge/http/services');
  });

  it('supports impact disambiguation by file path', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName AND n.filePath CONTAINS $filePath')) {
        return [{ id: 'func:onTransportClosed', name: 'onTransportClosed', type: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 562, endLine: 575 }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation]->(target)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $nodeId})-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)")) {
        return [];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (caller)-[r:CodeRelation]->(n)') && cypher.includes("'func:onTransportClosed'")) {
        return [{ sourceId: 'func:onTransportClosed', id: 'func:handleClose', name: 'handleClose', type: 'Function', filePath: 'typed/plugin/runtime/runtime_core.lua', relType: 'CALLS', confidence: 1 }];
      }
      return [];
    });

    const result = await backend.callTool('impact', {
      target: 'onTransportClosed',
      file_path: 'typed/plugin/runtime/runtime_manager.lua',
      direction: 'upstream',
    });
    expect(result.target).toMatchObject({
      name: 'onTransportClosed',
      filePath: 'typed/plugin/runtime/runtime_manager.lua',
    });
    expect(result.impactedCount).toBe(1);
  });

  it('does not infer impact processes or modules from unrelated same-file symbols', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName')) {
        return [{ id: 'func:onTransportClosed', name: 'onTransportClosed', type: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 562, endLine: 575 }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return [];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (caller)-[r:CodeRelation]->(n)') && cypher.includes("'func:onTransportClosed'")) {
        return [{ sourceId: 'func:onTransportClosed', id: 'func:handleClose', name: 'handleClose', type: 'Function', filePath: 'typed/plugin/runtime/runtime_manager.lua', relType: 'CALLS', confidence: 1 }];
      }
      if (cypher.includes("MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)") && cypher.includes("'func:handleClose'")) {
        return [];
      }
      if (cypher.includes("MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)") && cypher.includes("'func:handleClose'")) {
        return [];
      }
      if (cypher.includes('s.filePath IN')) {
        return [{ name: 'Runtime', hits: 3 }];
      }
      return [];
    });

    const result = await backend.callTool('impact', {
      target: 'onTransportClosed',
      direction: 'upstream',
    });
    expect(result.affected_processes).toEqual([]);
    expect(result.affected_modules).toEqual([]);
    expect(result.summary).toMatchObject({
      processes_affected: 0,
      modules_affected: 0,
    });
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
