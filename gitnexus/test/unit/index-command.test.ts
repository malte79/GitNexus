import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('v8', () => ({
  default: {
    getHeapStatistics: () => ({ heap_size_limit: 16 * 1024 * 1024 * 1024 }),
  },
}));

vi.mock('../..//src/core/ingestion/pipeline.js', () => ({
  runPipelineFromRepo: vi.fn(),
}));

vi.mock('../../src/core/kuzu/kuzu-adapter.js', () => ({
  initKuzu: vi.fn(),
  loadGraphToKuzu: vi.fn(),
  getKuzuStats: vi.fn(),
  closeKuzu: vi.fn(),
  createFTSIndex: vi.fn(),
}));

const loadConfig = vi.fn();
const loadMeta = vi.fn();
const getStoragePaths = vi.fn();

vi.mock('../../src/storage/repo-manager.js', () => ({
  getStoragePaths,
  saveMeta: vi.fn(),
  loadConfig,
  loadMeta,
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
});
