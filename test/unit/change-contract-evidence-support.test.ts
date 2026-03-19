import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => [
    'src/cli/index.ts',
    'src/cli/mcp-command-client.ts',
    'src/mcp/tools.ts',
    'src/mcp/server.ts',
    'src/mcp/local/local-backend-analysis-support.ts',
    'test/unit/cli-commands.test.ts',
    'test/unit/tools.test.ts',
    'test/unit/local-backend-structure.test.ts',
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
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.file_path)).toContain(
      'test/unit/cli-commands.test.ts',
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
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.file_path)).toContain(
      'test/unit/tools.test.ts',
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
    expect('recommended_tests' in result && result.recommended_tests.map((test) => test.file_path)).toContain(
      'test/unit/local-backend-structure.test.ts',
    );
  });
});
