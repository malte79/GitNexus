import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  getRepoState: vi.fn().mockResolvedValue({
    baseState: 'serving_current',
    detailFlags: [],
    meta: {
      indexed_at: '2024-06-01T12:00:00Z',
      indexed_head: 'abc1234567890',
    },
    runtime: null,
    liveHealth: {
      loaded_index: {
        indexed_head: 'abc1234567890',
      },
    },
    currentHead: 'abc1234567890',
  }),
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
import { getRepoState, loadRepo, resolveRepoBoundary } from '../../src/storage/repo-manager.js';
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
    (getRepoState as any).mockResolvedValue({
      baseState: 'serving_current',
      detailFlags: [],
      meta: {
        indexed_at: '2024-06-01T12:00:00Z',
        indexed_head: 'abc1234567890',
      },
      runtime: null,
      liveHealth: {
        loaded_index: {
          indexed_head: 'abc1234567890',
        },
      },
      currentHead: 'abc1234567890',
    });
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

  it('includes subsystem hot anchors and grounded owner candidates in subsystem summary mode', async () => {
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (f:File)')) {
        return [
          { filePath: 'typed/plugin/runtime/runtime_manager.lua' },
          { filePath: 'typed/plugin/runtime/runtime_transport.lua' },
        ];
      }
      if (cypher.includes('RETURN n.id AS id') && cypher.includes('COUNT(*) AS fanIn')) {
        return [{ id: 'class:RuntimeManager', name: 'RuntimeManager', type: 'Module', filePath: 'typed/plugin/runtime/runtime_manager.lua', fanIn: 8 }];
      }
      if (cypher.includes('MATCH (c:Community)')) {
        return [{ id: 'comm:runtime', label: 'Runtime', heuristicLabel: 'Runtime', cohesion: 0.92, symbolCount: 18 }];
      }
      if (cypher.includes('MATCH (p:Process)')) {
        return [];
      }
      if (cypher.includes('MATCH (f:File)-[:CodeRelation {type: \'DEFINES\'}]->(n)')) {
        return [{ filePath: 'typed/plugin/runtime/runtime_manager.lua', id: 'module:RuntimeManager', name: 'RuntimeManager', type: 'Module', fanIn: 8 }];
      }
      if (cypher.includes('MATCH (src)-[r:CodeRelation]->(n)') && cypher.includes('n.filePath IN')) {
        return [
          { id: 'method:onTransportClosed', name: 'onTransportClosed', type: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', fanIn: 12 },
          { id: 'method:bridgeTick', name: 'bridgeTick', type: 'Method', filePath: 'typed/plugin/runtime/runtime_transport.lua', fanIn: 10 },
          { id: 'method:step', name: 'step', type: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', fanIn: 9 },
        ];
      }
      return [];
    });
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('RETURN DISTINCT n.filePath AS filePath')) {
        return [
          { filePath: 'typed/plugin/runtime/runtime_manager.lua' },
          { filePath: 'typed/plugin/runtime/runtime_transport.lua' },
        ];
      }
      if (cypher.includes('RETURN p.heuristicLabel AS label')) {
        return [{ label: 'OnTransportClosed → NowSeconds', hits: 4 }];
      }
      if (cypher.includes('RETURN SIZE(incomingEdges) AS fanIn')) {
        return [{ fanIn: 12, fanOut: 18 }];
      }
      if (cypher.includes('RETURN n.id AS id') && cypher.includes('COUNT(DISTINCT src.id) AS fanIn')) {
        return [{ id: 'module:RuntimeManager', name: 'RuntimeManager', type: 'Module', filePath: 'typed/plugin/runtime/runtime_manager.lua', fanIn: 8 }];
      }
      return [];
    });

    const result = await backend.callTool('summary', { showSubsystems: true, limit: 3 });
    expect(result.subsystems[0].name).toBe('Plugin Runtime');
    expect(result.freshness).toMatchObject({
      state: 'serving_current',
      indexed_commit: 'abc1234567890',
      current_commit: 'abc1234567890',
    });
    expect(result.subsystems[0].top_owners).toContain('Runtime Manager');
    expect(result.subsystems[0].top_hotspots).toContain('Runtime Transport');
    expect(result.subsystems[0].pressure).toEqual(expect.objectContaining({
      fan_in: 12,
      fan_out: 18,
    }));
    expect(result.top_hotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Runtime Transport', subsystem: 'Plugin Runtime' }),
    ]));
    expect(result.top_lifecycle_chokepoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'OnTransportClosed → NowSeconds', subsystem: 'Plugin Runtime' }),
    ]));
    expect(result.top_symbols).toBeUndefined();
  });

  it('respects concise subsystem limits above four', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: Array.from({ length: 6 }, (_value, index) => ({
          name: `Subsystem ${index + 1}`,
          production_files: 1,
          test_files: 0,
          top_owners: [{ id: `Module:owner:${index}`, name: `Owner${index + 1}`, type: 'Module' }],
          hot_anchors: [{ id: `Function:hot:${index}`, name: `hotAnchor${index + 1}`, type: 'Function', filePath: `src/subsystem_${index + 1}.lua` }],
          hot_processes: [{ name: `Process ${index + 1}` }],
          fan_in_pressure: index + 1,
          fan_out_pressure: index + 2,
        })),
      },
      6,
    );

    expect(concise.subsystems).toHaveLength(6);
  });

  it('prefers specific subsystem rows over broad catch-all communities in concise mode', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: [
          {
            name: 'Game',
            production_files: 20,
            test_files: 2,
            top_owners: [{ id: 'File:game', name: 'Game.lua', type: 'File', filePath: 'src/server/Game/Game.lua' }],
            hot_anchors: [],
            hot_processes: [],
            fan_in_pressure: 200,
            fan_out_pressure: 120,
          },
          {
            name: 'Procedural',
            production_files: 10,
            test_files: 0,
            top_owners: [{ id: 'Module:procedural', name: 'ManifestCompiler', type: 'Module', filePath: 'src/server/Lighting/Procedural/ManifestCompiler.lua' }],
            hot_anchors: [],
            hot_processes: [],
            fan_in_pressure: 80,
            fan_out_pressure: 40,
          },
          {
            name: 'Orchestrator',
            production_files: 8,
            test_files: 1,
            top_owners: [{ id: 'Module:orchestrator', name: 'ShowOrchestrator', type: 'Module', filePath: 'src/server/Lighting/Orchestrator/ShowOrchestrator.lua' }],
            hot_anchors: [],
            hot_processes: [],
            fan_in_pressure: 70,
            fan_out_pressure: 50,
          },
          {
            name: 'LobbyRuntimeModules',
            production_files: 7,
            test_files: 0,
            top_owners: [{ id: 'Module:lobby', name: 'RoundCoordinator', type: 'Module', filePath: 'src/server/Game/LobbyRuntimeModules/RoundCoordinator.lua' }],
            hot_anchors: [],
            hot_processes: [],
            fan_in_pressure: 65,
            fan_out_pressure: 35,
          },
          {
            name: 'World',
            production_files: 15,
            test_files: 5,
            top_owners: [{ id: 'File:world', name: 'Paths.lua', type: 'File', filePath: 'src/shared/World/Paths.lua' }],
            hot_anchors: [],
            hot_processes: [],
            fan_in_pressure: 150,
            fan_out_pressure: 100,
          },
        ],
      },
      3,
    );

    expect(concise.subsystems.map((subsystem: any) => subsystem.name)).toEqual([
      'Procedural',
      'Orchestrator',
      'Lobby Runtime',
    ]);
  });

  it('demotes utility-style subsystem rows from concise mode when stronger subsystem rows exist', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: [
          {
            name: 'Log',
            production_files: 12,
            test_files: 4,
            top_owners: [{ id: 'Module:bootstrap', name: 'Bootstrap', type: 'Module', filePath: 'src/server/Game/LobbyRuntimeModules/Bootstrap.lua' }],
            hot_anchors: [{ id: 'File:paths', name: 'Paths.lua', type: 'File', filePath: 'src/shared/World/Paths.lua' }],
            hot_processes: [{ name: 'Run → New' }],
            fan_in_pressure: 300,
            fan_out_pressure: 290,
          },
          {
            name: 'Spotlight',
            production_files: 10,
            test_files: 0,
            top_owners: [{ id: 'Module:spotlight', name: 'SpotlightSweepController', type: 'Module', filePath: 'src/server/Minigames/Spotlight/SweepController.lua' }],
            hot_anchors: [{ id: 'Module:spotlight_runtime', name: 'RuntimeSweep', type: 'Module', filePath: 'src/server/Minigames/Spotlight/Runtime/RuntimeSweep.lua' }],
            hot_processes: [{ name: 'StartSweep → ResolveDanceTarget' }],
            fan_in_pressure: 250,
            fan_out_pressure: 240,
          },
          {
            name: 'Lighting',
            production_files: 9,
            test_files: 1,
            top_owners: [{ id: 'Module:lighting', name: 'ShowOrchestrator', type: 'Module', filePath: 'src/server/Lighting/Orchestrator/ShowOrchestrator.lua' }],
            hot_anchors: [{ id: 'Module:lighting_runtime', name: 'LightingShowServiceRuntime', type: 'Module', filePath: 'src/server/Lighting/LightingShowServiceRuntime.lua' }],
            hot_processes: [{ name: 'StrobePreset → ReadNumber' }],
            fan_in_pressure: 240,
            fan_out_pressure: 180,
          },
          {
            name: 'Bot',
            production_files: 8,
            test_files: 0,
            top_owners: [{ id: 'Module:bot', name: 'BotServiceRuntime', type: 'Module', filePath: 'src/server/Game/BotServiceRuntime.lua' }],
            hot_anchors: [{ id: 'Module:bot_runtime', name: 'BotDanceController', type: 'Module', filePath: 'src/server/Game/Bot/BotDanceController.lua' }],
            hot_processes: [{ name: 'Update → Tick' }],
            fan_in_pressure: 200,
            fan_out_pressure: 170,
          },
        ],
      },
      3,
    );

    expect(concise.subsystems.map((subsystem: any) => subsystem.name)).toEqual([
      'Spotlight',
      'Lighting',
      'Bot',
    ]);
  });

  it('omits obviously unrelated hotspot anchors from concise subsystem rows', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: [
          {
            name: 'Bot',
            production_files: 8,
            test_files: 0,
            top_owners: [{ id: 'Module:bot', name: 'BotServiceRuntime', type: 'Module', filePath: 'src/server/Game/BotServiceRuntime.lua' }],
            hot_anchors: [
              { id: 'File:paths', name: 'Paths.lua', type: 'File', filePath: 'src/shared/World/Paths.lua' },
              { id: 'Module:bot_runtime', name: 'BotDanceController', type: 'Module', filePath: 'src/server/Game/Bot/BotDanceController.lua' },
            ],
            hot_processes: [{ name: 'Update → Tick' }],
            fan_in_pressure: 200,
            fan_out_pressure: 170,
          },
        ],
      },
      1,
    );

    expect(concise.subsystems[0].top_hotspots).toEqual(['Bot Dance Controller']);
    expect(concise.top_hotspots).toEqual([
      { name: 'Bot Dance Controller', subsystem: 'Bot' },
    ]);
  });

  it('keeps acronym subsystem hotspots when the path clearly matches the subsystem', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: [
          {
            name: 'UI',
            production_files: 6,
            test_files: 0,
            top_owners: [{ id: 'Module:ui', name: 'UIService', type: 'Module', filePath: 'src/client/UI/UIService.lua' }],
            hot_anchors: [
              { id: 'Module:winner_pip', name: 'WinnerPip', type: 'Module', filePath: 'src/client/UI/components/WinnerPip.lua' },
            ],
            hot_processes: [{ name: 'OpenMenu → Render' }],
            fan_in_pressure: 120,
            fan_out_pressure: 80,
          },
        ],
      },
      1,
    );

    expect(concise.subsystems[0].top_hotspots).toEqual(['Winner Pip']);
    expect(concise.top_hotspots).toEqual([
      { name: 'Winner Pip', subsystem: 'UI' },
    ]);
  });

  it('prefers architecturally representative owners and hotspots over helper-like labels', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: [
          {
            name: 'Spotlight',
            production_files: 10,
            test_files: 0,
            top_owners: [
              { id: 'Module:centering', name: 'Centering', type: 'Module', filePath: 'src/server/Minigames/Spotlight/Centering.lua', fan_in: 28 },
              { id: 'Module:cage', name: 'Cage', type: 'Module', filePath: 'src/server/Minigames/Spotlight/Cage.lua', fan_in: 31 },
              { id: 'Module:runtime', name: 'SpotlightServiceRuntime', type: 'Module', filePath: 'src/server/Minigames/Spotlight/Runtime/SpotlightServiceRuntime.lua', fan_in: 18 },
            ],
            hot_anchors: [
              { id: 'Module:state', name: 'State', type: 'Module', filePath: 'src/server/Minigames/Spotlight/Runtime/State.lua', fan_in: 52 },
              { id: 'Module:sweep', name: 'SpotlightSweepController', type: 'Module', filePath: 'src/server/Minigames/Spotlight/SweepController.lua', fan_in: 26 },
              { id: 'Module:safe_tiles', name: 'SafeTileController', type: 'Module', filePath: 'src/server/Minigames/Spotlight/SafeTileController.lua', fan_in: 22 },
            ],
            hot_processes: [{ name: 'Run → GetPivot' }],
            fan_in_pressure: 220,
            fan_out_pressure: 190,
          },
        ],
      },
      1,
    );

    expect(concise.subsystems[0].top_owners).toEqual([
      'Spotlight Service Runtime',
    ]);
    expect(concise.subsystems[0].top_hotspots).toEqual([
      'Spotlight Sweep Controller',
      'Safe Tile Controller',
    ]);
    expect(concise.subsystems[0].top_owners).not.toContain('Centering');
    expect(concise.subsystems[0].top_hotspots).not.toContain('State');
  });

  it('recovers representative owners from hotspot containers without reusing owner labels as hotspots', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: [
          {
            name: 'Spotlight',
            production_files: 10,
            test_files: 0,
            top_owners: [
              { id: 'File:cage', name: 'Cage.lua', type: 'File', filePath: 'src/server/Minigames/Spotlight/SafeTile/Cage.lua', fan_in: 0 },
              { id: 'File:centering', name: 'Centering.lua', type: 'File', filePath: 'src/server/Minigames/Spotlight/SafeTile/Centering.lua', fan_in: 0 },
              { id: 'File:main-runtime', name: 'MainRuntime.lua', type: 'File', filePath: 'src/server/Minigames/Spotlight/MainRuntime.lua', fan_in: 0 },
              { id: 'File:runtime-contracts', name: 'RuntimeContracts.lua', type: 'File', filePath: 'src/server/Minigames/Spotlight/Runtime/RuntimeContracts.lua', fan_in: 0 },
            ],
            hot_anchors: [
              { id: 'Method:safe-tiles', name: '_update', type: 'Method', filePath: 'src/server/Minigames/Spotlight/SafeTileController.lua', fan_in: 9 },
              { id: 'Method:runtime-contracts', name: '_transitionPhase', type: 'Method', filePath: 'src/server/Minigames/Spotlight/Runtime/RuntimeContracts.lua', fan_in: 8 },
              { id: 'Method:sweep', name: 'tick', type: 'Method', filePath: 'src/server/Minigames/Spotlight/SweepController.lua', fan_in: 7 },
            ],
            hot_processes: [{ name: 'Run → GetPivot' }],
            fan_in_pressure: 220,
            fan_out_pressure: 190,
          },
        ],
      },
      1,
    );

    expect(concise.subsystems[0].top_owners).toEqual([
      'Safe Tile Controller',
      'Sweep Controller',
    ]);
    expect(concise.subsystems[0].top_hotspots).toEqual([]);
    expect(concise.subsystems[0].top_owners).not.toContain('Main Runtime');
    expect(concise.subsystems[0].top_owners).not.toContain('Runtime Contracts');
    expect(concise.subsystems[0].top_hotspots).not.toContain('Runtime Contracts');
  });

  it('falls back to aligned file-shaped owners when no strong owner clears the preferred threshold', () => {
    const concise = (backend as any).buildConciseSubsystemSummary(
      { stats: { files: 1, nodes: 1, edges: 1, communities: 1, processes: 1 } },
      {
        repo: 'test-repo',
        indexedAt: '2024-06-01T12:00:00Z',
        lastCommit: 'abc1234567890',
        freshness: {
          state: 'serving_current',
          indexed_commit: 'abc1234567890',
          current_commit: 'abc1234567890',
        },
        production_vs_test: { production_files: 10, test_files: 0 },
        subsystems: [
          {
            name: 'UI',
            production_files: 10,
            test_files: 0,
            top_owners: [
              { id: 'File:audio-cues', name: 'AudioCues.lua', type: 'File', filePath: 'src/client/UI/components/AudioCues.lua', fan_in: 0 },
              { id: 'File:countdown', name: 'Countdown.lua', type: 'File', filePath: 'src/client/UI/components/Countdown.lua', fan_in: 0 },
            ],
            hot_anchors: [
              { id: 'Method:disconnect', name: 'Disconnect', type: 'Method', filePath: 'src/client/UI/deviceProfile.lua', fan_in: 41 },
              { id: 'Method:lookAt', name: 'lookAt', type: 'Method', filePath: 'src/server/Game/LaserDomeSolver.lua', fan_in: 15 },
            ],
            hot_processes: [{ name: 'BuildUI → BindHistoryActions' }],
            fan_in_pressure: 198,
            fan_out_pressure: 139,
          },
        ],
      },
      1,
    );

    expect(concise.subsystems[0].top_owners).toEqual([
      'Device Profile',
    ]);
    expect(concise.subsystems[0].top_hotspots).toEqual([]);
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

  it('surfaces grounded backing-container members for weak Luau wrappers that explicitly delegate into a local table', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (n) WHERE n.name = $symName')) {
        return [{
          id: 'module:runtime_manager',
          name: 'runtime_manager',
          type: 'Module',
          filePath: 'typed/plugin/runtime/runtime_manager.lua',
          startLine: 801,
          endLine: 806,
          description: 'luau-module:weak:return-table-literal:backing=RuntimeManager',
        }];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'DEFINES'}]->(child)")) {
        return [
          { uid: 'method:new', name: 'new', kind: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 67, endLine: 135 },
          { uid: 'prop:DEFAULTS', name: 'DEFAULTS', kind: 'Property', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 805, endLine: 805 },
        ];
      }
      if (cypher.includes("container.description = 'luau-module:local-table'")) {
        expect(params.backingContainers).toEqual(['RuntimeManager']);
        return [
          { uid: 'method:start', name: 'start', kind: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 408, endLine: 424, backingContainer: 'RuntimeManager', role: 'backing_container_member' },
          { uid: 'method:stop', name: 'stop', kind: 'Method', filePath: 'typed/plugin/runtime/runtime_manager.lua', startLine: 426, endLine: 443, backingContainer: 'RuntimeManager', role: 'backing_container_member' },
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
      if (cypher.includes("MATCH (caller)-[r:CodeRelation]->(child)") && cypher.includes("'method:start'")) {
        return [{ relType: 'CALLS', uid: 'func:boot', name: 'boot', filePath: 'typed/plugin/runtime/bootstrap.lua', kind: 'Function', viaMember: 'start' }];
      }
      if (cypher.includes("MATCH (child)-[r:CodeRelation]->(target)") && cypher.includes("'method:start'")) {
        return [{ relType: 'CALLS', uid: 'module:Telemetry', name: 'Telemetry', filePath: 'typed/plugin/runtime/telemetry.lua', kind: 'Module', viaMember: 'start' }];
      }
      return [];
    });

    const result = await backend.callTool('context', {
      name: 'runtime_manager',
      file_path: 'typed/plugin/runtime/runtime_manager.lua',
    });
    expect(result.coverage.confidence).toBe('partial');
    expect(result.coverage.note).toContain('backing-container methods');
    expect(result.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'new', kind: 'Method' }),
      expect.objectContaining({ name: 'DEFAULTS', kind: 'Property' }),
      expect.objectContaining({ name: 'start', role: 'backing_container_member', backing_container: 'RuntimeManager' }),
      expect.objectContaining({ name: 'stop', role: 'backing_container_member', backing_container: 'RuntimeManager' }),
    ]));
    expect(result.incoming.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'boot', viaMember: 'start' }),
    ]));
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
      if (cypher.includes("MATCH (f:File)-[:CodeRelation {type: 'DEFINES'}]->(n)")) {
        return [
          { filePath: 'typed/bridge/http/services/studio_automation.py', id: 'func:dispatchStudioCommand', name: 'dispatchStudioCommand', type: 'Function', fanIn: 0, startLine: 20 },
          { filePath: 'typed/bridge/http/routes/studio.py', id: 'func:handleStudioRoute', name: 'handleStudioRoute', type: 'Function', fanIn: 0, startLine: 12 },
        ];
      }
      if (cypher.includes('MATCH (src)-[r:CodeRelation]->(n)') && cypher.includes('n.filePath IN')) {
        return [
          { id: 'func:dispatchStudioCommand', name: 'dispatchStudioCommand', type: 'Function', filePath: 'typed/bridge/http/services/studio_automation.py', fanIn: 7, startLine: 20 },
          { id: 'func:handleStudioRoute', name: 'handleStudioRoute', type: 'Function', filePath: 'typed/bridge/http/routes/studio.py', fanIn: 4, startLine: 12 },
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
    expect(result.affected_areas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'typed/bridge/http/routes',
        files: 1,
        top_owners: expect.arrayContaining([
          expect.objectContaining({ name: 'handleStudioRoute', type: 'Function' }),
        ]),
      }),
      expect.objectContaining({
        name: 'typed/bridge/http/services',
        files: 1,
        top_owners: expect.arrayContaining([
          expect.objectContaining({ name: 'dispatchStudioCommand', type: 'Function' }),
        ]),
      }),
    ]));
    expect(result.coverage.note).toContain('file-level callers');
    expect(result.coverage.note).toContain('grounded owners and hot anchors');
    expect(result.affected_modules).not.toEqual([]);
    expect(result.coverage.signals.higher_level_propagation).toBe('medium');
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

  it('resolves obvious file-basename aliases to the exported module in context', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (n)') && cypher.includes('WHERE n.name = $symName')) {
        return [];
      }
      if (cypher.includes('MATCH (n:Module)') && cypher.includes('UNION') && params.compactQuery === 'sweepcontroller') {
        return [
          {
            id: 'Module:src/server/Minigames/Spotlight/SweepController.lua:SpotlightSweepController:9',
            name: 'SpotlightSweepController',
            type: 'Module',
            filePath: 'src/server/Minigames/Spotlight/SweepController.lua',
            startLine: 9,
            endLine: 9,
            runtimeArea: 'server',
            description: 'luau-module:strong:named-return-table',
          },
          {
            id: 'File:src/server/Minigames/Spotlight/SweepController.lua',
            name: 'SweepController.lua',
            type: 'File',
            filePath: 'src/server/Minigames/Spotlight/SweepController.lua',
            startLine: 0,
            endLine: 0,
            runtimeArea: 'server',
            description: '',
          },
        ];
      }
      if (cypher.includes("MATCH (m:Module)")) {
        return [{ name: 'SpotlightSweepController', description: 'luau-module:strong:named-return-table', startLine: 9 }];
      }
      if (cypher.includes("MATCH (src {filePath: $filePath})-[r:CodeRelation {type: 'IMPORTS'}]->(dst)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'DEFINES'}]->(child)")) {
        return [{ uid: 'Method:src/server/Minigames/Spotlight/SweepController.lua:StartSweep:663', name: 'StartSweep', kind: 'Method', filePath: 'src/server/Minigames/Spotlight/SweepController.lua', startLine: 663, endLine: 872 }];
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
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (f:File)-[:CodeRelation {type: \'DEFINES\'}]->(n)')) {
        return [{
          filePath: 'src/server/Minigames/Spotlight/SweepController.lua',
          id: 'Module:src/server/Minigames/Spotlight/SweepController.lua:SpotlightSweepController:9',
          name: 'SpotlightSweepController',
          type: 'Module',
          fanIn: 8,
          startLine: 9,
        }];
      }
      if (cypher.includes("WHERE n.id IN ['Module:src/server/Minigames/Spotlight/SweepController.lua:SpotlightSweepController:9']")) {
        return [{
          id: 'Module:src/server/Minigames/Spotlight/SweepController.lua:SpotlightSweepController:9',
          name: 'SpotlightSweepController',
          type: 'Module',
          filePath: 'src/server/Minigames/Spotlight/SweepController.lua',
          startLine: 9,
          endLine: 9,
          runtimeArea: 'server',
          description: 'luau-module:strong:named-return-table',
        }];
      }
      if (cypher.includes('MATCH (caller)-[r:CodeRelation]->(child)') || cypher.includes('MATCH (child)-[r:CodeRelation]->(target)')) {
        return [];
      }
      return [];
    });

    const result = await backend.callTool('context', { name: 'SweepController' });
    expect(result.status).toBe('found');
    expect(result.symbol).toMatchObject({
      name: 'SpotlightSweepController',
      filePath: 'src/server/Minigames/Spotlight/SweepController.lua',
    });
  });

  it('reuses basename alias resolution for impact on file-shaped runtime owners', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (n)') && cypher.includes('WHERE n.name = $symName')) {
        return [];
      }
      if (cypher.includes('MATCH (n:Module)') && cypher.includes('UNION') && params.compactQuery === 'orchestratorplaybackruntime') {
        return [
          {
            id: 'Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24',
            name: 'PlaybackRuntime',
            type: 'Module',
            filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
            startLine: 24,
            endLine: 24,
            runtimeArea: 'server',
            description: 'luau-module:strong:named-return-table',
          },
          {
            id: 'File:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
            name: 'OrchestratorPlaybackRuntime.lua',
            type: 'File',
            filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
            startLine: 0,
            endLine: 0,
            runtimeArea: 'server',
            description: '',
          },
        ];
      }
      if (cypher.includes("MATCH (m:Module)")) {
        return [{ name: 'PlaybackRuntime', description: 'luau-module:strong:named-return-table', startLine: 24 }];
      }
      if (cypher.includes("MATCH (src {filePath: $filePath})-[r:CodeRelation {type: 'IMPORTS'}]->(dst)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)")) {
        return [];
      }
      if (cypher.includes("MATCH (n {id: $symId})-[r:CodeRelation {type: 'DEFINES'}]->(child)")) {
        return [];
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
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (f:File)-[:CodeRelation {type: \'DEFINES\'}]->(n)')) {
        return [{
          filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
          id: 'Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24',
          name: 'PlaybackRuntime',
          type: 'Module',
          fanIn: 6,
          startLine: 24,
        }];
      }
      if (cypher.includes("WHERE n.id IN ['Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24']")) {
        return [{
          id: 'Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24',
          name: 'PlaybackRuntime',
          type: 'Module',
          filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
          startLine: 24,
          endLine: 24,
          runtimeArea: 'server',
          description: 'luau-module:strong:named-return-table',
        }];
      }
      if (cypher.includes('MATCH (caller)-[r:CodeRelation]->(n)')) {
        return [{
          sourceId: 'Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24',
          id: 'Function:src/server/Lighting/Orchestrator/ShowOrchestrator.lua:runPlayback:77',
          name: 'runPlayback',
          type: 'Function',
          filePath: 'src/server/Lighting/Orchestrator/ShowOrchestrator.lua',
          relType: 'CALLS',
          confidence: 1,
        }];
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
      target: 'OrchestratorPlaybackRuntime',
      direction: 'upstream',
    });
    expect(result.error).toBeUndefined();
    expect(result.target).toMatchObject({
      name: 'PlaybackRuntime',
      filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
    });
  });

  it('keeps alias resolution explicit when shorthand matches multiple files', async () => {
    (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string, params: Record<string, any>) => {
      if (cypher.includes('MATCH (n)') && cypher.includes('WHERE n.name = $symName')) {
        return [];
      }
      if (cypher.includes('MATCH (n:Module)') && cypher.includes('UNION') && params.compactQuery === 'playbackruntime') {
        return [
          {
            id: 'Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24',
            name: 'PlaybackRuntime',
            type: 'Module',
            filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
            startLine: 24,
            endLine: 24,
            runtimeArea: 'server',
            description: 'luau-module:strong:named-return-table',
          },
          {
            id: 'Module:src/server/Game/LaserRuntime/VisualRuntime.lua:PlaybackRuntime:9',
            name: 'PlaybackRuntime',
            type: 'Module',
            filePath: 'src/server/Game/LaserRuntime/VisualRuntime.lua',
            startLine: 9,
            endLine: 9,
            runtimeArea: 'server',
            description: 'luau-module:strong:named-return-table',
          },
        ];
      }
      if (cypher.includes("MATCH (m:Module)")) {
        return [];
      }
      return [];
    });
    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (f:File)-[:CodeRelation {type: \'DEFINES\'}]->(n)')) {
        return [
          {
            filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
            id: 'Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24',
            name: 'PlaybackRuntime',
            type: 'Module',
            fanIn: 6,
            startLine: 24,
          },
          {
            filePath: 'src/server/Game/LaserRuntime/VisualRuntime.lua',
            id: 'Module:src/server/Game/LaserRuntime/VisualRuntime.lua:PlaybackRuntime:9',
            name: 'PlaybackRuntime',
            type: 'Module',
            fanIn: 5,
            startLine: 9,
          },
        ];
      }
      if (cypher.includes('WHERE n.id IN')) {
        return [
          {
            id: 'Module:src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua:PlaybackRuntime:24',
            name: 'PlaybackRuntime',
            type: 'Module',
            filePath: 'src/server/Lighting/Orchestrator/OrchestratorPlaybackRuntime.lua',
            startLine: 24,
            endLine: 24,
            runtimeArea: 'server',
            description: 'luau-module:strong:named-return-table',
          },
          {
            id: 'Module:src/server/Game/LaserRuntime/VisualRuntime.lua:PlaybackRuntime:9',
            name: 'PlaybackRuntime',
            type: 'Module',
            filePath: 'src/server/Game/LaserRuntime/VisualRuntime.lua',
            startLine: 9,
            endLine: 9,
            runtimeArea: 'server',
            description: 'luau-module:strong:named-return-table',
          },
        ];
      }
      return [];
    });

    const result = await backend.callTool('context', { name: 'PlaybackRuntime' });
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('keeps overload line counts index-consistent when freshness is stale', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codenexus-shape-'));
    try {
      const relativeFilePath = 'src/demo.lua';
      const absoluteFilePath = path.join(tempRoot, relativeFilePath);
      fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
      fs.writeFileSync(absoluteFilePath, Array.from({ length: 50 }, (_v, i) => `line ${i + 1}`).join('\n'));

      (getRepoState as any).mockResolvedValue({
        baseState: 'indexed_stale',
        detailFlags: ['head_changed'],
        meta: {
          indexed_at: '2024-06-01T12:00:00Z',
          indexed_head: 'abc1234567890',
        },
        runtime: null,
        liveHealth: null,
        currentHead: 'def9876543210',
      });
      (executeParameterized as any).mockImplementation(async (_repoId: string, cypher: string) => {
        if (cypher.includes('MATCH (n)') && cypher.includes('RETURN n.id AS id')) {
          return [
            { id: 'Function:src/demo.lua:alpha:1', name: 'alpha', kind: '', startLine: 1, endLine: 8 },
            { id: 'Function:src/demo.lua:beta:10', name: 'beta', kind: '', startLine: 10, endLine: 20 },
          ];
        }
        if (cypher.includes("MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)")) {
          return [];
        }
        return [];
      });

      const shape = await (backend as any).getShapeSignals(
        { id: 'repo:test', repoPath: tempRoot },
        relativeFilePath,
      );

      expect(shape.file.line_count).toBe(20);
      expect(shape.file.function_count).toBe(2);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
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

  it('separates change risk from local refactor pressure for central facade seams', async () => {
    vi.spyOn(backend as any, 'context').mockResolvedValue({
      symbol: {
        id: 'Module:src/shared/World/Paths.lua:Paths:4',
        name: 'Paths',
        type: 'Module',
        filePath: 'src/shared/World/Paths.lua',
        startLine: 4,
        endLine: 28,
      },
    });
    vi.spyOn(backend as any, 'getContainedMembers').mockResolvedValue({
      rows: [],
      inferred: false,
      source: 'contains',
    });
    vi.spyOn(backend as any, 'getShapeSignals').mockResolvedValue({
      file: {
        line_count: 28,
        function_count: 4,
        largest_members: [],
        average_lines_per_function: 7,
        hotspot_share: 0.429,
        concentration: 'high',
        grounded_extraction_seams: [],
      },
    });
    vi.spyOn(backend as any, 'getDetailedAffectedAreas').mockResolvedValue([]);

    (executeQuery as any).mockImplementation(async (_repoId: string, cypher: string) => {
      if (cypher.includes('MATCH (caller)-[r:CodeRelation]->(n)')) {
        return Array.from({ length: 35 }, (_value, index) => ({
          sourceId: 'Module:src/shared/World/Paths.lua:Paths:4',
          id: `Method:caller:${index}`,
          name: `caller${index}`,
          type: 'Method',
          filePath: `src/server/Game/Caller${index}.lua`,
          relType: 'CALLS',
          confidence: 0.9,
        }));
      }
      if (cypher.includes("MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)")) {
        return Array.from({ length: 20 }, (_value, index) => ({
          name: `Process ${index + 1}`,
          hits: 1,
          minStep: 1,
          stepCount: 5,
        }));
      }
      if (cypher.includes("MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)")) {
        return Array.from({ length: 5 }, (_value, index) => ({
          name: `Subsystem ${index + 1}`,
          hits: 1,
        }));
      }
      return [];
    });

    const result = await backend.callTool('impact', {
      target: 'Paths',
      direction: 'upstream',
    });

    expect(result.risk).toBe('CRITICAL');
    expect(result.risk_split).toEqual(expect.objectContaining({
      summary_line: 'change risk: critical; local refactor pressure: low',
      change_risk: expect.objectContaining({ level: 'critical' }),
      refactor_pressure: expect.objectContaining({ level: 'low' }),
    }));
    expect(result.risk_split.refactor_pressure.drivers).toEqual(expect.objectContaining({
      file_size: 'low',
      function_surface: 'low',
      local_concentration: 'low',
      extraction_seams: 'low',
    }));
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
