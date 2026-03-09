import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { initCommand } from '../../src/cli/init.js';
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

describe('initCommand', () => {
  const originalCwd = process.cwd();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = 0;
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
  });

  it('creates only .codenexus/config.toml on first init', async () => {
    const repo = await createGitRepo('init-command-first-');
    process.chdir(repo.dbPath);

    await initCommand();

    const configPath = path.join(repo.dbPath, '.codenexus', 'config.toml');
    await expect(fs.readFile(configPath, 'utf-8')).resolves.toContain('port = 4747');
    await expect(fs.access(path.join(repo.dbPath, '.codenexus', 'meta.json'))).rejects.toThrow();
    await expect(fs.access(path.join(repo.dbPath, '.codenexus', 'runtime.json'))).rejects.toThrow();
    await expect(fs.access(path.join(repo.dbPath, '.codenexus', 'kuzu'))).rejects.toThrow();

    await repo.cleanup();
  });

  it('is idempotent when config already exists', async () => {
    const repo = await createGitRepo('init-command-repeat-');
    process.chdir(repo.dbPath);

    await initCommand();
    const configPath = path.join(repo.dbPath, '.codenexus', 'config.toml');
    const first = await fs.readFile(configPath, 'utf-8');

    await initCommand();
    const second = await fs.readFile(configPath, 'utf-8');

    expect(second).toBe(first);
    expect(process.exitCode).toBe(0);

    await repo.cleanup();
  });

  it('fails clearly when existing config is invalid', async () => {
    const repo = await createGitRepo('init-command-invalid-');
    process.chdir(repo.dbPath);
    await fs.mkdir(path.join(repo.dbPath, '.codenexus'), { recursive: true });
    await fs.writeFile(path.join(repo.dbPath, '.codenexus', 'config.toml'), 'version = 1\nport = 99999\n', 'utf-8');

    await initCommand();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();

    await repo.cleanup();
  });

  it('fails outside a git repository', async () => {
    const handle = await createTempDir('init-command-nonrepo-');
    process.chdir(handle.dbPath);

    await initCommand();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Not inside a git repository.');

    await handle.cleanup();
  });

  it('initializes the nearest nested repo boundary, not the parent repo', async () => {
    const outer = await createGitRepo('init-command-outer-');
    const nestedPath = path.join(outer.dbPath, 'nested');
    await fs.mkdir(nestedPath, { recursive: true });
    execSync('git init -q', { cwd: nestedPath });
    execSync('git config user.email "test@example.com"', { cwd: nestedPath });
    execSync('git config user.name "Test User"', { cwd: nestedPath });
    await fs.writeFile(path.join(nestedPath, 'README.md'), 'nested\n', 'utf-8');
    execSync('git add README.md', { cwd: nestedPath });
    execSync('git commit -q -m "nested init"', { cwd: nestedPath });

    process.chdir(nestedPath);
    await initCommand();

    await expect(fs.access(path.join(nestedPath, '.codenexus', 'config.toml'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outer.dbPath, '.codenexus', 'config.toml'))).rejects.toThrow();

    await outer.cleanup();
  });

  it('initializes the active worktree boundary', async () => {
    const repo = await createGitRepo('init-command-worktree-');
    const worktreePath = path.join(path.dirname(repo.dbPath), `worktree-${Date.now()}`);
    execSync(`git worktree add -q -b worktree-branch ${JSON.stringify(worktreePath)}`, { cwd: repo.dbPath });

    process.chdir(worktreePath);
    await initCommand();

    await expect(fs.access(path.join(worktreePath, '.codenexus', 'config.toml'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(repo.dbPath, '.codenexus', 'config.toml'))).rejects.toThrow();

    await fs.rm(worktreePath, { recursive: true, force: true });
    await repo.cleanup();
  });
});
