import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { createTempDir } from '../helpers/test-db.js';
import { saveConfig, saveMeta, getRepoState, probeServiceHealth } from '../../src/storage/repo-manager.js';
import { startRepoLocalService, DuplicateServiceError, ServiceStartupError } from '../../src/server/service-runtime.js';

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

async function prepareIndexedRepo(repoPath: string, port: number) {
  const storagePath = path.join(repoPath, '.codenexus');
  await fs.writeFile(path.join(repoPath, '.gitignore'), '.codenexus/\n', 'utf-8');
  execSync('git add .gitignore', { cwd: repoPath });
  execSync('git commit -q -m "ignore .codenexus"', { cwd: repoPath });

  await saveConfig(storagePath, { version: 1, port });
  await fs.mkdir(path.join(storagePath, 'kuzu'), { recursive: true });
  await saveMeta(storagePath, {
    version: 1,
    indexed_head: execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim(),
    indexed_branch: execSync('git branch --show-current', { cwd: repoPath }).toString().trim(),
    indexed_at: new Date().toISOString(),
    indexed_dirty: false,
    worktree_root: repoPath,
  });

  return storagePath;
}

async function reservePort(): Promise<number> {
  const net = await import('net');
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

describe('repo-local HTTP service runtime', () => {
  it('starts a live service for an indexed repo and cleans up runtime metadata on shutdown', async () => {
    const repo = await createGitRepo('service-runtime-live-');
    const port = await reservePort();
    const storagePath = await prepareIndexedRepo(repo.dbPath, port);

    const runtime = await startRepoLocalService(repo.dbPath);

    expect(runtime.port).toBe(port);
    expect(runtime.degraded).toBe(false);

    const stateWhileServing = await getRepoState(repo.dbPath);
    expect(stateWhileServing?.baseState).toBe('serving_current');

    const runtimePath = path.join(storagePath, 'runtime.json');
    await expect(fs.access(runtimePath)).resolves.toBeUndefined();

    await runtime.close();

    const stateAfterShutdown = await getRepoState(repo.dbPath);
    expect(stateAfterShutdown?.baseState).toBe('indexed_current');
    await expect(fs.access(runtimePath)).rejects.toThrow();

    await repo.cleanup();
  });

  it('refuses duplicate serve attempts for the same repo boundary', async () => {
    const repo = await createGitRepo('service-runtime-duplicate-');
    const port = await reservePort();
    await prepareIndexedRepo(repo.dbPath, port);

    const runtime = await startRepoLocalService(repo.dbPath);

    await expect(startRepoLocalService(repo.dbPath)).rejects.toBeInstanceOf(DuplicateServiceError);

    await runtime.close();
    await repo.cleanup();
  });

  it('starts in degraded mode when the indexed repo is stale', async () => {
    const repo = await createGitRepo('service-runtime-stale-');
    const port = await reservePort();
    await prepareIndexedRepo(repo.dbPath, port);
    await fs.writeFile(path.join(repo.dbPath, 'README.md'), 'changed\n', 'utf-8');

    const runtime = await startRepoLocalService(repo.dbPath);
    expect(runtime.degraded).toBe(true);

    const state = await getRepoState(repo.dbPath);
    expect(state?.baseState).toBe('serving_stale');

    await runtime.close();
    await repo.cleanup();
  });

  it('refuses to start when no usable index exists', async () => {
    const repo = await createGitRepo('service-runtime-unindexed-');
    const storagePath = path.join(repo.dbPath, '.codenexus');
    await saveConfig(storagePath, { version: 1, port: await reservePort() });

    await expect(startRepoLocalService(repo.dbPath)).rejects.toBeInstanceOf(ServiceStartupError);

    await repo.cleanup();
  });

  it('cleans up the bound server when runtime metadata cannot be written', async () => {
    const repo = await createGitRepo('service-runtime-runtime-write-failure-');
    const port = await reservePort();
    const storagePath = await prepareIndexedRepo(repo.dbPath, port);

    await fs.chmod(storagePath, 0o555);
    try {
      await expect(startRepoLocalService(repo.dbPath)).rejects.toBeInstanceOf(Error);
      expect(await probeServiceHealth(port)).toBeNull();
    } finally {
      await fs.chmod(storagePath, 0o755);
      await repo.cleanup();
    }
  });
});
