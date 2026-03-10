import { beforeEach, describe, expect, it, vi } from 'vitest';

const runPipelineFromRepo = vi.fn();
const loadGraphToKuzu = vi.fn();
const getKuzuStats = vi.fn();

vi.mock('v8', () => ({
  default: {
    getHeapStatistics: () => ({ heap_size_limit: 16 * 1024 * 1024 * 1024 }),
  },
}));

vi.mock('../..//src/core/ingestion/pipeline.js', () => ({
  runPipelineFromRepo,
}));

vi.mock('../../src/core/kuzu/kuzu-adapter.js', () => ({
  initKuzu: vi.fn(),
  loadGraphToKuzu,
  getKuzuStats,
  closeKuzu: vi.fn(),
  createFTSIndex: vi.fn(),
}));

const loadConfig = vi.fn();
const loadMeta = vi.fn();
const getStoragePaths = vi.fn();
const getRepoState = vi.fn();

vi.mock('../../src/storage/repo-manager.js', () => ({
  getStoragePaths,
  saveMeta: vi.fn(),
  loadConfig,
  loadMeta,
  getRepoState,
}));

const getGitRoot = vi.fn();
const isGitRepo = vi.fn();

vi.mock('../../src/storage/git.js', () => ({
  getCurrentBranch: vi.fn(),
  getCurrentCommit: vi.fn(),
  isGitRepo,
  getGitRoot,
  isWorkingTreeDirty: vi.fn(),
}));

describe('indexCommand', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.exitCode = 0;

    getGitRoot.mockReturnValue('/repo');
    isGitRepo.mockReturnValue(true);
    getStoragePaths.mockReturnValue({
      storagePath: '/repo/.codenexus',
      configPath: '/repo/.codenexus/config.toml',
      metaPath: '/repo/.codenexus/meta.json',
      kuzuPath: '/repo/.codenexus/kuzu',
      runtimePath: '/repo/.codenexus/runtime.json',
    });
    loadConfig.mockResolvedValue(null);
    loadMeta.mockResolvedValue(null);
    getRepoState.mockResolvedValue(null);
    runPipelineFromRepo.mockResolvedValue({
      graph: {},
      repoPath: '/repo',
      totalFileCount: 1,
      communityResult: { stats: { totalCommunities: 0 } },
      processResult: { stats: { totalProcesses: 0 } },
    });
    loadGraphToKuzu.mockResolvedValue({ warnings: [] });
    getKuzuStats.mockResolvedValue({ nodes: 1, edges: 1 });
  });

  it('resolves the nearest git root for an explicit subdirectory path', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { indexCommand } = await import('../../src/cli/index-command.js');

    await indexCommand('/repo/src/nested');

    expect(getGitRoot).toHaveBeenCalledWith('/repo/src/nested');
    expect(getStoragePaths).toHaveBeenCalledWith('/repo');
    expect(loadConfig).toHaveBeenCalledWith('/repo/.codenexus');
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
  });

  it('tells the operator to restart a running service after reindexing', async () => {
    loadConfig.mockResolvedValue({ version: 1, port: 4747 });
    getRepoState.mockResolvedValue({
      baseState: 'serving_stale',
      detailFlags: ['service_restart_required'],
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { indexCommand } = await import('../../src/cli/index-command.js');

    await indexCommand('/repo');

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Restart `codenexus serve` to serve this refreshed on-disk index.');

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });
});
