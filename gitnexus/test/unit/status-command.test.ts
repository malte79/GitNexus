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
      config: { version: 1, port: 4747, auto_index: true, auto_index_interval_seconds: 300 },
      meta: {
        version: 1,
        index_generation: 'gen-current',
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
      storagePath: '/repo/.gnexus',
      worktreeRoot: '/repo',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { statusCommand } = await import('../../src/cli/status.js');

    await statusCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Refresh action: run `gnexus manage index` to refresh the on-disk index.');

    logSpy.mockRestore();
  });

  it('tells the operator the live service is still adopting the refreshed on-disk index', async () => {
    getRepoState.mockResolvedValue({
      repoRoot: '/repo',
      baseState: 'serving_stale',
      detailFlags: ['service_restart_required'],
      config: { version: 1, port: 4747, auto_index: true, auto_index_interval_seconds: 300 },
      meta: {
        version: 1,
        index_generation: 'gen-new',
        indexed_head: 'abcdef123456',
        indexed_branch: 'main',
        indexed_at: '2026-03-09T00:05:00.000Z',
        indexed_dirty: false,
        worktree_root: '/repo',
      },
      runtime: null,
      liveHealth: {
        version: 1,
        service: 'gnexus',
        pid: 12345,
        port: 4747,
        mode: 'background',
        started_at: '2026-03-09T00:00:00.000Z',
        repo_root: '/repo',
        worktree_root: '/repo',
        loaded_index: {
          index_generation: 'gen-old',
          indexed_head: 'abcdef123456',
          indexed_branch: 'main',
          indexed_at: '2026-03-09T00:00:00.000Z',
          indexed_dirty: false,
          worktree_root: '/repo',
        },
        auto_index: {
          enabled: true,
          interval_seconds: 300,
          last_attempt_at: '2026-03-09T00:04:00.000Z',
          last_succeeded_at: '2026-03-09T00:04:02.000Z',
        },
      },
      currentHead: 'abcdef123456',
      currentBranch: 'main',
      storagePath: '/repo/.gnexus',
      worktreeRoot: '/repo',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { statusCommand } = await import('../../src/cli/status.js');

    await statusCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Primary stale reason: the live service has not adopted the refreshed on-disk index yet.');
    expect(output).toContain('Reload action: the live service is still adopting the refreshed on-disk index.');
    expect(output).toContain('Loaded service commit: abcdef1');
    expect(output).toContain('Service mode: background');
    expect(output).toContain('Auto-index: enabled (300s interval)');
    expect(output).toContain('Background freshness: automatic reindex runs on the configured interval');

    logSpy.mockRestore();
  });

  it('tells the operator to restart the background service when live reload failed', async () => {
    getRepoState.mockResolvedValue({
      repoRoot: '/repo',
      baseState: 'serving_stale',
      detailFlags: ['service_restart_required'],
      config: { version: 1, port: 4747, auto_index: true, auto_index_interval_seconds: 300 },
      meta: {
        version: 1,
        index_generation: 'gen-new',
        indexed_head: 'abcdef123456',
        indexed_branch: 'main',
        indexed_at: '2026-03-09T00:05:00.000Z',
        indexed_dirty: false,
        worktree_root: '/repo',
      },
      runtime: null,
      liveHealth: {
        version: 1,
        service: 'gnexus',
        pid: 12345,
        port: 4747,
        mode: 'background',
        started_at: '2026-03-09T00:00:00.000Z',
        repo_root: '/repo',
        worktree_root: '/repo',
        loaded_index: {
          index_generation: 'gen-old',
          indexed_head: 'abcdef123456',
          indexed_branch: 'main',
          indexed_at: '2026-03-09T00:00:00.000Z',
          indexed_dirty: false,
          worktree_root: '/repo',
        },
        reload_error: 'reload failed',
        auto_index: {
          enabled: true,
          interval_seconds: 300,
          last_failed_at: '2026-03-09T00:06:00.000Z',
          last_error: 'Auto-index exited with code 1',
          backoff_until: '2026-03-09T00:11:00.000Z',
        },
      },
      currentHead: 'abcdef123456',
      currentBranch: 'main',
      storagePath: '/repo/.gnexus',
      worktreeRoot: '/repo',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { statusCommand } = await import('../../src/cli/status.js');

    await statusCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Reload error: reload failed');
    expect(output).toContain('Primary stale reason: the live service failed to reload the refreshed on-disk index.');
    expect(output).toContain('Reload action: run `gnexus manage restart` to recover from the last live-reload failure.');
    expect(output).toContain('Auto-index error: Auto-index exited with code 1');
    expect(output).toContain('Auto-index backoff until:');
    expect(output).toContain('Auto-index note: automatic freshness is temporarily paused by backoff');

    logSpy.mockRestore();
  });
});
