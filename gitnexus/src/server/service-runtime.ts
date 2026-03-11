import express from 'express';
import http from 'http';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { mountMCPEndpoints } from './mcp-http.js';
import {
  extractLoadedIndexIdentity,
  getRepoState,
  getStoragePaths,
  loadMeta,
  probeServiceHealth,
  removeRuntimeMeta,
  resolveRepoBoundary,
  saveRuntimeMeta,
  type CodeNexusConfig,
  type LoadedIndexIdentity,
  type RepoStateSnapshot,
  type RuntimeMeta,
  type ServiceHealth,
} from '../storage/repo-manager.js';

export class ServiceStartupError extends Error {}

export class DuplicateServiceError extends ServiceStartupError {
  constructor(public readonly health: ServiceHealth) {
    super(`CodeNexus service is already running for this repo on port ${health.port} (pid ${health.pid}).`);
  }
}

export type ServiceMode = 'foreground' | 'background';

export interface RunningService {
  repoRoot: string;
  worktreeRoot: string;
  port: number;
  mode: ServiceMode;
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
  mode: ServiceMode,
  reloadError?: string,
): ServiceHealth {
  if (!state.meta) {
    throw new ServiceStartupError('No usable CodeNexus index exists. Run `codenexus index` first.');
  }

  return {
    version: 1,
    service: 'codenexus',
    pid: process.pid,
    port: config.port,
    mode,
    started_at: startedAt,
    repo_root: repoRoot,
    worktree_root: worktreeRoot,
    loaded_index: extractLoadedIndexIdentity(state.meta),
    reload_error: reloadError,
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

function isMatchingHealth(
  liveHealth: ServiceHealth | null,
  repoRoot: string,
  worktreeRoot: string,
  port: number,
): liveHealth is ServiceHealth {
  return !!liveHealth &&
    liveHealth.repo_root === repoRoot &&
    liveHealth.worktree_root === worktreeRoot &&
    liveHealth.port === port;
}

function buildForeignServiceConflictError(
  liveHealth: ServiceHealth,
  repoRoot: string,
  worktreeRoot: string,
): ServiceStartupError {
  const samePortDifferentRepo = liveHealth.repo_root !== repoRoot || liveHealth.worktree_root !== worktreeRoot;
  if (!samePortDifferentRepo) {
    return new DuplicateServiceError(liveHealth);
  }

  return new ServiceStartupError(
    `Configured port ${liveHealth.port} is already in use by CodeNexus for repo ${liveHealth.repo_root}.`,
  );
}

async function assertNoConflictingCodeNexusService(
  port: number,
  repoRoot: string,
  worktreeRoot: string,
): Promise<void> {
  const liveHealth = await probeServiceHealth(port);
  if (!liveHealth) {
    return;
  }

  throw buildForeignServiceConflictError(liveHealth, repoRoot, worktreeRoot);
}

async function waitForServiceDown(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const liveHealth = await probeServiceHealth(port);
    if (!liveHealth) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function waitForServiceHealth(
  port: number,
  repoRoot: string,
  worktreeRoot: string,
  timeoutMs = 5000,
): Promise<ServiceHealth | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const liveHealth = await probeServiceHealth(port);
    if (isMatchingHealth(liveHealth, repoRoot, worktreeRoot, port)) {
      return liveHealth;
    }
    if (liveHealth) {
      throw buildForeignServiceConflictError(liveHealth, repoRoot, worktreeRoot);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
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
  const mode: ServiceMode = process.env.CODENEXUS_SERVICE_MODE === 'background' ? 'background' : 'foreground';
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
    if (isMatchingHealth(liveHealth, repoRoot, worktreeRoot, state.config.port)) {
      throw new DuplicateServiceError(liveHealth);
    }
  }

  await assertNoConflictingCodeNexusService(state.config.port, repoRoot, worktreeRoot);

  const backend = await createBoundBackend(repoRoot);
  const startedAt = new Date().toISOString();
  let health = buildHealthPayload(repoRoot, worktreeRoot, state.config, startedAt, state, mode);

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
      if (liveHealth) {
        throw buildForeignServiceConflictError(liveHealth, repoRoot, worktreeRoot);
      }

      throw new ServiceStartupError(`Configured port ${state.config.port} is already in use.`);
    }

    throw error;
  }

  const { storagePath } = getStoragePaths(repoRoot);
  const persistRuntime = async () => {
    const runtimeMeta: RuntimeMeta = {
      version: 1,
      pid: process.pid,
      port: state.config!.port,
      mode,
      started_at: startedAt,
      repo_root: repoRoot,
      worktree_root: worktreeRoot,
      loaded_index: health.loaded_index,
      reload_error: health.reload_error,
    };
    await saveRuntimeMeta(storagePath, runtimeMeta);
  };
  try {
    await persistRuntime();
  } catch (error) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await cleanupMcp();
    await backend.disconnect();
    throw error;
  }

  let closed = false;
  let reloadPromise: Promise<void> | null = null;
  let lastFailedGeneration: string | null = null;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const maybeReload = async () => {
    if (closed || reloadPromise) return;
    const meta = await loadMeta(storagePath);
    if (!meta) return;
    if (meta.index_generation === health.loaded_index.index_generation) {
      return;
    }
    if (lastFailedGeneration === meta.index_generation) {
      return;
    }

    reloadPromise = (async () => {
      try {
        await backend.reload();
        health = {
          ...health,
          loaded_index: extractLoadedIndexIdentity(meta),
          reload_error: undefined,
        };
        lastFailedGeneration = null;
        await persistRuntime();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        health = {
          ...health,
          reload_error: message,
        };
        lastFailedGeneration = meta.index_generation;
        await persistRuntime();
      } finally {
        reloadPromise = null;
      }
    })();

    await reloadPromise;
  };

  const reloadTimer = setInterval(() => {
    void maybeReload();
  }, 1000);
  reloadTimer.unref?.();

  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(reloadTimer);

    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);

    if (reloadPromise) {
      await reloadPromise.catch(() => {});
    }

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
    mode,
    degraded: state.baseState === 'indexed_stale',
    health,
    close,
    waitUntilClosed: () => closedPromise,
  };
}

export async function stopRepoLocalService(startPath = process.cwd()): Promise<{ stopped: boolean; cleanedStaleRuntime: boolean; health: ServiceHealth | null; }> {
  const boundary = resolveRepoBoundary(startPath);
  if (!boundary) {
    throw new ServiceStartupError('Not inside a git repository.');
  }

  const { repoRoot, worktreeRoot } = boundary;
  const state = await getRepoState(repoRoot);
  if (!state || !state.config) {
    throw new ServiceStartupError('Repo is not initialized for CodeNexus. Run `codenexus init` first.');
  }

  const { storagePath } = getStoragePaths(repoRoot);
  if (!state.liveHealth) {
    if (state.runtime) {
      await removeRuntimeMeta(storagePath);
      return { stopped: false, cleanedStaleRuntime: true, health: null };
    }
    return { stopped: false, cleanedStaleRuntime: false, health: null };
  }

  const health = state.liveHealth;
  try {
    process.kill(health.pid, 'SIGTERM');
  } catch (error) {
    await removeRuntimeMeta(storagePath);
    return { stopped: false, cleanedStaleRuntime: true, health };
  }

  const stopped = await waitForServiceDown(health.port);
  if (!stopped) {
    throw new ServiceStartupError(`Timed out waiting for CodeNexus service on port ${health.port} to stop.`);
  }

  await removeRuntimeMeta(storagePath);
  return { stopped: true, cleanedStaleRuntime: false, health };
}

export async function waitForRepoLocalService(startPath = process.cwd(), timeoutMs = 5000): Promise<ServiceHealth> {
  const boundary = resolveRepoBoundary(startPath);
  if (!boundary) {
    throw new ServiceStartupError('Not inside a git repository.');
  }

  const state = await getRepoState(boundary.repoRoot);
  if (!state?.config) {
    throw new ServiceStartupError('Repo is not initialized for CodeNexus. Run `codenexus init` first.');
  }

  await assertNoConflictingCodeNexusService(state.config.port, boundary.repoRoot, boundary.worktreeRoot);

  const liveHealth = await waitForServiceHealth(
    state.config.port,
    boundary.repoRoot,
    boundary.worktreeRoot,
    timeoutMs,
  );
  if (!liveHealth) {
    throw new ServiceStartupError(`Timed out waiting for CodeNexus service on port ${state.config.port} to start.`);
  }
  return liveHealth;
}
