import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => [
    'README.md',
    'docs/cli/commands.md',
    'scripts/run-integration-tests.sh',
    'src/cli/index.ts',
    'src/cli/mcp-command-client.ts',
    'src/cli/rename.ts',
    'src/mcp/tools.ts',
    'src/mcp/server.ts',
    'src/mcp/local/local-backend-analysis-support.ts',
    'src/mcp/local/local-backend-change-contract-support.ts',
    'src/mcp/local/local-backend-verify-change-support.ts',
    'src/mcp/local/local-backend-graph-support.ts',
    'src/mcp/local/local-backend-search-ranking-support.ts',
    'src/server/Playtest/Scenarios/LaserMinigameV1.lua',
    'src/server/Game/LaserCannonController.lua',
    'src/server/Game/LaserRuntime/ControllerRuntime.lua',
    'src/server/Game/LaserRuntime/DiscoveryRuntime.lua',
    'src/server/Game/LaserRuntime/LocomotionRuntime.lua',
    'src/server/Minigames/Laser/MainRuntime.lua',
    'src/server/service-runtime.ts',
    'src/storage/repo-manager.ts',
    'src/core/ingestion/call-processor.ts',
    'src/core/ingestion/symbol-table.ts',
    'test/unit/cli-commands.test.ts',
    'test/unit/tools.test.ts',
    'test/unit/local-backend-structure.test.ts',
    'test/unit/mcp-command-client.test.ts',
    'test/integration/service-runtime.test.ts',
  ].join('\n')),
}));

import { LocalBackendChangeContractSupport } from '../../src/mcp/local/local-backend-change-contract-support.js';

const repo = {
  id: 'repo',
  repoPath: '/repo',
} as any;

function createHost() {
  return {
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
    getRepoFreshnessSummary: vi.fn().mockResolvedValue(null),
    getNodeKind: vi.fn(),
    humanizeSummaryLabel: vi.fn(),
    isLowSignalSubsystemLabel: vi.fn(),
    querySearch: vi.fn(async (_repo: any, params: { query: string }) => {
      if (params.query.includes('top-level analysis command')) {
        return {
          process_symbols: [
            {
              id: 'Function:src/cli/mcp-command-client.ts:callRepoTool:28',
              name: 'callRepoTool',
              type: 'Function',
              filePath: 'src/cli/mcp-command-client.ts',
            },
          ],
          definitions: [
            {
              name: 'mcp-http.ts',
              type: 'File',
              filePath: 'src/server/mcp-http.ts',
            },
            {
              name: 'local-backend-runtime-support.ts',
              type: 'File',
              filePath: 'src/mcp/local/local-backend-runtime-support.ts',
            },
          ],
        };
      }
      if (params.query.includes('agent-facing tool')) {
        return {
          process_symbols: [],
          definitions: [
            {
              name: 'local-backend-search-lookup-support.ts',
              type: 'File',
              filePath: 'src/mcp/local/local-backend-search-lookup-support.ts',
            },
            {
              name: 'local-backend-summary-presentation-support.ts',
              type: 'File',
              filePath: 'src/mcp/local/local-backend-summary-presentation-support.ts',
            },
          ],
        };
      }
      if (params.query.includes('authority concentration in Local Backend ranking and graph recovery')) {
        return {
          process_symbols: [
            {
              id: 'Method:src/mcp/local/local-backend-search-ranking-support.ts:rankSearchResults:398',
              name: 'rankSearchResults',
              type: 'Method',
              filePath: 'src/mcp/local/local-backend-search-ranking-support.ts',
            },
          ],
          definitions: [
            {
              name: 'query',
              type: 'Method',
              filePath: 'src/mcp/local/local-backend-search-query-support.ts',
            },
            {
              name: 'local-backend-runtime-support.ts',
              type: 'File',
              filePath: 'src/mcp/local/local-backend-runtime-support.ts',
            },
          ],
        };
      }
      if (params.query.includes('truth-family concentration around call resolution in ingestion')) {
        return {
          process_symbols: [
            {
              id: 'Function:src/core/ingestion/call-processor.ts:processCalls:169',
              name: 'processCalls',
              type: 'Function',
              filePath: 'src/core/ingestion/call-processor.ts',
            },
          ],
          definitions: [
            {
              name: 'pipeline-support.ts',
              type: 'File',
              filePath: 'src/core/ingestion/pipeline-support.ts',
            },
            {
              name: 'parsing-processor.ts',
              type: 'File',
              filePath: 'src/core/ingestion/parsing-processor.ts',
            },
          ],
        };
      }
      if (params.query.includes('highest-value regression checks')) {
        return {
          process_symbols: [
            {
              id: 'Function:src/storage/repo-manager.ts:evaluateIndexedState:754',
              name: 'evaluateIndexedState',
              type: 'Function',
              filePath: 'src/storage/repo-manager.ts',
            },
          ],
          definitions: [
            {
              name: 'service-runtime.ts',
              type: 'File',
              filePath: 'src/server/service-runtime.ts',
            },
          ],
        };
      }
      if (params.query.includes('regression tests needed for plan-change and verify-change')) {
        return {
          process_symbols: [
            {
              id: 'Method:src/mcp/local/local-backend-verify-change-support.ts:verifyChange:24',
              name: 'verifyChange',
              type: 'Method',
              filePath: 'src/mcp/local/local-backend-verify-change-support.ts',
            },
          ],
          definitions: [
            {
              name: 'repo-manager.ts',
              type: 'File',
              filePath: 'src/storage/repo-manager.ts',
            },
          ],
        };
      }
      if (params.query.includes('old nested package paths')) {
        return {
          process_symbols: [
            {
              id: 'Function:src/core/ingestion/import-language-config-support.ts:loadSwiftPackageConfig:92',
              name: 'loadSwiftPackageConfig',
              type: 'Function',
              filePath: 'src/core/ingestion/import-language-config-support.ts',
            },
          ],
          definitions: [
            {
              name: 'repo-manager.ts',
              type: 'File',
              filePath: 'src/storage/repo-manager.ts',
            },
          ],
        };
      }
      if (params.query.includes('repo-local MCP over HTTP startup and repo matching')) {
        return {
          process_symbols: [],
          definitions: [
            {
              name: 'local-backend-graph-support.ts',
              type: 'File',
              filePath: 'src/mcp/local/local-backend-graph-support.ts',
            },
            {
              name: 'local-backend-search-query-support.ts',
              type: 'File',
              filePath: 'src/mcp/local/local-backend-search-query-support.ts',
            },
          ],
        };
      }
      if (params.query.includes('overclaim certainty or hide contract defects')) {
        return {
          process_symbols: [
            {
              id: 'Method:src/mcp/local/local-backend-verify-change-support.ts:verifyChange:24',
              name: 'verifyChange',
              type: 'Method',
              filePath: 'src/mcp/local/local-backend-verify-change-support.ts',
            },
          ],
          definitions: [
            {
              name: 'local-backend-graph-support.ts',
              type: 'File',
              filePath: 'src/mcp/local/local-backend-graph-support.ts',
            },
          ],
        };
      }
      if (params.query.includes('death lasers continuously slide back and forth along their own rails')) {
        return {
          process_symbols: [
            {
              id: 'Method:src/server/Minigames/Spotlight/Sweep/Geometry.lua:computePlateTopY:16',
              name: 'computePlateTopY',
              type: 'Method',
              filePath: 'src/server/Minigames/Spotlight/Sweep/Geometry.lua',
            },
            {
              id: 'Function:src/shared/Spotlight/SpotlightFixture.lua:computeBeamTextureLengthForTilesLit:54',
              name: 'computeBeamTextureLengthForTilesLit',
              type: 'Function',
              filePath: 'src/shared/Spotlight/SpotlightFixture.lua',
            },
            {
              id: 'Method:src/server/Minigames/Laser/MainRuntime.lua:start:553',
              name: 'start',
              type: 'Method',
              filePath: 'src/server/Minigames/Laser/MainRuntime.lua',
            },
          ],
          definitions: [
            {
              name: 'LaserMinigameV1',
              type: 'Module',
              filePath: 'src/server/Playtest/Scenarios/LaserMinigameV1.lua',
            },
            {
              name: 'LaserCannonController',
              type: 'Module',
              filePath: 'src/server/Game/LaserCannonController.lua',
            },
            {
              name: 'ControllerRuntime',
              type: 'Module',
              filePath: 'src/server/Game/LaserRuntime/ControllerRuntime.lua',
            },
            {
              name: 'DiscoveryRuntime',
              type: 'Module',
              filePath: 'src/server/Game/LaserRuntime/DiscoveryRuntime.lua',
            },
            {
              name: 'LocomotionRuntime',
              type: 'Module',
              filePath: 'src/server/Game/LaserRuntime/LocomotionRuntime.lua',
            },
          ],
          processes: [{ id: 'proc_laser' }],
        };
      }
      if (params.query.includes('laser playtest scenario timing')) {
        return {
          process_symbols: [
            {
              id: 'Method:src/server/Game/LaserCannonController.lua:startSweep:88',
              name: 'startSweep',
              type: 'Method',
              filePath: 'src/server/Game/LaserCannonController.lua',
            },
          ],
          definitions: [
            {
              name: 'LaserMinigameV1',
              type: 'Module',
              filePath: 'src/server/Playtest/Scenarios/LaserMinigameV1.lua',
            },
          ],
          processes: [{ id: 'proc_laser_playtest' }],
        };
      }
      return {
        process_symbols: [],
        definitions: [
          {
            name: 'local-backend-search-lookup-support.ts',
            type: 'File',
            filePath: 'src/mcp/local/local-backend-search-lookup-support.ts',
          },
          {
            name: 'local-backend-graph-support.ts',
            type: 'File',
            filePath: 'src/mcp/local/local-backend-graph-support.ts',
          },
        ],
      };
    }),
    detectChanges: vi.fn(),
    analyzeImpact: vi.fn().mockResolvedValue({
      byDepth: {},
      affected_processes: [],
      affected_modules: [],
      coverage: {
        confidence: 'partial',
        note: 'Impact coverage is partial for this synthetic test.',
      },
      risk: 'medium',
      risk_split: {
        summary_line: 'change risk: medium; local refactor pressure: high',
      },
    }),
    lookupNamedSymbols: vi.fn(),
    getPrimaryModuleSymbols: vi.fn(),
    getRojoProjectIndex: vi.fn(),
    getBoundaryImports: vi.fn(),
    getContainedMembers: vi.fn(),
    classifyCoverageSignal: vi.fn(),
    getDetailedAffectedAreas: vi.fn(),
    getOwnerSymbolsForFiles: vi.fn(),
  } as any;
}

describe('LocalBackendChangeContractSupport engineering intent hints', () => {
  it('recovers the CLI registration seam for command goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Add a new top-level analysis command that routes through the MCP HTTP runtime',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'src/cli/index.ts',
        'src/cli/mcp-command-client.ts',
      ]),
    );
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.target)).toEqual(
      expect.arrayContaining([
        'test/unit/cli-commands.test.ts',
        'npm test',
      ]),
    );
  });

  it('recovers MCP registration seams for tool goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Add a new agent-facing tool that reuses existing Local Backend analysis seams',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'src/mcp/tools.ts',
        'src/mcp/server.ts',
        'src/mcp/local/local-backend-analysis-support.ts',
      ]),
    );
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.target)).toEqual(
      expect.arrayContaining([
        'test/unit/tools.test.ts',
        'npm test',
        'npm run test:integration',
      ]),
    );
  });

  it('recovers the structural guard test and guarded seam for guard goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Add a structure test that prevents Local Backend analysis from regrowing into a monolith',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'test/unit/local-backend-structure.test.ts',
        'src/mcp/local/local-backend-analysis-support.ts',
      ]),
    );
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.target)).toEqual(
      expect.arrayContaining([
        'test/unit/local-backend-structure.test.ts',
        'npm test',
      ]),
    );
  });

  it('recovers planner regression tests for qa trustworthiness goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Identify the regression tests needed for plan-change and verify-change to remain trustworthy.',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'test/unit/tools.test.ts',
        'test/unit/cli-commands.test.ts',
        'test/unit/local-backend-structure.test.ts',
      ]),
    );
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.target)).toEqual(
      expect.arrayContaining([
        'test/unit/tools.test.ts',
        'test/unit/cli-commands.test.ts',
      ]),
    );
  });

  it('recovers flattening regression seams for nested package path goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Identify what should be tested so old nested package paths do not silently linger.',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'scripts/run-integration-tests.sh',
        'src/server/service-runtime.ts',
        'README.md',
      ]),
    );
  });

  it('recovers runtime boundary seams for security repo-matching goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Identify the security-sensitive boundaries touched by repo-local MCP over HTTP startup and repo matching.',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'src/cli/mcp-command-client.ts',
        'src/server/service-runtime.ts',
        'src/storage/repo-manager.ts',
      ]),
    );
  });

  it('recovers truthfulness contract seams for security overconfidence goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Identify how plan-change and verify-change could overclaim certainty or hide contract defects.',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'src/mcp/local/local-backend-change-contract-support.ts',
        'src/mcp/local/local-backend-verify-change-support.ts',
        'docs/cli/commands.md',
      ]),
    );
  });

  it('recovers Local Backend ranking and graph seams for planning refactor goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Reduce authority concentration in Local Backend ranking and graph recovery.',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'src/mcp/local/local-backend-search-ranking-support.ts',
        'src/mcp/local/local-backend-graph-support.ts',
      ]),
    );
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.target)).toContain(
      'npm test',
    );
  });

  it('recovers call-resolution seams for ingestion planning goals', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'Reduce truth-family concentration around call resolution in ingestion.',
    });

    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'src/core/ingestion/call-processor.ts',
        'src/core/ingestion/symbol-table.ts',
      ]),
    );
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.target)).toEqual(
      expect.arrayContaining([
        'npm test',
        'npm run test:integration',
      ]),
    );
  });

  it('reranks broad runtime goals away from spotlight methods when stronger laser owners exist', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'make all four death lasers continuously slide back and forth along their own rails at all times with a default 8-second traverse, 1-second decel at the end, 1-second pause, and 1-second accel away from the end, preserving authored orientation and allowing minigame beam state to layer on top',
    });

    expect('primary_anchor' in result && result.primary_anchor?.file_path).toBe('src/server/Game/LaserCannonController.lua');
    expect('required_edit_surfaces' in result && result.required_edit_surfaces[0]?.file_path).toBe('src/server/Game/LaserCannonController.lua');
    expect('required_edit_surfaces' in result && result.required_edit_surfaces.map((surface) => surface.file_path)).toEqual(
      expect.arrayContaining([
        'src/server/Game/LaserCannonController.lua',
        'src/server/Game/LaserRuntime/ControllerRuntime.lua',
        'src/server/Game/LaserRuntime/DiscoveryRuntime.lua',
      ]),
    );
    expect('required_edit_surfaces' in result && result.required_edit_surfaces[0]?.file_path).not.toBe(
      'src/server/Playtest/Scenarios/LaserMinigameV1.lua',
    );
  });

  it('does not demote scenario anchors when the goal explicitly targets a playtest scenario', async () => {
    const support = new LocalBackendChangeContractSupport(createHost());
    const result = await support.planChange(repo, {
      goal: 'adjust the laser playtest scenario timing to match the new countdown',
    });

    expect('primary_anchor' in result && result.primary_anchor?.file_path).toBe(
      'src/server/Playtest/Scenarios/LaserMinigameV1.lua',
    );
  });
});
