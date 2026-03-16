import { initKuzu, isKuzuReady, reloadKuzu } from '../core/kuzu-adapter.js';
import {
  getRepoState,
  loadRepo,
  resolveRepoBoundary,
} from '../../storage/repo-manager.js';
import type { CodebaseContext, RepoFreshnessSummary, RepoHandle } from './local-backend-types.js';

export class LocalBackendRuntimeSupport {
  private repo: RepoHandle | null = null;
  private contextCache: CodebaseContext | null = null;
  private initialized = false;

  constructor(private readonly startPath = process.cwd()) {}

  async init(): Promise<boolean> {
    const boundary = resolveRepoBoundary(this.startPath);
    if (!boundary) return false;

    const indexedRepo = await loadRepo(boundary.repoRoot);
    if (!indexedRepo) {
      this.repo = null;
      this.contextCache = null;
      this.initialized = false;
      return false;
    }

    this.repo = {
      id: indexedRepo.repoPath,
      name: indexedRepo.repoPath.split(/[\\/]/).pop() || indexedRepo.repoPath,
      repoPath: indexedRepo.repoPath,
      storagePath: indexedRepo.storagePath,
      kuzuPath: indexedRepo.kuzuPath,
      indexedAt: indexedRepo.meta.indexed_at,
      lastCommit: indexedRepo.meta.indexed_head,
      stats: indexedRepo.meta.stats,
    };
    this.updateRepoHandleFromIndexedRepo(indexedRepo);
    this.initialized = false;
    return true;
  }

  async resolveRepo(repoParam?: string): Promise<RepoHandle> {
    if (repoParam) {
      throw new Error('The "repo" parameter is no longer supported. The runtime is bound to the current repo boundary.');
    }
    if (this.repo) return this.repo;
    throw new Error('No usable local index for the current repo boundary. Create .codenexus/config.toml and run codenexus manage index.');
  }

  async reload(): Promise<void> {
    const repo = await this.resolveRepo();
    await reloadKuzu(repo.id, repo.kuzuPath);
    await this.refreshRepoHandle(repo.repoPath);
    this.initialized = true;
  }

  getContext(repoId?: string): CodebaseContext | null {
    if (repoId && this.repo && repoId !== this.repo.id && repoId !== this.repo.name.toLowerCase()) {
      return null;
    }
    return this.contextCache;
  }

  async refreshRepoHandle(repoRoot: string): Promise<void> {
    const indexedRepo = await loadRepo(repoRoot);
    this.updateRepoHandleFromIndexedRepo(indexedRepo);
  }

  async getRepoFreshnessSummary(repoRoot: string): Promise<RepoFreshnessSummary | null> {
    const state = await getRepoState(repoRoot);
    if (!state) {
      return null;
    }

    return {
      state: state.baseState,
      indexed_at: state.meta?.indexed_at ?? null,
      loaded_service_commit: state.liveHealth?.loaded_index.indexed_head ?? state.runtime?.loaded_index.indexed_head ?? null,
      indexed_commit: state.meta?.indexed_head ?? null,
      current_commit: state.currentHead || null,
      detail_flags: [...state.detailFlags],
    };
  }

  async ensureInitialized(repoId: string): Promise<void> {
    if (this.initialized && isKuzuReady(repoId)) return;

    const handle = await this.resolveRepo();

    try {
      await initKuzu(repoId, handle.kuzuPath);
      this.initialized = true;
    } catch (err: any) {
      this.initialized = false;
      throw err;
    }
  }

  disconnect(): void {
    this.repo = null;
    this.contextCache = null;
    this.initialized = false;
  }

  private updateRepoHandleFromIndexedRepo(indexedRepo: Awaited<ReturnType<typeof loadRepo>>): void {
    if (!indexedRepo || !this.repo) {
      return;
    }

    this.repo = {
      ...this.repo,
      repoPath: indexedRepo.repoPath,
      storagePath: indexedRepo.storagePath,
      kuzuPath: indexedRepo.kuzuPath,
      indexedAt: indexedRepo.meta.indexed_at,
      lastCommit: indexedRepo.meta.indexed_head,
      stats: indexedRepo.meta.stats,
    };

    const stats = indexedRepo.meta.stats || {};
    this.contextCache = {
      projectName: this.repo.name,
      stats: {
        fileCount: stats.files || 0,
        functionCount: stats.nodes || 0,
        communityCount: stats.communities || 0,
        processCount: stats.processes || 0,
      },
    };
  }
}
