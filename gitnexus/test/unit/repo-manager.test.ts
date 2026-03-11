import { describe, it, expect } from 'vitest';
import { realpathSync } from 'fs';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { execSync } from 'child_process';
import {
  getStoragePath,
  getStoragePaths,
  saveConfig,
  loadConfig,
  saveMeta,
  loadMeta,
  saveRuntimeMeta,
  probeServiceHealth,
  loadRepo,
  getRepoState,
} from '../../src/storage/repo-manager.js';
import { createTempDir } from '../helpers/test-db.js';

async function createGitRepo(prefix: string) {
  const handle = await createTempDir(prefix);
  execSync('git init -q', { cwd: handle.dbPath });
  execSync('git config user.email "test@example.com"', { cwd: handle.dbPath });
  execSync('git config user.name "Test User"', { cwd: handle.dbPath });
  await fs.writeFile(path.join(handle.dbPath, 'README.md'), 'hello\n', 'utf-8');
  execSync('git add README.md', { cwd: handle.dbPath });
  execSync('git commit -q -m "init"', { cwd: handle.dbPath });
  return handle;
}

async function ignoreCodeNexusDir(repoPath: string): Promise<void> {
  await fs.writeFile(path.join(repoPath, '.gitignore'), '.codenexus/\n', 'utf-8');
  execSync('git add .gitignore', { cwd: repoPath });
  execSync('git commit -q -m "ignore .codenexus"', { cwd: repoPath });
}

async function createHealthServer(health: {
  mode: 'foreground' | 'background';
  pid: number;
  started_at: string;
  repo_root: string;
  worktree_root: string;
  loaded_index: {
    indexed_head: string;
    indexed_branch: string;
    indexed_at: string;
    indexed_dirty: boolean;
    worktree_root: string;
  };
}): Promise<{ server: http.Server; port: number }> {
  let boundPort = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/health') {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      version: 1,
      service: 'codenexus',
      port: boundPort,
      ...health,
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address');
  }

  boundPort = address.port;

  return { server, port: address.port };
}

function buildLoadedIndex(repoPath: string, overrides: Partial<{
  indexed_head: string;
  indexed_branch: string;
  indexed_at: string;
  indexed_dirty: boolean;
  worktree_root: string;
}> = {}) {
  return {
    indexed_head: execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim(),
    indexed_branch: execSync('git branch --show-current', { cwd: repoPath }).toString().trim(),
    indexed_at: new Date().toISOString(),
    indexed_dirty: false,
    worktree_root: repoPath,
    ...overrides,
  };
}

async function createUnrelatedServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: 'other' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address');
  }

  return { server, port: address.port };
}

describe('getStoragePath', () => {
  it('appends .codenexus to resolved repo path', () => {
    const result = getStoragePath('/home/user/project');
    expect(result).toContain('.codenexus');
    expect(path.basename(result)).toBe('.codenexus');
  });
});

describe('getStoragePaths', () => {
  it('returns config, meta, kuzu, and runtime paths under storagePath', () => {
    const paths = getStoragePaths('/home/user/project');
    expect(paths.storagePath).toContain('.codenexus');
    expect(paths.configPath.startsWith(paths.storagePath)).toBe(true);
    expect(paths.metaPath.startsWith(paths.storagePath)).toBe(true);
    expect(paths.kuzuPath.startsWith(paths.storagePath)).toBe(true);
    expect(paths.runtimePath.startsWith(paths.storagePath)).toBe(true);
  });
});

describe('config and metadata round trips', () => {
  it('saves and loads config from .codenexus/config.toml', async () => {
    const handle = await createTempDir('repo-manager-config-');
    const storagePath = path.join(handle.dbPath, '.codenexus');

    await saveConfig(storagePath, {
      version: 1,
      port: 4747,
      auto_index: true,
      auto_index_interval_seconds: 300,
    });
    const config = await loadConfig(storagePath);

    expect(config).toEqual({
      version: 1,
      port: 4747,
      auto_index: true,
      auto_index_interval_seconds: 300,
    });
    await handle.cleanup();
  });

  it('saves and loads index metadata from .codenexus/meta.json', async () => {
    const handle = await createTempDir('repo-manager-meta-');
    const storagePath = path.join(handle.dbPath, '.codenexus');

    await saveMeta(storagePath, {
      version: 1,
      indexed_head: 'abc123',
      indexed_branch: 'main',
      indexed_at: new Date().toISOString(),
      indexed_dirty: false,
      worktree_root: handle.dbPath,
      stats: { files: 1, nodes: 2 },
    });

    const meta = await loadMeta(storagePath);
    expect(meta?.indexed_head).toBe('abc123');
    expect(meta?.indexed_branch).toBe('main');
    await handle.cleanup();
  });
});

describe('repo-local state', () => {
  it('reports uninitialized when config is missing', async () => {
    const repo = await createGitRepo('repo-manager-state-');
    const state = await getRepoState(repo.dbPath);

    expect(state?.baseState).toBe('uninitialized');
    await repo.cleanup();
  });

  it('reports initialized_unindexed when config exists without a usable index', async () => {
    const repo = await createGitRepo('repo-manager-state-');
    await ignoreCodeNexusDir(repo.dbPath);
    await saveConfig(path.join(repo.dbPath, '.codenexus'), { version: 1, port: 4747 });

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('initialized_unindexed');
    await repo.cleanup();
  });

  it('treats an index created before the first commit as indexed_current when the dirty snapshot matches', async () => {
    const repo = await createTempDir('repo-manager-no-commit-');
    execSync('git init -q', { cwd: repo.dbPath });
    execSync('git config user.email "test@example.com"', { cwd: repo.dbPath });
    execSync('git config user.name "Test User"', { cwd: repo.dbPath });
    await fs.writeFile(path.join(repo.dbPath, '.gitignore'), '.codenexus/\n', 'utf-8');
    await fs.writeFile(path.join(repo.dbPath, 'hello.ts'), 'export const hello = 42;\n', 'utf-8');

    const storagePath = path.join(repo.dbPath, '.codenexus');
    await saveConfig(storagePath, { version: 1, port: 4747 });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      indexed_head: '',
      indexed_branch: 'master',
      indexed_at: new Date().toISOString(),
      indexed_dirty: true,
      worktree_root: repo.dbPath,
    });

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('indexed_current');
    expect(state?.meta?.indexed_head).toBe('');
    expect(state?.detailFlags).toContain('working_tree_dirty');
    await repo.cleanup();
  });

  it('loads a usable indexed repo only when config, meta, and kuzu exist', async () => {
    const repo = await createGitRepo('repo-manager-indexed-');
    await ignoreCodeNexusDir(repo.dbPath);
    const storagePath = path.join(repo.dbPath, '.codenexus');
    await saveConfig(storagePath, { version: 1, port: 4747 });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      indexed_head: execSync('git rev-parse HEAD', { cwd: repo.dbPath }).toString().trim(),
      indexed_branch: execSync('git branch --show-current', { cwd: repo.dbPath }).toString().trim(),
      indexed_at: new Date().toISOString(),
      indexed_dirty: false,
      worktree_root: repo.dbPath,
    });

    const indexedRepo = await loadRepo(repo.dbPath);
    expect(indexedRepo?.repoPath).toBe(path.resolve(repo.dbPath));
    expect(indexedRepo?.config.port).toBe(4747);
    await repo.cleanup();
  });

  it('reports serving_current when a live local service answers on the configured port', async () => {
    const repo = await createGitRepo('repo-manager-serving-current-');
    await ignoreCodeNexusDir(repo.dbPath);
    const storagePath = path.join(repo.dbPath, '.codenexus');
    const startedAt = new Date().toISOString();
    const loadedIndex = buildLoadedIndex(repo.dbPath);
    const { server, port } = await createHealthServer({
      mode: 'foreground',
      pid: process.pid,
      started_at: startedAt,
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });

    await saveConfig(storagePath, { version: 1, port });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      ...loadedIndex,
    });
    await saveRuntimeMeta(storagePath, {
      version: 1,
      mode: 'foreground',
      pid: process.pid,
      port,
      started_at: startedAt,
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('serving_current');
    expect(state?.detailFlags).not.toContain('runtime_metadata_stale');

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repo.cleanup();
  });

  it('reports serving_stale when a live local service exists but the index is stale', async () => {
    const repo = await createGitRepo('repo-manager-serving-stale-');
    await ignoreCodeNexusDir(repo.dbPath);
    const storagePath = path.join(repo.dbPath, '.codenexus');
    const startedAt = new Date().toISOString();
    const loadedIndex = buildLoadedIndex(repo.dbPath);
    const { server, port } = await createHealthServer({
      mode: 'foreground',
      pid: process.pid,
      started_at: startedAt,
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });

    await saveConfig(storagePath, { version: 1, port });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      ...loadedIndex,
    });
    await saveRuntimeMeta(storagePath, {
      version: 1,
      mode: 'foreground',
      pid: process.pid,
      port,
      started_at: startedAt,
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });
    await fs.writeFile(path.join(repo.dbPath, 'README.md'), 'changed\n', 'utf-8');

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('serving_stale');
    expect(state?.detailFlags).toContain('working_tree_dirty');

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repo.cleanup();
  });

  it('marks runtime metadata stale when runtime.json claims a service but no live service answers', async () => {
    const repo = await createGitRepo('repo-manager-runtime-stale-');
    await ignoreCodeNexusDir(repo.dbPath);
    const storagePath = path.join(repo.dbPath, '.codenexus');
    const { server, port } = await createUnrelatedServer();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    await saveConfig(storagePath, { version: 1, port });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      ...buildLoadedIndex(repo.dbPath),
    });
    await saveRuntimeMeta(storagePath, {
      version: 1,
      mode: 'foreground',
      pid: 999999,
      port,
      started_at: new Date().toISOString(),
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: buildLoadedIndex(repo.dbPath),
    });

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('indexed_current');
    expect(state?.detailFlags).toContain('runtime_metadata_stale');

    await repo.cleanup();
  });

  it('does not report serving state when an unrelated process owns the configured port', async () => {
    const repo = await createGitRepo('repo-manager-unrelated-port-');
    await ignoreCodeNexusDir(repo.dbPath);
    const storagePath = path.join(repo.dbPath, '.codenexus');
    const { server, port } = await createUnrelatedServer();

    await saveConfig(storagePath, { version: 1, port });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      ...buildLoadedIndex(repo.dbPath),
    });

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('indexed_current');
    expect(state?.detailFlags).not.toContain('runtime_metadata_stale');

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repo.cleanup();
  });

  it('marks runtime metadata stale when the configured port is live but runtime.json is missing', async () => {
    const repo = await createGitRepo('repo-manager-missing-runtime-');
    await ignoreCodeNexusDir(repo.dbPath);
    const storagePath = path.join(repo.dbPath, '.codenexus');
    const loadedIndex = buildLoadedIndex(repo.dbPath);
    const { server, port } = await createHealthServer({
      mode: 'foreground',
      pid: process.pid,
      started_at: new Date().toISOString(),
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });

    await saveConfig(storagePath, { version: 1, port });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      ...loadedIndex,
    });

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('serving_current');
    expect(state?.detailFlags).toContain('runtime_metadata_stale');

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repo.cleanup();
  });

  it('can probe a live CodeNexus service identity payload', async () => {
    const repo = await createGitRepo('repo-manager-health-probe-');
    const startedAt = new Date().toISOString();
    const loadedIndex = buildLoadedIndex(repo.dbPath);
    const { server, port } = await createHealthServer({
      mode: 'foreground',
      pid: process.pid,
      started_at: startedAt,
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });

    const health = await probeServiceHealth(port);
    expect(health?.service).toBe('codenexus');
    expect(health?.repo_root).toBe(realpathSync(repo.dbPath));
    expect(health?.loaded_index.indexed_head).toBe(loadedIndex.indexed_head);

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repo.cleanup();
  });

  it('reports serving_stale and service_restart_required while a live service still serves an older loaded index', async () => {
    const repo = await createGitRepo('repo-manager-service-restart-required-');
    await ignoreCodeNexusDir(repo.dbPath);
    const storagePath = path.join(repo.dbPath, '.codenexus');
    const loadedIndex = buildLoadedIndex(repo.dbPath, { indexed_at: '2026-03-09T00:00:00.000Z' });
    const { server, port } = await createHealthServer({
      mode: 'foreground',
      pid: process.pid,
      started_at: new Date().toISOString(),
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });

    await saveConfig(storagePath, { version: 1, port });
    await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
    await saveMeta(storagePath, {
      version: 1,
      ...loadedIndex,
    });
    await saveRuntimeMeta(storagePath, {
      version: 1,
      mode: 'foreground',
      pid: process.pid,
      port,
      started_at: new Date().toISOString(),
      repo_root: repo.dbPath,
      worktree_root: repo.dbPath,
      loaded_index: loadedIndex,
    });

    await saveMeta(storagePath, {
      version: 1,
      ...buildLoadedIndex(repo.dbPath, { indexed_at: '2026-03-09T00:05:00.000Z' }),
    });

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('serving_stale');
    expect(state?.detailFlags).toContain('service_restart_required');

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repo.cleanup();
  });
});
