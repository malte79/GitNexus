import express from 'express';
import http from 'http';
import { spawn } from 'child_process';
import { resolveCliInvocation } from '../cli/entrypoint-path.js';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { mountMCPEndpoints } from './mcp-http.js';
import {
  extractLoadedIndexIdentity,
  getRepoState,
  getOnDiskRepoState,
  getStoragePaths,
  isIndexLocked,
  loadMeta,
  probeServiceHealth,
  removeRuntimeMeta,
  resolveRepoBoundary,
  saveRuntimeMeta,
  type AutoIndexStatus,
  type gnexusConfig,
  type LoadedIndexIdentity,
  type RepoStateSnapshot,
  type RuntimeMeta,
  type ServiceHealth,
} from '../storage/repo-manager.js';

export class ServiceStartupError extends Error {}

export class DuplicateServiceError extends ServiceStartupError {
  constructor(public readonly health: ServiceHealth) {
    super(`gnexus service is already running for this repo on port ${health.port} (pid ${health.pid}).`);
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
  config: gnexusConfig,
  startedAt: string,
  state: RepoStateSnapshot,
  mode: ServiceMode,
  autoIndex: AutoIndexStatus,
  reloadError?: string,
): ServiceHealth {
  if (!state.meta) {
    throw new ServiceStartupError('No usable gnexus index exists. Run `gnexus manage index` first.');
  }

  return {
    version: 1,
    service: 'gnexus',
    pid: process.pid,
    port: config.port,
    mode,
    started_at: startedAt,
    repo_root: repoRoot,
    worktree_root: worktreeRoot,
    loaded_index: extractLoadedIndexIdentity(state.meta),
    reload_error: reloadError,
    auto_index: autoIndex,
  };
}

const AUTO_INDEX_FAILURE_BACKOFF_MULTIPLIER = 2;
const AUTO_INDEX_MAX_FAILURE_EXPONENT = 3;

function buildAutoIndexStatus(config: gnexusConfig): AutoIndexStatus {
  return {
    enabled: config.auto_index,
    interval_seconds: config.auto_index_interval_seconds,
  };
}

function buildAutoIndexBackoffUntil(
  now: Date,
  intervalSeconds: number,
  failureCount: number,
): string {
  const exponent = Math.min(failureCount - 1, AUTO_INDEX_MAX_FAILURE_EXPONENT);
  const seconds =
    intervalSeconds * Math.pow(AUTO_INDEX_FAILURE_BACKOFF_MULTIPLIER, exponent);
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function requireStartableState(state: RepoStateSnapshot): void {
  switch (state.baseState) {
    case 'uninitialized':
      throw new ServiceStartupError('Repo is not initialized for gnexus. Run `gnexus manage init` first.');
    case 'invalid_config':
      throw new ServiceStartupError(
        state.configError
          ? `Invalid gnexus config: ${state.configError}`
          : 'Invalid gnexus config.',
      );
    case 'initialized_unindexed':
      throw new ServiceStartupError('No usable gnexus index exists. Run `gnexus manage index` first.');
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
    throw new ServiceStartupError('No usable gnexus index exists. Run `gnexus manage index` first.');
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
    `Configured port ${liveHealth.port} is already in use by gnexus for repo ${liveHealth.repo_root}.`,
  );
}

async function assertNoConflictinggnexusService(
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
  const mode: ServiceMode = process.env.GNEXUS_SERVICE_MODE === 'background' ? 'background' : 'foreground';
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
    throw new ServiceStartupError('Missing gnexus config. Run `gnexus manage init` first.');
  }

  if (state.baseState === 'serving_current' || state.baseState === 'serving_stale') {
    const liveHealth = await probeServiceHealth(state.config.port);
    if (isMatchingHealth(liveHealth, repoRoot, worktreeRoot, state.config.port)) {
      throw new DuplicateServiceError(liveHealth);
    }
  }

  await assertNoConflictinggnexusService(state.config.port, repoRoot, worktreeRoot);

  const backend = await createBoundBackend(repoRoot);
  const startedAt = new Date().toISOString();
  let autoIndexStatus = buildAutoIndexStatus(state.config);
  let health = buildHealthPayload(repoRoot, worktreeRoot, state.config, startedAt, state, mode, autoIndexStatus);

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
      auto_index: autoIndexStatus,
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
  let autoIndexPromise: Promise<void> | null = null;
  let autoIndexFailureCount = 0;
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
        autoIndexStatus = {
          ...autoIndexStatus,
          last_error: undefined,
          backoff_until: undefined,
        };
        health = {
          ...health,
          loaded_index: extractLoadedIndexIdentity(meta),
          reload_error: undefined,
          auto_index: autoIndexStatus,
        };
        lastFailedGeneration = null;
        await persistRuntime();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        health = {
          ...health,
          reload_error: message,
          auto_index: autoIndexStatus,
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

  const runAutoIndex = async () => {
    if (closed || autoIndexPromise || !state.config.auto_index || mode !== 'background') {
      return;
    }

    const now = new Date();
    if (autoIndexStatus.backoff_until && new Date(autoIndexStatus.backoff_until) > now) {
      return;
    }

    const onDiskState = await getOnDiskRepoState(repoRoot);
    if (!onDiskState || onDiskState.baseState !== 'indexed_stale') {
      return;
    }

    if (reloadPromise || (await isIndexLocked(storagePath))) {
      return;
    }

    autoIndexStatus = {
      ...autoIndexStatus,
      last_attempt_at: now.toISOString(),
    };
    health = {
      ...health,
      auto_index: autoIndexStatus,
    };
    await persistRuntime();

    autoIndexPromise = (async () => {
      const cliInvocation = resolveCliInvocation(['manage', 'index', repoRoot]);
      const child = spawn(cliInvocation.command, cliInvocation.args, {
        cwd: repoRoot,
        env: {
          ...process.env,
          GNEXUS_INDEX_REASON: 'auto',
        },
        stdio: 'ignore',
        detached: false,
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code));
      });

      const finishedAt = new Date();
      if (exitCode === 0) {
        autoIndexFailureCount = 0;
        autoIndexStatus = {
          ...autoIndexStatus,
          last_succeeded_at: finishedAt.toISOString(),
          last_failed_at: undefined,
          last_error: undefined,
          backoff_until: undefined,
        };
      } else {
        autoIndexFailureCount += 1;
        autoIndexStatus = {
          ...autoIndexStatus,
          last_failed_at: finishedAt.toISOString(),
          last_error: `Auto-index exited with code ${exitCode ?? 'unknown'}`,
          backoff_until: buildAutoIndexBackoffUntil(
            finishedAt,
            state.config.auto_index_interval_seconds,
            autoIndexFailureCount,
          ),
        };
      }

      health = {
        ...health,
        auto_index: autoIndexStatus,
      };
      await persistRuntime();
    })()
      .catch(async (error) => {
        autoIndexFailureCount += 1;
        const failedAt = new Date();
        autoIndexStatus = {
          ...autoIndexStatus,
          last_failed_at: failedAt.toISOString(),
          last_error: error instanceof Error ? error.message : String(error),
          backoff_until: buildAutoIndexBackoffUntil(
            failedAt,
            state.config.auto_index_interval_seconds,
            autoIndexFailureCount,
          ),
        };
        health = {
          ...health,
          auto_index: autoIndexStatus,
        };
        await persistRuntime();
      })
      .finally(() => {
        autoIndexPromise = null;
      });

    await autoIndexPromise;
  };

  const autoIndexTimer =
    mode === 'background' && state.config.auto_index
      ? setInterval(() => {
          void runAutoIndex();
        }, state.config.auto_index_interval_seconds * 1000)
      : null;
  autoIndexTimer?.unref?.();

  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(reloadTimer);
    if (autoIndexTimer) {
      clearInterval(autoIndexTimer);
    }

    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);

    if (reloadPromise) {
      await reloadPromise.catch(() => {});
    }
    if (autoIndexPromise) {
      await autoIndexPromise.catch(() => {});
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
    throw new ServiceStartupError('Repo is not initialized for gnexus. Run `gnexus manage init` first.');
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
    throw new ServiceStartupError(`Timed out waiting for gnexus service on port ${health.port} to stop.`);
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
    throw new ServiceStartupError('Repo is not initialized for gnexus. Run `gnexus manage init` first.');
  }

  await assertNoConflictinggnexusService(state.config.port, boundary.repoRoot, boundary.worktreeRoot);

  const liveHealth = await waitForServiceHealth(
    state.config.port,
    boundary.repoRoot,
    boundary.worktreeRoot,
    timeoutMs,
  );
  if (!liveHealth) {
    throw new ServiceStartupError(`Timed out waiting for gnexus service on port ${state.config.port} to start.`);
  }
  return liveHealth;
}
