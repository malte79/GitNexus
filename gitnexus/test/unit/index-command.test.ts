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
const computeIndexGeneration = vi.fn(() => 'gen-new');
const acquireIndexLock = vi.fn(async () => async () => {});

vi.mock('../../src/storage/repo-manager.js', () => ({
  acquireIndexLock,
  computeIndexGeneration,
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
    acquireIndexLock.mockResolvedValue(async () => {});
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

  it('tells the operator the live service is still adopting the refreshed index', async () => {
    loadConfig.mockResolvedValue({ version: 1, port: 4747 });
    getRepoState.mockResolvedValue({
      baseState: 'serving_stale',
      detailFlags: ['service_restart_required'],
      liveHealth: {
        service: 'codenexus',
        mode: 'background',
        pid: 1234,
        port: 4747,
        started_at: new Date().toISOString(),
        repo_root: '/repo',
        worktree_root: '/repo',
        loaded_index: {
          indexed_head: 'abc123',
          indexed_branch: 'main',
          indexed_at: '2026-03-09T01:00:00.000Z',
          indexed_dirty: false,
          worktree_root: '/repo',
          index_generation: 'gen-old',
        },
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { indexCommand } = await import('../../src/cli/index-command.js');

    await indexCommand('/repo');

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Note: A live CodeNexus service is still adopting the refreshed on-disk index.');

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('tells the operator to restart the background service when live reload failed', async () => {
    loadConfig.mockResolvedValue({ version: 1, port: 4747 });
    getRepoState.mockResolvedValue({
      baseState: 'serving_stale',
      detailFlags: ['service_restart_required'],
      liveHealth: {
        service: 'codenexus',
        mode: 'background',
        pid: 1234,
        port: 4747,
        started_at: new Date().toISOString(),
        repo_root: '/repo',
        worktree_root: '/repo',
        reload_error: 'reload failed',
        loaded_index: {
          indexed_head: 'abc123',
          indexed_branch: 'main',
          indexed_at: '2026-03-09T01:00:00.000Z',
          indexed_dirty: false,
          worktree_root: '/repo',
          index_generation: 'gen-old',
        },
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { indexCommand } = await import('../../src/cli/index-command.js');

    await indexCommand('/repo');

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Note: A live CodeNexus service failed to adopt the refreshed on-disk index automatically.');
    expect(output).toContain('Run `codenexus restart` to recover the background service.');

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });
});
