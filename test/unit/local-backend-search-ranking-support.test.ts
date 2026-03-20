import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalBackendSearchRankingSupport } from '../../src/mcp/local/local-backend-search-ranking-support.js';

vi.mock('../../src/mcp/core/kuzu-adapter.js', () => ({
  executeParameterized: vi.fn(async () => []),
  executeQuery: vi.fn(async () => []),
}));

const repo = {
  id: 'repo',
  repoPath: '/repo',
} as any;

function createRankingSupport() {
  const host = {
    rojoProjectCache: new Map(),
    ensureInitialized: vi.fn(),
    getOwnerSymbolsForFiles: vi.fn(),
    getNodeKind: vi.fn((row: { type?: string; kind?: string }, fallback?: string) => row.type || row.kind || fallback || 'File'),
    isOwnerLikeSymbolKind: vi.fn((kind: string) => kind === 'Module' || kind === 'Class' || kind === 'File'),
    isPrimaryOwnerKind: vi.fn(),
    isLikelyProductionFile: vi.fn((filePath: string) => filePath.startsWith('src/')),
    isLikelyCodeFile: vi.fn((filePath: string) => filePath.endsWith('.ts') || filePath.endsWith('.lua') || filePath.endsWith('.luau')),
    isPrimarySourceFile: vi.fn((filePath: string) => filePath.startsWith('src/server/') || filePath.startsWith('src/shared/')),
    isLowSignalSummarySymbol: vi.fn(),
    getOwnerSymbolPriority: vi.fn(),
    rankOwnerCandidates: vi.fn((owners: any[]) => owners),
    rankRepresentativeSymbols: vi.fn((symbols: any[]) => symbols),
  } as any;

  const lookup = {
    normalizeSearchText(value: string) {
      return value
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_./-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    },
    getSplitWordAlias(value: string) {
      return this.normalizeSearchText(
        value
          .replace(/\.(client|server)$/i, '')
          .replace(/\.(lua|luau|ts)$/i, ''),
      );
    },
    getExactAliasCandidates: vi.fn(async () => []),
  } as any;

  const enrichment = {
    getRojoTarget: vi.fn(() => undefined),
    isRojoMappedResult: vi.fn(() => false),
    getRojoProjectIndex: vi.fn(async () => null),
    getPrimaryModuleSymbols: vi.fn(async () => new Map()),
    getBoundaryImports: vi.fn(async () => new Map()),
    getBroadQueryFileSignals: vi.fn(async () => new Map()),
  } as any;

  const ranking = new LocalBackendSearchRankingSupport(host, lookup, enrichment);
  vi.spyOn(ranking as any, 'getBroadAnchorCandidates').mockResolvedValue([]);
  vi.spyOn(ranking as any, 'buildEnrichment').mockResolvedValue({
    rojoProject: null,
    primaryModules: new Map<string, string>(),
    boundaryImports: new Map(),
    broadQueryFileSignals: new Map(),
    anchorFiles: new Set(),
    preferMappedResults: false,
  });

  return { ranking, lookup };
}

describe('LocalBackendSearchRankingSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers owner-like laser candidates over spotlight methods for broad owners-mode prompts', async () => {
    const { ranking } = createRankingSupport();
    const searchQuery = 'make all four death lasers continuously slide back and forth along their own rails at all times with a default 8-second traverse, 1-second decel at the end, 1-second pause, and 1-second accel away from the end, preserving authored orientation and allowing minigame beam state to layer on top';
    const rawResults = [
      {
        nodeId: 'spotlight-method',
        name: 'computePlateTopY',
        type: 'Method',
        filePath: 'src/server/Minigames/Spotlight/Sweep/Geometry.lua',
        bm25Score: 4,
        score: 4,
      },
      {
        nodeId: 'spotlight-function',
        name: 'computeBeamTextureLengthForTilesLit',
        type: 'Function',
        filePath: 'src/shared/Spotlight/SpotlightFixture.lua',
        bm25Score: 4.5,
        score: 4.5,
      },
      {
        nodeId: 'laser-start',
        name: 'start',
        type: 'Method',
        filePath: 'src/server/Minigames/Laser/MainRuntime.lua',
        bm25Score: 4.2,
        score: 4.2,
      },
      {
        nodeId: 'laser-playtest',
        name: 'LaserMinigameV1',
        type: 'Module',
        filePath: 'src/server/Playtest/Scenarios/LaserMinigameV1.lua',
        bm25Score: 4.3,
        score: 4.3,
      },
      {
        nodeId: 'laser-controller',
        name: 'LaserCannonController',
        type: 'Module',
        filePath: 'src/server/Game/LaserCannonController.lua',
        bm25Score: 3.4,
        score: 3.4,
      },
      {
        nodeId: 'laser-runtime',
        name: 'ControllerRuntime',
        type: 'Module',
        filePath: 'src/server/Game/LaserRuntime/ControllerRuntime.lua',
        bm25Score: 3.3,
        score: 3.3,
      },
    ];

    const ranked = await ranking.rankSearchResults(repo, searchQuery, rawResults, 5, true);

    expect(ranked[0]?.filePath).toBe('src/server/Game/LaserCannonController.lua');
    expect(ranked.slice(0, 3).map((entry) => entry.filePath)).toEqual(
      expect.arrayContaining([
        'src/server/Game/LaserCannonController.lua',
        'src/server/Game/LaserRuntime/ControllerRuntime.lua',
      ]),
    );
    expect(ranked[0]?.filePath).not.toBe('src/server/Playtest/Scenarios/LaserMinigameV1.lua');
    expect(ranked.slice(0, 2).map((entry) => entry.filePath)).not.toEqual(
      expect.arrayContaining([
        'src/server/Minigames/Spotlight/Sweep/Geometry.lua',
        'src/shared/Spotlight/SpotlightFixture.lua',
      ]),
    );
  });

  it('keeps narrow exact owner lookup anchored on the exact module', async () => {
    const { ranking } = createRankingSupport();
    const rawResults = [
      {
        nodeId: 'spotlight-module',
        name: 'SpotlightFixture',
        type: 'Module',
        filePath: 'src/shared/Spotlight/SpotlightFixture.lua',
        bm25Score: 4,
        score: 4,
      },
      {
        nodeId: 'laser-controller',
        name: 'LaserCannonController',
        type: 'Module',
        filePath: 'src/server/Game/LaserCannonController.lua',
        bm25Score: 3.9,
        score: 3.9,
      },
    ];

    const ranked = await ranking.rankSearchResults(repo, 'SpotlightFixture', rawResults, 2, true);

    expect(ranked[0]?.filePath).toBe('src/shared/Spotlight/SpotlightFixture.lua');
  });

  it('does not penalize playtest scenario targets when the query explicitly asks for them', async () => {
    const { ranking } = createRankingSupport();
    const rawResults = [
      {
        nodeId: 'laser-playtest',
        name: 'LaserMinigameV1',
        type: 'Module',
        filePath: 'src/server/Playtest/Scenarios/LaserMinigameV1.lua',
        bm25Score: 4.1,
        score: 4.1,
      },
      {
        nodeId: 'laser-controller',
        name: 'LaserCannonController',
        type: 'Module',
        filePath: 'src/server/Game/LaserCannonController.lua',
        bm25Score: 4.0,
        score: 4.0,
      },
    ];

    const ranked = await ranking.rankSearchResults(
      repo,
      'adjust the laser playtest scenario timing',
      rawResults,
      2,
      true,
    );

    expect(ranked[0]?.filePath).toBe('src/server/Playtest/Scenarios/LaserMinigameV1.lua');
  });
});
