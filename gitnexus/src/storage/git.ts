import { execSync } from 'child_process';
import path from 'path';

// Git utilities for repository detection, commit tracking, and diff analysis

export const isGitRepo = (repoPath: string): boolean => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: repoPath, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export const getCurrentCommit = (repoPath: string): string => {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
  } catch {
    return '';
  }
};

export const getCurrentBranch = (repoPath: string): string => {
  try {
    return execSync('git branch --show-current', { cwd: repoPath }).toString().trim();
  } catch {
    return '';
  }
};

export const isWorkingTreeDirty = (repoPath: string): boolean => {
  try {
    const output = execSync('git status --porcelain', { cwd: repoPath }).toString().trim();
    return output.length > 0;
  } catch {
    return false;
  }
};

/**
 * Find the git repository root from any path inside the repo
 */
export const getGitRoot = (fromPath: string): string | null => {
  try {
    const raw = execSync('git rev-parse --show-toplevel', { cwd: fromPath })
      .toString()
      .trim();
    // On Windows, git returns /d/Projects/Foo — path.resolve normalizes to D:\Projects\Foo
    return path.resolve(raw);
  } catch {
    return null;
  }
};
