import { realpathSync } from 'fs';
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { getCurrentBranch, getCurrentCommit, getGitRoot, isWorkingTreeDirty } from './git.js';

export const CODENEXUS_DIR = '.codenexus';

export type RepoBaseState =
  | 'uninitialized'
  | 'invalid_config'
  | 'initialized_unindexed'
  | 'indexed_current'
  | 'indexed_stale'
  | 'serving_current'
  | 'serving_stale';

export type RepoDetailFlag =
  | 'runtime_metadata_stale'
  | 'working_tree_dirty'
  | 'head_changed'
  | 'branch_changed'
  | 'wrong_worktree';

export interface CodeNexusConfig {
  version: 1;
  port: number;
}

export interface RepoMeta {
  version: 1;
  indexed_head: string;
  indexed_branch: string;
  indexed_at: string;
  indexed_dirty: boolean;
  worktree_root: string;
  stats?: {
    files?: number;
    nodes?: number;
    edges?: number;
    communities?: number;
    processes?: number;
  };
}

export interface RuntimeMeta {
  version: 1;
  pid: number;
  port: number;
  started_at: string;
  repo_root: string;
  worktree_root: string;
}

export interface RepoBoundary {
  repoRoot: string;
  worktreeRoot: string;
}

export interface RepoPaths {
  storagePath: string;
  configPath: string;
  metaPath: string;
  kuzuPath: string;
  runtimePath: string;
}

export interface IndexedRepo {
  repoPath: string;
  worktreeRoot: string;
  storagePath: string;
  kuzuPath: string;
  metaPath: string;
  runtimePath: string;
  config: CodeNexusConfig;
  meta: RepoMeta;
}

export interface RepoStateSnapshot {
  repoRoot: string;
  worktreeRoot: string;
  storagePath: string;
  baseState: RepoBaseState;
  detailFlags: RepoDetailFlag[];
  config: CodeNexusConfig | null;
  meta: RepoMeta | null;
  runtime: RuntimeMeta | null;
  currentHead: string;
  currentBranch: string;
  configError?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositivePort(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0 && value <= 65535;
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isPortReachable(port: number, host = '127.0.0.1', timeoutMs = 150): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function validateConfig(raw: unknown): CodeNexusConfig {
  if (!isRecord(raw)) {
    throw new Error('Config must be a TOML object');
  }
  if (raw.version !== 1) {
    throw new Error('Config version must be 1');
  }
  if (!isPositivePort(raw.port)) {
    throw new Error('Config port must be an integer between 1 and 65535');
  }
  return {
    version: 1,
    port: raw.port,
  };
}

function validateMeta(raw: unknown): RepoMeta {
  if (!isRecord(raw)) {
    throw new Error('Index metadata must be an object');
  }
  if (raw.version !== 1) {
    throw new Error('Index metadata version must be 1');
  }
  if (typeof raw.indexed_head !== 'string') {
    throw new Error('Index metadata indexed_head must be a string');
  }
  if (typeof raw.indexed_branch !== 'string') {
    throw new Error('Index metadata indexed_branch is required');
  }
  if (typeof raw.indexed_at !== 'string' || !raw.indexed_at) {
    throw new Error('Index metadata indexed_at is required');
  }
  if (typeof raw.indexed_dirty !== 'boolean') {
    throw new Error('Index metadata indexed_dirty is required');
  }
  if (typeof raw.worktree_root !== 'string' || !raw.worktree_root) {
    throw new Error('Index metadata worktree_root is required');
  }

  return {
    version: 1,
    indexed_head: raw.indexed_head,
    indexed_branch: raw.indexed_branch,
    indexed_at: raw.indexed_at,
    indexed_dirty: raw.indexed_dirty,
    worktree_root: normalizePath(raw.worktree_root),
    stats: isRecord(raw.stats) ? {
      files: typeof raw.stats.files === 'number' ? raw.stats.files : undefined,
      nodes: typeof raw.stats.nodes === 'number' ? raw.stats.nodes : undefined,
      edges: typeof raw.stats.edges === 'number' ? raw.stats.edges : undefined,
      communities: typeof raw.stats.communities === 'number' ? raw.stats.communities : undefined,
      processes: typeof raw.stats.processes === 'number' ? raw.stats.processes : undefined,
    } : undefined,
  };
}

function validateRuntime(raw: unknown): RuntimeMeta {
  if (!isRecord(raw)) {
    throw new Error('Runtime metadata must be an object');
  }
  if (raw.version !== 1) {
    throw new Error('Runtime metadata version must be 1');
  }
  if (!Number.isInteger(raw.pid)) {
    throw new Error('Runtime metadata pid is required');
  }
  if (!isPositivePort(raw.port)) {
    throw new Error('Runtime metadata port is required');
  }
  if (typeof raw.started_at !== 'string' || !raw.started_at) {
    throw new Error('Runtime metadata started_at is required');
  }
  if (typeof raw.repo_root !== 'string' || !raw.repo_root) {
    throw new Error('Runtime metadata repo_root is required');
  }
  if (typeof raw.worktree_root !== 'string' || !raw.worktree_root) {
    throw new Error('Runtime metadata worktree_root is required');
  }

  return {
    version: 1,
    pid: raw.pid as number,
    port: raw.port,
    started_at: raw.started_at,
    repo_root: normalizePath(raw.repo_root),
    worktree_root: normalizePath(raw.worktree_root),
  };
}

export function getStoragePath(repoPath: string): string {
  return path.join(path.resolve(repoPath), CODENEXUS_DIR);
}

export function getStoragePaths(repoPath: string): RepoPaths {
  const storagePath = getStoragePath(repoPath);
  return {
    storagePath,
    configPath: path.join(storagePath, 'config.toml'),
    metaPath: path.join(storagePath, 'meta.json'),
    kuzuPath: path.join(storagePath, 'kuzu'),
    runtimePath: path.join(storagePath, 'runtime.json'),
  };
}

export function resolveRepoBoundary(fromPath: string): RepoBoundary | null {
  const repoRoot = getGitRoot(fromPath);
  if (!repoRoot) return null;

  return {
    repoRoot,
    worktreeRoot: repoRoot,
  };
}

export async function loadConfig(storagePath: string): Promise<CodeNexusConfig | null> {
  const configPath = path.join(storagePath, 'config.toml');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return validateConfig(parseToml(raw));
  } catch {
    return null;
  }
}

export async function loadConfigStrict(storagePath: string): Promise<CodeNexusConfig> {
  const configPath = path.join(storagePath, 'config.toml');
  const raw = await fs.readFile(configPath, 'utf-8');
  return validateConfig(parseToml(raw));
}

export async function saveConfig(storagePath: string, config: CodeNexusConfig): Promise<void> {
  await fs.mkdir(storagePath, { recursive: true });
  const configPath = path.join(storagePath, 'config.toml');
  await fs.writeFile(configPath, stringifyToml(config), 'utf-8');
}

export async function loadMeta(storagePath: string): Promise<RepoMeta | null> {
  try {
    const metaPath = path.join(storagePath, 'meta.json');
    const raw = await fs.readFile(metaPath, 'utf-8');
    return validateMeta(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function loadMetaStrict(storagePath: string): Promise<RepoMeta> {
  const metaPath = path.join(storagePath, 'meta.json');
  const raw = await fs.readFile(metaPath, 'utf-8');
  return validateMeta(JSON.parse(raw));
}

export async function saveMeta(storagePath: string, meta: RepoMeta): Promise<void> {
  await fs.mkdir(storagePath, { recursive: true });
  const metaPath = path.join(storagePath, 'meta.json');
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

export async function loadRuntimeMeta(storagePath: string): Promise<RuntimeMeta | null> {
  try {
    const runtimePath = path.join(storagePath, 'runtime.json');
    const raw = await fs.readFile(runtimePath, 'utf-8');
    return validateRuntime(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveRuntimeMeta(storagePath: string, runtime: RuntimeMeta): Promise<void> {
  await fs.mkdir(storagePath, { recursive: true });
  const runtimePath = path.join(storagePath, 'runtime.json');
  await fs.writeFile(runtimePath, JSON.stringify(runtime, null, 2), 'utf-8');
}

export async function hasIndex(repoPath: string): Promise<boolean> {
  const { storagePath, kuzuPath } = getStoragePaths(repoPath);
  const meta = await loadMeta(storagePath);
  const kuzuExists = await pathExists(kuzuPath);
  return meta !== null && kuzuExists;
}

export async function loadRepo(repoPath: string): Promise<IndexedRepo | null> {
  const resolvedRepoPath = path.resolve(repoPath);
  const { storagePath, kuzuPath, metaPath, runtimePath } = getStoragePaths(resolvedRepoPath);
  const [config, meta, kuzuExists] = await Promise.all([
    loadConfig(storagePath),
    loadMeta(storagePath),
    pathExists(kuzuPath),
  ]);

  if (!config || !meta || !kuzuExists) {
    return null;
  }

  return {
    repoPath: resolvedRepoPath,
    worktreeRoot: resolvedRepoPath,
    storagePath,
    kuzuPath,
    metaPath,
    runtimePath,
    config,
    meta,
  };
}

export async function findRepo(startPath: string): Promise<IndexedRepo | null> {
  const boundary = resolveRepoBoundary(startPath);
  if (!boundary) return null;
  return loadRepo(boundary.repoRoot);
}

export async function getRepoState(startPath: string): Promise<RepoStateSnapshot | null> {
  const boundary = resolveRepoBoundary(startPath);
  if (!boundary) return null;

  const { repoRoot, worktreeRoot } = boundary;
  const { storagePath, configPath, kuzuPath } = getStoragePaths(repoRoot);
  const detailFlags: RepoDetailFlag[] = [];

  const currentHead = getCurrentCommit(repoRoot);
  const currentBranch = getCurrentBranch(repoRoot);
  const workingTreeDirty = isWorkingTreeDirty(repoRoot);

  const configExists = await pathExists(configPath);
  if (!configExists) {
    return {
      repoRoot,
      worktreeRoot,
      storagePath,
      baseState: 'uninitialized',
      detailFlags,
      config: null,
      meta: null,
      runtime: null,
      currentHead,
      currentBranch,
    };
  }

  let config: CodeNexusConfig | null = null;
  let configError: string | undefined;
  try {
    config = await loadConfigStrict(storagePath);
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }

  if (!config) {
    return {
      repoRoot,
      worktreeRoot,
      storagePath,
      baseState: 'invalid_config',
      detailFlags,
      config: null,
      meta: null,
      runtime: null,
      currentHead,
      currentBranch,
      configError,
    };
  }

  const [meta, runtime, kuzuExists] = await Promise.all([
    loadMeta(storagePath),
    loadRuntimeMeta(storagePath),
    pathExists(kuzuPath),
  ]);

  if (!meta || !kuzuExists) {
    return {
      repoRoot,
      worktreeRoot,
      storagePath,
      baseState: 'initialized_unindexed',
      detailFlags,
      config,
      meta,
      runtime,
      currentHead,
      currentBranch,
    };
  }

  if (workingTreeDirty) detailFlags.push('working_tree_dirty');
  if (currentHead !== meta.indexed_head) detailFlags.push('head_changed');
  if (currentBranch !== meta.indexed_branch) detailFlags.push('branch_changed');
  if (normalizePath(meta.worktree_root) !== worktreeRoot) detailFlags.push('wrong_worktree');

  const stale =
    workingTreeDirty ||
    currentHead !== meta.indexed_head ||
    currentBranch !== meta.indexed_branch ||
    normalizePath(meta.worktree_root) !== worktreeRoot;

  const livePortReachable = await isPortReachable(config.port);
  const runtimeMatchesBoundary = runtime
    ? runtime.repo_root === repoRoot &&
      runtime.worktree_root === worktreeRoot &&
      runtime.port === config.port
    : false;
  const runtimeProcessAlive = runtime ? isPidAlive(runtime.pid) : false;
  const liveServiceDetected = livePortReachable && runtimeMatchesBoundary && runtimeProcessAlive;
  const runtimeMetadataStale =
    (livePortReachable && (!runtime || !runtimeMatchesBoundary || !runtimeProcessAlive)) ||
    (!!runtime && (!runtimeMatchesBoundary || !runtimeProcessAlive || !livePortReachable));

  if (runtimeMetadataStale) {
    detailFlags.push('runtime_metadata_stale');
  }

  const baseState: RepoBaseState = liveServiceDetected
    ? (stale ? 'serving_stale' : 'serving_current')
    : (stale ? 'indexed_stale' : 'indexed_current');

  return {
    repoRoot,
    worktreeRoot,
    storagePath,
    baseState,
    detailFlags,
    config,
    meta,
    runtime,
    currentHead,
    currentBranch,
  };
}
