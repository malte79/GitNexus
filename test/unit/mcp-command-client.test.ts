import { beforeEach, describe, expect, it, vi } from 'vitest';

const connect = vi.fn();
const close = vi.fn().mockResolvedValue(undefined);
const callTool = vi.fn();

const loadConfig = vi.fn();
const loadRepo = vi.fn();
const probeServiceHealth = vi.fn();
const resolveRepoBoundary = vi.fn();
const getStoragePaths = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: function MockClient() {
    return {
      connect,
      close,
      callTool,
    };
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: function MockStreamableHTTPClientTransport(url: URL) {
    return { url };
  },
}));

vi.mock('../../src/storage/repo-manager.js', () => ({
  loadConfig,
  loadRepo,
  probeServiceHealth,
  resolveRepoBoundary,
  getStoragePaths,
}));

describe('runRepoToolCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    resolveRepoBoundary.mockReturnValue({
      repoRoot: '/repo',
      worktreeRoot: '/repo',
    });
    getStoragePaths.mockReturnValue({ storagePath: '/repo/.gnexus' });
    loadConfig.mockResolvedValue({ version: 1, port: 4747, auto_index: true, auto_index_interval_seconds: 300 });
    loadRepo.mockResolvedValue({ repoPath: '/repo' });
    probeServiceHealth.mockResolvedValue({
      version: 1,
      service: 'gnexus',
      pid: 1234,
      port: 4747,
      mode: 'background',
      started_at: '2026-03-12T00:00:00.000Z',
      repo_root: '/repo',
      worktree_root: '/repo',
      loaded_index: {
        index_generation: 'gen',
        indexed_head: 'abc',
        indexed_branch: 'main',
        indexed_at: '2026-03-12T00:00:00.000Z',
        indexed_dirty: false,
        worktree_root: '/repo',
      },
    });
    connect.mockResolvedValue(undefined);
    close.mockResolvedValue(undefined);
    callTool.mockResolvedValue({
      content: [{ type: 'text', text: '{ "ok": true }' }],
      isError: false,
    });
  });

  it('prints a tool result through the repo-local MCP service', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runRepoToolCommand } = await import('../../src/cli/mcp-command-client.js');

    await runRepoToolCommand('query', { query: 'auth' });

    expect(callTool).toHaveBeenCalledWith({
      name: 'query',
      arguments: { query: 'auth' },
    });
    expect(logSpy).toHaveBeenCalledWith('{ "ok": true }');
    logSpy.mockRestore();
  });

  it('guides the user to manage start when the service is unavailable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    probeServiceHealth.mockResolvedValue(null);
    const { runRepoToolCommand } = await import('../../src/cli/mcp-command-client.js');

    await runRepoToolCommand('query', { query: 'auth' });

    expect(errorSpy).toHaveBeenCalledWith(
      'gnexus service is not running for this repo. Run `gnexus manage start`.',
    );
    expect(process.exitCode).toBe(1);
    errorSpy.mockRestore();
  });

  it('rejects a running service that belongs to a different repo', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    probeServiceHealth.mockResolvedValue({
      version: 1,
      service: 'gnexus',
      pid: 1234,
      port: 4747,
      mode: 'background',
      started_at: '2026-03-12T00:00:00.000Z',
      repo_root: '/other',
      worktree_root: '/other',
      loaded_index: {
        index_generation: 'gen',
        indexed_head: 'abc',
        indexed_branch: 'main',
        indexed_at: '2026-03-12T00:00:00.000Z',
        indexed_dirty: false,
        worktree_root: '/other',
      },
    });
    const { runRepoToolCommand } = await import('../../src/cli/mcp-command-client.js');

    await runRepoToolCommand('query', { query: 'auth' });

    expect(errorSpy.mock.calls.flat().join(' ')).toContain('Configured port 4747 is serving a different repo');
    expect(process.exitCode).toBe(1);
    errorSpy.mockRestore();
  });
});
