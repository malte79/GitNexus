import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRepoState = vi.fn();
const isGitRepo = vi.fn();

vi.mock('../../src/storage/repo-manager.js', () => ({
  getRepoState,
}));

vi.mock('../../src/storage/git.js', () => ({
  isGitRepo,
}));

describe('statusCommand', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.exitCode = 0;
    isGitRepo.mockReturnValue(true);
  });

  it('tells the operator to refresh a stale on-disk index', async () => {
    getRepoState.mockResolvedValue({
      repoRoot: '/repo',
      baseState: 'indexed_stale',
      detailFlags: ['head_changed'],
      config: { version: 1, port: 4747 },
      meta: {
        version: 1,
        indexed_head: 'abcdef123456',
        indexed_branch: 'main',
        indexed_at: '2026-03-09T00:00:00.000Z',
        indexed_dirty: false,
        worktree_root: '/repo',
      },
      runtime: null,
      liveHealth: null,
      currentHead: 'fedcba654321',
      currentBranch: 'main',
      storagePath: '/repo/.codenexus',
      worktreeRoot: '/repo',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { statusCommand } = await import('../../src/cli/status.js');

    await statusCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Refresh action: run `codenexus index` to refresh the on-disk index.');

    logSpy.mockRestore();
  });

  it('tells the operator to restart the service when it is serving an older loaded index', async () => {
    getRepoState.mockResolvedValue({
      repoRoot: '/repo',
      baseState: 'serving_stale',
      detailFlags: ['service_restart_required'],
      config: { version: 1, port: 4747 },
      meta: {
        version: 1,
        indexed_head: 'abcdef123456',
        indexed_branch: 'main',
        indexed_at: '2026-03-09T00:05:00.000Z',
        indexed_dirty: false,
        worktree_root: '/repo',
      },
      runtime: null,
      liveHealth: {
        version: 1,
        service: 'codenexus',
        pid: 12345,
        port: 4747,
        started_at: '2026-03-09T00:00:00.000Z',
        repo_root: '/repo',
        worktree_root: '/repo',
        loaded_index: {
          indexed_head: 'abcdef123456',
          indexed_branch: 'main',
          indexed_at: '2026-03-09T00:00:00.000Z',
          indexed_dirty: false,
          worktree_root: '/repo',
        },
      },
      currentHead: 'abcdef123456',
      currentBranch: 'main',
      storagePath: '/repo/.codenexus',
      worktreeRoot: '/repo',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { statusCommand } = await import('../../src/cli/status.js');

    await statusCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Refresh action: restart `codenexus serve` to load the refreshed on-disk index.');
    expect(output).toContain('Loaded service commit: abcdef1');

    logSpy.mockRestore();
  });
});
