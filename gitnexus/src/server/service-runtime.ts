import express from 'express';
import http from 'http';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { mountMCPEndpoints } from './mcp-http.js';
import {
  extractLoadedIndexIdentity,
  getRepoState,
  getStoragePaths,
  probeServiceHealth,
  removeRuntimeMeta,
  resolveRepoBoundary,
  saveRuntimeMeta,
  type CodeNexusConfig,
  type RepoStateSnapshot,
  type ServiceHealth,
} from '../storage/repo-manager.js';

export class ServiceStartupError extends Error {}

export class DuplicateServiceError extends ServiceStartupError {
  constructor(public readonly health: ServiceHealth) {
    super(`CodeNexus service is already running for this repo on port ${health.port} (pid ${health.pid}).`);
  }
}

export interface RunningService {
  repoRoot: string;
  worktreeRoot: string;
  port: number;
  degraded: boolean;
  health: ServiceHealth;
  close: () => Promise<void>;
  waitUntilClosed: () => Promise<void>;
}

function buildHealthPayload(
  repoRoot: string,
  worktreeRoot: string,
  config: CodeNexusConfig,
  startedAt: string,
  state: RepoStateSnapshot,
): ServiceHealth {
  if (!state.meta) {
    throw new ServiceStartupError('No usable CodeNexus index exists. Run `codenexus index` first.');
  }

  return {
    version: 1,
    service: 'codenexus',
    pid: process.pid,
    port: config.port,
    started_at: startedAt,
    repo_root: repoRoot,
    worktree_root: worktreeRoot,
    loaded_index: extractLoadedIndexIdentity(state.meta),
  };
}

function requireStartableState(state: RepoStateSnapshot): void {
  switch (state.baseState) {
    case 'uninitialized':
      throw new ServiceStartupError('Repo is not initialized for CodeNexus. Run `codenexus init` first.');
    case 'invalid_config':
      throw new ServiceStartupError(
        state.configError
          ? `Invalid CodeNexus config: ${state.configError}`
          : 'Invalid CodeNexus config.',
      );
    case 'initialized_unindexed':
      throw new ServiceStartupError('No usable CodeNexus index exists. Run `codenexus index` first.');
    case 'indexed_current':
    case 'indexed_stale':
      return;
    case 'serving_current':
    case 'serving_stale':
      return;
    default:
      throw new ServiceStartupError(`Unsupported repo state: ${state.baseState}`);
  }
}

async function createBoundBackend(repoRoot: string): Promise<LocalBackend> {
  const backend = new LocalBackend(repoRoot);
  const initialized = await backend.init();
  if (!initialized) {
    throw new ServiceStartupError('No usable CodeNexus index exists. Run `codenexus index` first.');
  }
  return backend;
}

async function bindServer(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error & { code?: string }) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export async function startRepoLocalService(startPath = process.cwd()): Promise<RunningService> {
  const boundary = resolveRepoBoundary(startPath);
  if (!boundary) {
    throw new ServiceStartupError('Not inside a git repository.');
  }

  const { repoRoot, worktreeRoot } = boundary;
  const state = await getRepoState(repoRoot);
  if (!state) {
    throw new ServiceStartupError('Not inside a git repository.');
  }

  requireStartableState(state);

  if (!state.config) {
    throw new ServiceStartupError('Missing CodeNexus config. Run `codenexus init` first.');
  }

  if (state.baseState === 'serving_current' || state.baseState === 'serving_stale') {
    const liveHealth = await probeServiceHealth(state.config.port);
    if (
      liveHealth &&
      liveHealth.repo_root === repoRoot &&
      liveHealth.worktree_root === worktreeRoot &&
      liveHealth.port === state.config.port
    ) {
      throw new DuplicateServiceError(liveHealth);
    }
  }

  const existingHealth = await probeServiceHealth(state.config.port);
  if (
    existingHealth &&
    existingHealth.repo_root === repoRoot &&
    existingHealth.worktree_root === worktreeRoot &&
    existingHealth.port === state.config.port
  ) {
    throw new DuplicateServiceError(existingHealth);
  }

  const backend = await createBoundBackend(repoRoot);
  const startedAt = new Date().toISOString();
  const health = buildHealthPayload(repoRoot, worktreeRoot, state.config, startedAt, state);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const cleanupMcp = mountMCPEndpoints(app, backend, {
    healthProvider: () => health,
  });
  const server = http.createServer(app);

  try {
    await bindServer(server, state.config.port);
  } catch (error) {
    await cleanupMcp();
    await backend.disconnect();

    const portError = error as Error & { code?: string };
    if (portError.code === 'EADDRINUSE') {
      const liveHealth = await probeServiceHealth(state.config.port);
      if (
        liveHealth &&
        liveHealth.repo_root === repoRoot &&
        liveHealth.worktree_root === worktreeRoot &&
        liveHealth.port === state.config.port
      ) {
        throw new DuplicateServiceError(liveHealth);
      }

      throw new ServiceStartupError(`Configured port ${state.config.port} is already in use.`);
    }

    throw error;
  }

  const { storagePath } = getStoragePaths(repoRoot);
  try {
    await saveRuntimeMeta(storagePath, {
      version: 1,
      pid: process.pid,
      port: state.config.port,
      started_at: startedAt,
      repo_root: repoRoot,
      worktree_root: worktreeRoot,
      loaded_index: health.loaded_index,
    });
  } catch (error) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await cleanupMcp();
    await backend.disconnect();
    throw error;
  }

  let closed = false;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const close = async () => {
    if (closed) return;
    closed = true;

    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await cleanupMcp();
    await backend.disconnect();
    await removeRuntimeMeta(storagePath);
    resolveClosed();
  };

  const onSignal = () => {
    void close();
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return {
    repoRoot,
    worktreeRoot,
    port: state.config.port,
    degraded: state.baseState === 'indexed_stale',
    health,
    close,
    waitUntilClosed: () => closedPromise,
  };
}
