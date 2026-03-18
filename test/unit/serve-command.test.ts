import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { serveCommand } from '../../src/cli/serve.js';
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

describe('serveCommand', () => {
  const originalCwd = process.cwd();
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = 0;
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
  });

  it('fails clearly when the repo is not initialized', async () => {
    const repo = await createGitRepo('serve-command-uninitialized-');
    process.chdir(repo.dbPath);

    await serveCommand();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('Run `gnexus manage init` first');

    await repo.cleanup();
  });
});
