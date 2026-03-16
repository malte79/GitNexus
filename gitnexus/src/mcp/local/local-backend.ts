/**
 * Local Backend
 *
 * Provides tool implementations for one repo-local .codenexus index.
 * The backend is bound to the nearest enclosing git repo boundary.
 * KuzuDB connections are opened lazily on first query.
 */

import fs from 'fs/promises';
import path from 'path';
import { initKuzu, executeQuery, executeParameterized, closeKuzu, isKuzuReady, reloadKuzu } from '../core/kuzu-adapter.js';
import { getNodeProperties, getPropertyResourceUri } from '../schema-properties.js';
import { generateId } from '../../lib/utils.js';
import {
  CYPHER_WRITE_RE,
  VALID_NODE_LABELS,
  VALID_RELATION_TYPES,
  isTestFilePath,
  isWriteQuery,
  logQueryError,
} from './local-backend-common.js';
import type {
  CodebaseContext,
  RepoFreshnessSummary,
  RepoHandle,
  MemberRecoverySource,
  RankedSearchResult,
} from './local-backend-types.js';
import { LocalBackendSearchSupport } from './local-backend-search-support.js';
import { LocalBackendSummarySupport } from './local-backend-summary-support.js';
import { LocalBackendAnalysisSupport } from './local-backend-analysis-support.js';
import {
  getRepoState,
  loadRepo,
  resolveRepoBoundary,
  type RepoMeta,
} from '../../storage/repo-manager.js';
export {
  CYPHER_WRITE_RE,
  VALID_NODE_LABELS,
  VALID_RELATION_TYPES,
  isTestFilePath,
  isWriteQuery,
};
export type { CodebaseContext } from './local-backend-types.js';

export class LocalBackend {
  private repo: RepoHandle | null = null;
  private contextCache: CodebaseContext | null = null;
  private initialized = false;
  private rojoProjectCache = new Map<string, Promise<any | null>>();
  private readonly searchSupport: LocalBackendSearchSupport;
  private readonly summarySupport: LocalBackendSummarySupport;
  private readonly analysisSupport: LocalBackendAnalysisSupport;

  constructor(private readonly startPath = process.cwd()) {
    this.searchSupport = new LocalBackendSearchSupport({
      ensureInitialized: this.ensureInitialized.bind(this),
      getOwnerSymbolsForFiles: this.getOwnerSymbolsForFiles.bind(this),
      getNodeKind: this.getNodeKind.bind(this),
      isOwnerLikeSymbolKind: this.isOwnerLikeSymbolKind.bind(this),
      isPrimaryOwnerKind: this.isPrimaryOwnerKind.bind(this),
      isLikelyProductionFile: this.isLikelyProductionFile.bind(this),
      isLikelyCodeFile: this.isLikelyCodeFile.bind(this),
      isPrimarySourceFile: this.isPrimarySourceFile.bind(this),
      isLowSignalSummarySymbol: this.isLowSignalSummarySymbol.bind(this),
      getOwnerSymbolPriority: this.getOwnerSymbolPriority.bind(this),
      rankOwnerCandidates: this.rankOwnerCandidates.bind(this),
      rankRepresentativeSymbols: this.rankRepresentativeSymbols.bind(this),
      rojoProjectCache: this.rojoProjectCache,
    });
    this.summarySupport = new LocalBackendSummarySupport({
      ensureInitialized: this.ensureInitialized.bind(this),
      refreshRepoHandle: this.refreshRepoHandle.bind(this),
      getRepoFreshnessSummary: this.getRepoFreshnessSummary.bind(this),
      getOwnerSymbolsForFiles: this.getOwnerSymbolsForFiles.bind(this),
      getNodeKind: this.getNodeKind.bind(this),
      isOwnerLikeSymbolKind: this.isOwnerLikeSymbolKind.bind(this),
      isPrimaryOwnerKind: this.isPrimaryOwnerKind.bind(this),
      isLikelyProductionFile: this.isLikelyProductionFile.bind(this),
      isLowSignalSummarySymbol: this.isLowSignalSummarySymbol.bind(this),
      getOwnerSymbolPriority: this.getOwnerSymbolPriority.bind(this),
      rankOwnerCandidates: this.rankOwnerCandidates.bind(this),
    });
    this.analysisSupport = new LocalBackendAnalysisSupport({
      ensureInitialized: this.ensureInitialized.bind(this),
      getRepoFreshnessSummary: this.getRepoFreshnessSummary.bind(this),
      getNodeKind: this.getNodeKind.bind(this),
      humanizeSummaryLabel: this.humanizeSummaryLabel.bind(this),
      isLowSignalSubsystemLabel: this.isLowSignalSubsystemLabel.bind(this),
      lookupNamedSymbols: this.lookupNamedSymbols.bind(this),
      getPrimaryModuleSymbols: this.getPrimaryModuleSymbols.bind(this),
      getRojoProjectIndex: this.getRojoProjectIndex.bind(this),
      getBoundaryImports: this.getBoundaryImports.bind(this),
      getContainedMembers: this.getContainedMembers.bind(this),
      classifyCoverageSignal: this.classifyCoverageSignal.bind(this),
      getDetailedAffectedAreas: this.getDetailedAffectedAreas.bind(this),
      getOwnerSymbolsForFiles: this.getOwnerSymbolsForFiles.bind(this),
    });
  }

  // ─── Initialization ──────────────────────────────────────────────

  /**
   * Initialize against the nearest enclosing repo boundary.
   * Returns true only when a usable local .codenexus index exists.
   */
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
      name: path.basename(indexedRepo.repoPath),
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

  // ─── Repo Resolution ─────────────────────────────────────────────

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

  private async refreshRepoHandle(repoRoot: string): Promise<void> {
    const indexedRepo = await loadRepo(repoRoot);
    this.updateRepoHandleFromIndexedRepo(indexedRepo);
  }

  private async getRepoFreshnessSummary(repoRoot: string): Promise<RepoFreshnessSummary | null> {
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

  // ─── Lazy KuzuDB Init ────────────────────────────────────────────

  private async ensureInitialized(repoId: string): Promise<void> {
    // Always check the actual pool — the idle timer may have evicted the connection
    if (this.initialized && isKuzuReady(repoId)) return;

    const handle = await this.resolveRepo();

    try {
      await initKuzu(repoId, handle.kuzuPath);
      this.initialized = true;
    } catch (err: any) {
      // If lock error, mark as not initialized so next call retries
      this.initialized = false;
      throw err;
    }
  }

  // ─── Public Getters ──────────────────────────────────────────────

  /**
   * Get context for the bound repo.
   */
  getContext(repoId?: string): CodebaseContext | null {
    if (repoId && this.repo && repoId !== this.repo.id && repoId !== this.repo.name.toLowerCase()) {
      return null;
    }
    return this.contextCache;
  }

  // ─── Tool Dispatch ───────────────────────────────────────────────

  async callTool(method: string, params: any): Promise<any> {
    const repo = await this.resolveRepo(params?.repo);

    switch (method) {
      case 'summary':
        return this.overview(repo, params);
      case 'query':
        return this.query(repo, params);
      case 'cypher': {
        const raw = await this.cypher(repo, params);
        return this.formatCypherAsMarkdown(raw);
      }
      case 'context':
        return this.context(repo, params);
      case 'impact':
        return this.impact(repo, params);
      case 'detect_changes':
        return this.detectChanges(repo, params);
      case 'rename':
        return this.rename(repo, params);
      // Legacy aliases for backwards compatibility
      case 'search':
        return this.query(repo, params);
      case 'explore':
        return this.context(repo, { name: params?.name, ...params });
      case 'overview':
        return this.overview(repo, params);
      default:
        throw new Error(`Unknown tool: ${method}`);
    }
  }

  // ─── Tool Implementations ────────────────────────────────────────

  /**
   * Query tool — process-grouped search.
   * 
 * 1. BM25 search to find matching symbols
   * 2. Trace each match to its process(es) via STEP_IN_PROCESS
   * 3. Group by process, rank by aggregate relevance + internal cluster cohesion
 * 4. Return: { processes, process_symbols, definitions }
   */
  private async query(repo: RepoHandle, params: {
    query: string;
    task_context?: string;
    goal?: string;
    owners?: boolean;
    limit?: number;
    max_symbols?: number;
    include_content?: boolean;
  }): Promise<any> {
    return this.searchSupport.query(repo, params);
  }

  /**
   * BM25 keyword search helper - uses KuzuDB FTS for always-fresh results
   */
  private async bm25Search(repo: RepoHandle, query: string, limit: number): Promise<any[]> {
    return this.searchSupport.bm25Search(repo, query, limit);
  }

  private normalizeSearchText(value: string): string {
    return this.searchSupport.normalizeSearchText(value);
  }

  private getSplitWordAlias(value: string): string {
    return this.searchSupport.getSplitWordAlias(value);
  }

  private getCompactSearchText(value: string): string {
    return this.searchSupport.getCompactSearchText(value);
  }

  private getSafeShorthandAliases(value: string): string[] {
    return this.searchSupport.getSafeShorthandAliases(value);
  }

  private getSymbolResolutionAliases(name: string, filePath?: string): string[] {
    return this.searchSupport.getSymbolResolutionAliases(name, filePath);
  }

  private async fetchSymbolsByIds(repo: RepoHandle, ids: string[], include_content = false): Promise<any[]> {
    return this.searchSupport.fetchSymbolsByIds(repo, ids, include_content);
  }

  private async lookupNamedSymbols(
    repo: RepoHandle,
    params: { name: string; file_path?: string; include_content?: boolean },
  ): Promise<any[]> {
    return this.searchSupport.lookupNamedSymbols(repo, params);
  }

  private isBroadSearchQuery(searchQuery: string): boolean {
    return this.searchSupport.isBroadSearchQuery(searchQuery);
  }

  private isSubsystemDiscoveryQuery(searchQuery: string): boolean {
    return this.searchSupport.isSubsystemDiscoveryQuery(searchQuery);
  }

  private isTestFocusedQuery(searchQuery: string): boolean {
    return this.searchSupport.isTestFocusedQuery(searchQuery);
  }

  private isLikelyProductionFile(filePath: string): boolean {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    if (isTestFilePath(normalized)) return false;
    if (/(^|\/)(artifacts|docs?|archive|examples|planning|vendor|scripts?|fixtures?)(\/|$)/.test(normalized)) {
      return false;
    }
    return true;
  }

  private isLikelyCodeFile(filePath: string): boolean {
    return /\.(c|cc|cpp|cs|cxx|go|h|hpp|hxx|hh|java|js|jsx|kt|lua|luau|mjs|py|php|rb|rs|swift|ts|tsx)$/i.test(filePath);
  }

  private summarizeAffectedAreas(filePaths: string[]): Array<{ name: string; files: number }> {
    const counts = new Map<string, number>();
    for (const filePath of filePaths) {
      if (!filePath) continue;
      const normalized = filePath.replace(/\\/g, '/');
      const area = path.posix.dirname(normalized);
      if (!area || area === '.') continue;
      counts.set(area, (counts.get(area) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, files]) => ({ name, files }))
      .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
      .slice(0, 5);
  }

  private rankRepresentativeSymbols<T extends { type: string; name: string; filePath?: string; fanIn?: number; fan_in?: number; startLine?: number }>(symbols: T[]): T[] {
    return [...symbols]
      .filter((symbol) => symbol.type !== 'File')
      .filter((symbol) => !this.isLowSignalSummarySymbol(symbol.name))
      .sort((a, b) => {
        const aPriority = this.getOwnerSymbolPriority(a.type);
        const bPriority = this.getOwnerSymbolPriority(b.type);
        const aFanIn = a.fanIn ?? a.fan_in ?? 0;
        const bFanIn = b.fanIn ?? b.fan_in ?? 0;
        const aPrimary = a.filePath && this.isPrimarySourceFile(a.filePath) ? 1 : 0;
        const bPrimary = b.filePath && this.isPrimarySourceFile(b.filePath) ? 1 : 0;
        const aStart = a.startLine ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.startLine ?? Number.MAX_SAFE_INTEGER;
        return (
          bPriority - aPriority ||
          bFanIn - aFanIn ||
          bPrimary - aPrimary ||
          aStart - bStart ||
          a.name.localeCompare(b.name)
        );
      });
  }

  private classifyCoverageSignal(score: number): 'high' | 'medium' | 'low' {
    if (score >= 0.75) return 'high';
    if (score >= 0.35) return 'medium';
    return 'low';
  }

  private getOwnerSymbolPriority(kind: string): number {
    switch (kind) {
      case 'Module':
        return 5;
      case 'Class':
      case 'Interface':
      case 'Struct':
      case 'Namespace':
        return 4;
      case 'Method':
      case 'Function':
      case 'Constructor':
        return 2;
      case 'File':
        return 1;
      default:
        return 0;
    }
  }

  private rankOwnerCandidates<T extends { type: string; fanIn?: number; fan_in?: number; name: string; filePath?: string }>(owners: T[]): T[] {
    return [...owners].sort((a, b) => {
      const aPriority = this.getOwnerSymbolPriority(a.type);
      const bPriority = this.getOwnerSymbolPriority(b.type);
      const aFanIn = a.fanIn ?? a.fan_in ?? 0;
      const bFanIn = b.fanIn ?? b.fan_in ?? 0;
      const aPrimary = a.filePath && this.isPrimarySourceFile(a.filePath) ? 1 : 0;
      const bPrimary = b.filePath && this.isPrimarySourceFile(b.filePath) ? 1 : 0;
      return (
        bPriority - aPriority ||
        bFanIn - aFanIn ||
        bPrimary - aPrimary ||
        a.name.localeCompare(b.name)
      );
    });
  }

  private getWeakLuauBackingContainers(description?: string): string[] {
    if (typeof description !== 'string') {
      return [];
    }
    const match = description.match(/:backing=([^:]+)$/);
    if (!match) {
      return [];
    }
    return match[1]
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private async getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]> {
    const uniqueFilePaths = [...new Set(filePaths.filter((filePath) => typeof filePath === 'string' && filePath.length > 0))];
    if (uniqueFilePaths.length === 0) {
      return [];
    }

    const quotedFilePaths = uniqueFilePaths
      .map((filePath) => `'${String(filePath).replace(/'/g, "''")}'`)
      .join(', ');

    const rows = await executeQuery(repo.id, `
      MATCH (f:File)-[:CodeRelation {type: 'DEFINES'}]->(n)
      WHERE f.filePath IN [${quotedFilePaths}]
      OPTIONAL MATCH (src)-[r:CodeRelation]->(n)
      WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
      RETURN f.filePath AS filePath, n.id AS id, n.name AS name, labels(n)[0] AS type,
             COUNT(DISTINCT src.id) AS fanIn, n.startLine AS startLine
      ORDER BY fanIn DESC, n.filePath ASC, n.name ASC
    `).catch(() => []);

    const grouped = new Map<string, any[]>();
    for (const row of rows) {
      const filePath = row.filePath || row[0];
      if (!filePath) continue;
      const owners = grouped.get(filePath) || [];
      owners.push({
        filePath,
        id: row.id || row[1],
        name: row.name || row[2],
        type: this.getNodeKind({ id: row.id || row[1], type: row.type || row[3] }),
        fanIn: row.fanIn || row[4] || 0,
        startLine: row.startLine || row[5] || 0,
      });
      grouped.set(filePath, owners);
    }

    return uniqueFilePaths.flatMap((filePath) => {
      const owners = grouped.get(filePath) || [];
      const fileOwner = {
        id: generateId('File', filePath),
        name: path.basename(filePath),
        type: 'File',
        filePath,
        fanIn: 0,
      };
      const rankedStructuralOwners = this.rankOwnerCandidates(
        owners.filter((owner) => this.isPrimaryOwnerKind(owner.type)),
      );
      if (rankedStructuralOwners.length > 0) {
        return rankedStructuralOwners.slice(0, 2);
      }
      const representativeAnchors = this.rankRepresentativeSymbols(
        owners.filter((owner) => owner.type && owner.name),
      );
      if (representativeAnchors.length > 0) {
        return representativeAnchors.slice(0, 2);
      }
      const rankedOwners = this.rankOwnerCandidates(
        owners.filter((owner) => this.isOwnerLikeSymbolKind(owner.type) || owner.fanIn > 0),
      );
      if (rankedOwners.length > 0) {
        return rankedOwners.slice(0, 2);
      }
      return [fileOwner];
    });
  }

  private async getHotAnchorsForFiles(repo: RepoHandle, filePaths: string[], limit = 3): Promise<any[]> {
    const uniqueFilePaths = [...new Set(filePaths.filter((filePath) => typeof filePath === 'string' && filePath.length > 0))];
    if (uniqueFilePaths.length === 0) {
      return [];
    }
    const quotedFilePaths = uniqueFilePaths
      .map((filePath) => `'${String(filePath).replace(/'/g, "''")}'`)
      .join(', ');
    const rows = await executeQuery(repo.id, `
      MATCH (src)-[r:CodeRelation]->(n)
      WHERE n.filePath IN [${quotedFilePaths}]
        AND r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
      RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath,
             COUNT(DISTINCT src.id) AS fanIn, n.startLine AS startLine
      ORDER BY fanIn DESC, name ASC
      LIMIT 50
    `).catch(() => []);
    return this.rankRepresentativeSymbols(
      rows
        .map((row: any) => ({
          id: row.id || row[0],
          name: row.name || row[1],
          type: this.getNodeKind({ id: row.id || row[0], type: row.type || row[2] }),
          filePath: row.filePath || row[3],
          fan_in: row.fanIn || row[4] || 0,
          startLine: row.startLine || row[5] || 0,
        }))
        .filter((row: any) => row.filePath && this.isLikelyProductionFile(row.filePath)),
    ).slice(0, limit);
  }

  private async getDetailedAffectedAreas(
    repo: RepoHandle,
    filePaths: string[],
  ): Promise<Array<{ name: string; files: number; production_files: number; test_files: number; top_owners: any[]; hot_anchors: any[] }>> {
    const areas = this.summarizeAffectedAreas(filePaths);
    if (areas.length === 0) {
      return [];
    }
    const filePathsByArea = new Map<string, string[]>();
    for (const filePath of filePaths) {
      if (!filePath) continue;
      const normalized = filePath.replace(/\\/g, '/');
      const area = path.posix.dirname(normalized);
      if (!area || area === '.') continue;
      const existing = filePathsByArea.get(area) || [];
      existing.push(normalized);
      filePathsByArea.set(area, existing);
    }

    return Promise.all(areas.map(async (area) => {
      const areaFiles = [...new Set(filePathsByArea.get(area.name) || [])];
      const [topOwners, hotAnchors] = await Promise.all([
        this.getOwnerSymbolsForFiles(repo, areaFiles),
        this.getHotAnchorsForFiles(repo, areaFiles),
      ]);
      const groundedOwners = topOwners.some((owner) => owner.type !== 'File')
        ? topOwners.slice(0, 3)
        : hotAnchors.slice(0, 3);
      return {
        ...area,
        production_files: areaFiles.filter((filePath) => this.isLikelyProductionFile(filePath)).length,
        test_files: areaFiles.filter((filePath) => isTestFilePath(filePath)).length,
        top_owners: groundedOwners,
        hot_anchors: hotAnchors.slice(0, 3),
      };
    }));
  }

  private isOwnerLikeSymbolKind(resultType: string): boolean {
    return ['File', 'Module', 'Class', 'Interface', 'Struct', 'Namespace'].includes(resultType);
  }

  private isPrimaryOwnerKind(resultType: string): boolean {
    return ['Module', 'Class', 'Interface', 'Struct', 'Namespace'].includes(resultType);
  }

  private getBroadOwnerShapePenalty(
    resultType: string,
    name: string,
    filePath: string,
    ownersMode: boolean,
    anchorFiles: Set<string>,
  ): number {
    return this.searchSupport.getBroadOwnerShapePenalty(resultType, name, filePath, ownersMode, anchorFiles);
  }

  private computeBroadSearchPenalties(
    searchQuery: string,
    filePath: string,
    ownersMode = false,
  ): { productionBoost: number; anchorBoost: number; testPenalty: number; secondaryPenalty: number; nonCodePenalty: number } {
    return this.searchSupport.computeBroadSearchPenalties(searchQuery, filePath, ownersMode);
  }

  private isPrimarySourceFile(filePath: string): boolean {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    return /^(src|typed|app|lib|pkg|internal)\//.test(normalized);
  }

  private getBroadQueryActionPenalty(resultType: string, name: string, searchQuery: string, ownersMode = false): number {
    if (!ownersMode && !this.isSubsystemDiscoveryQuery(searchQuery)) {
      return 0;
    }

    const genericActionName = /^(main|new|connect|disconnect|send|status|check|build|execute|handle|run|snapshot|log|copy|get|set|start|stop)$/i.test(name);
    if (resultType === 'Method') {
      return ownersMode ? (genericActionName ? 7 : 5) : genericActionName ? 4 : 2.75;
    }
    if (resultType === 'Function') {
      return ownersMode ? (genericActionName ? 6 : 4.5) : genericActionName ? 3.5 : 2.25;
    }
    if (ownersMode && resultType === 'Property') {
      return 2;
    }
    return 0;
  }

  private async getBroadQueryFileSignals(
    repo: RepoHandle,
    filePaths: string[],
  ): Promise<Map<string, { communityCount: number; processCount: number }>> {
    return this.searchSupport.getBroadQueryFileSignals(repo, filePaths);
  }

  private computeBroadQuerySignalBoost(
    searchQuery: string,
    resultType: string,
    fileSignal: { communityCount: number; processCount: number } | undefined,
    ownersMode = false,
  ): number {
    return this.searchSupport.computeBroadQuerySignalBoost(searchQuery, resultType, fileSignal, ownersMode);
  }

  private getBroadQueryWeightedTerms(searchQuery: string, ownersMode = false): Array<{ term: string; weight: number }> {
    return this.searchSupport.getBroadQueryWeightedTerms(searchQuery, ownersMode);
  }

  private computeBroadQueryTermScore(
    searchQuery: string,
    result: { name: string; filePath: string; type: string; moduleSymbol?: string; description?: string },
    ownersMode = false,
  ): { boost: number; penalty: number } {
    return this.searchSupport.computeBroadQueryTermScore(searchQuery, result, ownersMode);
  }

  private isLowSignalSummarySymbol(name: string): boolean {
    return /^(main|new|init|encode|decode|worker|assert[a-z0-9_]*)$/i.test(name);
  }

  private getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string {
    const explicit = row.type || row.kind || fallback;
    if (explicit) return explicit;
    const identifier = row.id || row.uid || row.nodeId;
    if (typeof identifier === 'string') {
      const boundary = identifier.indexOf(':');
      if (boundary > 0) {
        return identifier.slice(0, boundary);
      }
    }
    return '';
  }

  private rankContainerMembers(rows: any[]): any[] {
    const normalizedRows = rows
      .map((row: any) => ({
        ...row,
        kind: this.getNodeKind({ id: row.uid ?? row.id ?? row[0], type: row.kind ?? row[2] }),
      }))
      .filter((row: any) => row.kind !== 'File' && row.kind !== 'Module');
    if (normalizedRows.length === 0) {
      return [];
    }

    const methodLikeRows = normalizedRows.filter((row: any) => ['Method', 'Constructor', 'Property'].includes(row.kind));
    const preferredRows = methodLikeRows.length > 0 ? methodLikeRows : normalizedRows;

    return preferredRows.sort((a: any, b: any) => {
      const aStart = a.startLine ?? a[4] ?? Number.MAX_SAFE_INTEGER;
      const bStart = b.startLine ?? b[4] ?? Number.MAX_SAFE_INTEGER;
      return aStart - bStart;
    });
  }

  private async getContainedMembers(
    repo: RepoHandle,
    symbol: { id: string; kind?: string; filePath?: string; startLine?: number; endLine?: number; description?: string },
  ): Promise<{ rows: any[]; inferred: boolean; source: MemberRecoverySource }> {
    const directRows = await executeParameterized(repo.id, `
      MATCH (n {id: $symId})-[r:CodeRelation {type: 'CONTAINS'}]->(child)
      RETURN child.id AS uid, child.name AS name, labels(child)[0] AS kind, child.filePath AS filePath,
             child.startLine AS startLine, child.endLine AS endLine
      LIMIT 100
    `, { symId: symbol.id });

    if (directRows.length > 0) {
      return { rows: this.rankContainerMembers(directRows), inferred: false, source: 'contains' };
    }

    if (['Module', 'File'].includes(symbol.kind || '')) {
      const defineRows = await executeParameterized(repo.id, `
        MATCH (n {id: $symId})-[r:CodeRelation {type: 'DEFINES'}]->(child)
        RETURN child.id AS uid, child.name AS name, labels(child)[0] AS kind, child.filePath AS filePath,
               child.startLine AS startLine, child.endLine AS endLine
        LIMIT 100
      `, { symId: symbol.id });
      let combinedDefineRows = defineRows;
      if (
        symbol.kind === 'Module' &&
        symbol.filePath &&
        typeof symbol.description === 'string' &&
        symbol.description.startsWith('luau-module:weak')
      ) {
        const syntheticExportRows = await executeParameterized(repo.id, `
          MATCH (child:Property)
          WHERE child.filePath = $filePath
            AND child.description = 'luau-module-export:returned-table-field'
          RETURN child.id AS uid, child.name AS name, 'Property' AS kind, child.filePath AS filePath,
                 child.startLine AS startLine, child.endLine AS endLine
          LIMIT 20
        `, { filePath: symbol.filePath }).catch(() => []);
        const backingContainers = this.getWeakLuauBackingContainers(symbol.description);
        const backingRows = backingContainers.length > 0
          ? await executeParameterized(repo.id, `
              MATCH (container:Module)-[:CodeRelation {type: 'DEFINES'}]->(child)
              WHERE container.filePath = $filePath
                AND container.description = 'luau-module:local-table'
                AND container.name IN $backingContainers
              RETURN child.id AS uid, child.name AS name, labels(child)[0] AS kind, child.filePath AS filePath,
                     child.startLine AS startLine, child.endLine AS endLine,
                     container.name AS backingContainer,
                     'backing_container_member' AS role
              LIMIT 100
            `, { filePath: symbol.filePath, backingContainers }).catch(() => [])
          : [];
        combinedDefineRows = [...defineRows, ...syntheticExportRows, ...backingRows];
      }
      const rankedDefineRows = this.rankContainerMembers(combinedDefineRows);
      if (rankedDefineRows.length > 0) {
        return { rows: rankedDefineRows, inferred: false, source: 'defines' };
      }
    }

    if (symbol.kind === 'File' && symbol.filePath) {
      const fileDefinedRows = await executeParameterized(repo.id, `
        MATCH (f:File {filePath: $filePath})-[r:CodeRelation {type: 'DEFINES'}]->(child)
        RETURN child.id AS uid, child.name AS name, labels(child)[0] AS kind, child.filePath AS filePath,
               child.startLine AS startLine, child.endLine AS endLine
        LIMIT 200
      `, { filePath: symbol.filePath });
      const rankedFileDefinedRows = this.rankContainerMembers(fileDefinedRows);
      if (rankedFileDefinedRows.length > 0) {
        return { rows: rankedFileDefinedRows, inferred: true, source: 'file_defines' };
      }
    }

    const kind = symbol.kind || '';
    if (!['Class', 'Interface'].includes(kind)) {
      return { rows: [], inferred: false, source: 'none' };
    }
    if (!symbol.filePath || symbol.startLine === undefined || symbol.endLine === undefined) {
      return { rows: [], inferred: false, source: 'none' };
    }

    const inferredRows = await executeParameterized(repo.id, `
      MATCH (child:Function)
      WHERE child.filePath = $filePath
        AND child.id <> $symId
        AND child.startLine IS NOT NULL
        AND child.endLine IS NOT NULL
        AND child.startLine > $startLine
        AND child.endLine <= $endLine
      RETURN child.id AS uid, child.name AS name, 'Function' AS kind, child.filePath AS filePath,
             child.startLine AS startLine, child.endLine AS endLine
      UNION
      MATCH (child:Method)
      WHERE child.filePath = $filePath
        AND child.id <> $symId
        AND child.startLine IS NOT NULL
        AND child.endLine IS NOT NULL
        AND child.startLine > $startLine
        AND child.endLine <= $endLine
      RETURN child.id AS uid, child.name AS name, 'Method' AS kind, child.filePath AS filePath,
             child.startLine AS startLine, child.endLine AS endLine
      UNION
      MATCH (child:Property)
      WHERE child.filePath = $filePath
        AND child.id <> $symId
        AND child.startLine IS NOT NULL
        AND child.endLine IS NOT NULL
        AND child.startLine > $startLine
        AND child.endLine <= $endLine
      RETURN child.id AS uid, child.name AS name, 'Property' AS kind, child.filePath AS filePath,
             child.startLine AS startLine, child.endLine AS endLine
      UNION
      MATCH (child:Constructor)
      WHERE child.filePath = $filePath
        AND child.id <> $symId
        AND child.startLine IS NOT NULL
        AND child.endLine IS NOT NULL
        AND child.startLine > $startLine
        AND child.endLine <= $endLine
      RETURN child.id AS uid, child.name AS name, 'Constructor' AS kind, child.filePath AS filePath,
             child.startLine AS startLine, child.endLine AS endLine
      ORDER BY startLine ASC
      LIMIT 100
    `, {
      symId: symbol.id,
      filePath: symbol.filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    });

    const filteredRows = this.filterImmediateContainedMembers(inferredRows);
    return { rows: filteredRows, inferred: filteredRows.length > 0, source: filteredRows.length > 0 ? 'range' : 'none' };
  }

  private filterImmediateContainedMembers(rows: any[]): any[] {
    const sorted = [...rows].sort((a: any, b: any) => {
      const aStart = a.startLine ?? a[4] ?? Number.MAX_SAFE_INTEGER;
      const bStart = b.startLine ?? b[4] ?? Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = a.endLine ?? a[5] ?? -1;
      const bEnd = b.endLine ?? b[5] ?? -1;
      return bEnd - aEnd;
    });

    const kept: any[] = [];
    for (const row of sorted) {
      const startLine = row.startLine ?? row[4];
      const endLine = row.endLine ?? row[5];
      const kind = row.kind ?? row[2];
      if (
        typeof startLine !== 'number' ||
        typeof endLine !== 'number'
      ) {
        kept.push(row);
        continue;
      }

      const nestedInsideExistingContainer = kept.some((existing: any) => {
        const existingKind = existing.kind ?? existing[2];
        if (!['Function', 'Method', 'Constructor'].includes(existingKind)) {
          return false;
        }
        const existingStart = existing.startLine ?? existing[4];
        const existingEnd = existing.endLine ?? existing[5];
        if (typeof existingStart !== 'number' || typeof existingEnd !== 'number') {
          return false;
        }
        return startLine > existingStart && endLine <= existingEnd;
      });

      if (nestedInsideExistingContainer && ['Function', 'Method', 'Constructor'].includes(kind)) {
        continue;
      }
      kept.push(row);
    }

    return kept;
  }

  private isRojoMappedResult(rojoProject: any | null, filePath?: string): boolean {
    return this.searchSupport.isRojoMappedResult(rojoProject, filePath);
  }

  private async getRojoProjectIndex(repo: RepoHandle): Promise<any | null> {
    return this.searchSupport.getRojoProjectIndex(repo);
  }

  private async getPrimaryModuleSymbols(repo: RepoHandle, filePaths: string[]): Promise<Map<string, string>> {
    return this.searchSupport.getPrimaryModuleSymbols(repo, filePaths);
  }

  private async getBoundaryImports(repo: RepoHandle, filePaths: string[]): Promise<Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>> {
    return this.searchSupport.getBoundaryImports(repo, filePaths);
  }

  private async getExactAliasCandidates(repo: RepoHandle, searchQuery: string): Promise<any[]> {
    return this.searchSupport.getExactAliasCandidates(repo, searchQuery);
  }

  private async getBroadAnchorCandidates(repo: RepoHandle, searchQuery: string, rawResults: any[], ownersMode = false): Promise<any[]> {
    return this.searchSupport.getBroadAnchorCandidates(repo, searchQuery, rawResults, ownersMode);
  }

  private computeSearchBoost(
    searchQuery: string,
    result: { name: string; filePath: string; type: string; runtimeArea?: string; dataModelPath?: string; moduleSymbol?: string; description?: string },
    ownersMode = false,
  ): number {
    return this.searchSupport.computeSearchBoost(searchQuery, result, ownersMode);
  }

  private async rankSearchResults(repo: RepoHandle, searchQuery: string, rawResults: any[], limit: number, ownersMode = false): Promise<RankedSearchResult[]> {
    return this.searchSupport.rankSearchResults(repo, searchQuery, rawResults, limit, ownersMode);
  }

  async executeCypher(query: string): Promise<any> {
    const repo = await this.resolveRepo();
    return this.cypher(repo, { query });
  }

  private extractCypherVariableLabel(query: string, variableName: string): string | null {
    const variablePattern = new RegExp(`\\(${variableName}:([\\w\`]+)`, 'i');
    const match = query.match(variablePattern);
    return match?.[1]?.replace(/`/g, '') ?? null;
  }

  private buildCypherError(query: string, errorMessage: string): any {
    const starterQueries = [
      "MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: 'start'}) RETURN a.name, a.filePath LIMIT 20",
      "MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community) RETURN c.heuristicLabel, COUNT(*) AS symbols ORDER BY symbols DESC LIMIT 20",
      "MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process) RETURN p.heuristicLabel, s.name, r.step ORDER BY p.heuristicLabel, r.step LIMIT 30",
    ];

    if (/\btype\s*\(/i.test(query) || /function TYPE does not exist/i.test(errorMessage)) {
      return {
        error: errorMessage,
        hint: "Use the CodeRelation `type` property instead of `type(r)`. Example: MATCH (a)-[r:CodeRelation {type: 'CALLS'}]->(b) RETURN a.name, b.name LIMIT 20",
        schema_resource: 'gitnexus://schema',
        starter_queries: starterQueries,
      };
    }

    const propertyErrorMatch = errorMessage.match(/Cannot find property ([A-Za-z_][A-Za-z0-9_]*) for ([A-Za-z_][A-Za-z0-9_]*)/i);
    if (propertyErrorMatch) {
      const propertyName = propertyErrorMatch[1];
      const variableName = propertyErrorMatch[2];
      const nodeType = this.extractCypherVariableLabel(query, variableName);
      const availableProperties = nodeType ? getNodeProperties(nodeType) : null;
      const propertyResource = nodeType ? getPropertyResourceUri(nodeType) : 'gitnexus://properties';
      const hint = availableProperties
        ? `Property \`${propertyName}\` is not available on ${nodeType}. Available properties include: ${availableProperties.join(', ')}.`
        : `Property \`${propertyName}\` is not available on \`${variableName}\`. Read gitnexus://properties and gitnexus://schema to inspect available node properties.`;

      return {
        error: errorMessage,
        hint,
        schema_resource: 'gitnexus://schema',
        property_resource: propertyResource,
        ...(availableProperties ? { available_properties: availableProperties } : {}),
        starter_queries: starterQueries,
      };
    }

    return {
      error: errorMessage,
      hint: 'Use read-only Cypher over the single CodeRelation table and filter edge kinds with the `type` property.',
      schema_resource: 'gitnexus://schema',
      property_resource: 'gitnexus://properties',
      starter_queries: starterQueries,
    };
  }

  private async cypher(repo: RepoHandle, params: { query: string }): Promise<any> {
    await this.ensureInitialized(repo.id);

    if (!isKuzuReady(repo.id)) {
      return { error: 'KuzuDB not ready. Index may be corrupted.' };
    }

    // Block write operations (defense-in-depth — DB is already read-only)
    if (CYPHER_WRITE_RE.test(params.query)) {
      return this.buildCypherError(
        params.query,
        'Write operations (CREATE, DELETE, SET, MERGE, REMOVE, DROP, ALTER, COPY, DETACH) are not allowed. The knowledge graph is read-only.',
      );
    }

    try {
      const result = await executeQuery(repo.id, params.query);
      return result;
    } catch (err: any) {
      return this.buildCypherError(params.query, err.message || 'Query failed');
    }
  }

  /**
   * Format raw Cypher result rows as a markdown table for LLM readability.
   * Falls back to raw result if rows aren't tabular objects.
   */
  private formatCypherAsMarkdown(result: any): any {
    if (!Array.isArray(result) || result.length === 0) return result;

    const firstRow = result[0];
    if (typeof firstRow !== 'object' || firstRow === null) return result;

    const keys = Object.keys(firstRow);
    if (keys.length === 0) return result;

    const header = '| ' + keys.join(' | ') + ' |';
    const separator = '| ' + keys.map(() => '---').join(' | ') + ' |';
    const dataRows = result.map((row: any) =>
      '| ' + keys.map(k => {
        const v = row[k];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      }).join(' | ') + ' |'
    );

    return {
      markdown: [header, separator, ...dataRows].join('\n'),
      row_count: result.length,
    };
  }

  /**
   * Aggregate same-named clusters: group by heuristicLabel, sum symbols,
   * weighted-average cohesion, filter out tiny clusters (<5 symbols).
   * Raw communities stay intact in KuzuDB for Cypher queries.
   */
  private aggregateClusters(clusters: any[]): any[] {
    return this.summarySupport.aggregateClusters(clusters);
  }

  private humanizeSummaryLabel(label: string): string {
    return this.summarySupport.humanizeSummaryLabel(label);
  }

  private isLowSignalSubsystemLabel(label: string): boolean {
    return this.summarySupport.isLowSignalSubsystemLabel(label);
  }

  private isBroadSubsystemLabel(label: string): boolean {
    return this.summarySupport.isBroadSubsystemLabel(label);
  }

  private normalizeSubsystemPhraseSegment(segment: string): string {
    return this.summarySupport.normalizeSubsystemPhraseSegment(segment);
  }

  private getPathSummaryPhrase(filePath: string): string | null {
    return this.summarySupport.getPathSummaryPhrase(filePath);
  }

  private getSummaryDisplayLabel(entry: any): string | null {
    return this.summarySupport.getSummaryDisplayLabel(entry);
  }

  private getSummarySubsystemTokens(subsystemName: string): Set<string> {
    return this.summarySupport.getSummarySubsystemTokens(subsystemName);
  }

  private signalAlignsToSubsystem(subsystemName: string, entry: any): boolean {
    return this.summarySupport.signalAlignsToSubsystem(subsystemName, entry);
  }

  private getArchitecturalRepresentativeBoost(label: string, entry: any, role: 'owner' | 'hotspot'): number {
    return this.summarySupport.getArchitecturalRepresentativeBoost(label, entry, role);
  }

  private getGenericRepresentativePenalty(label: string, role: 'owner' | 'hotspot'): number {
    return this.summarySupport.getGenericRepresentativePenalty(label, role);
  }

  private toRepresentativeOwnerCandidate(entry: any): any | null {
    return this.summarySupport.toRepresentativeOwnerCandidate(entry);
  }

  private scoreSummaryRepresentativeEntry(
    subsystemName: string,
    entry: any,
    role: 'owner' | 'hotspot',
  ): number {
    return this.summarySupport.scoreSummaryRepresentativeEntry(subsystemName, entry, role);
  }

  private selectSummaryRepresentativeLabels(
    subsystemName: string,
    entries: any[],
    role: 'owner' | 'hotspot',
    limit: number,
    allowOwnerFallback = true,
  ): string[] {
    return this.summarySupport.selectSummaryRepresentativeLabels(subsystemName, entries, role, limit, allowOwnerFallback);
  }

  private deriveSubsystemLabel(
    rawLabel: string,
    filePaths: string[],
    topOwners: Array<{ filePath?: string; fan_in?: number; fanIn?: number }>,
    hotAnchors: Array<{ filePath?: string; fan_in?: number; fanIn?: number }>,
  ): string {
    return this.summarySupport.deriveSubsystemLabel(rawLabel, filePaths, topOwners, hotAnchors);
  }

  private buildConciseSubsystemSummary(
    repo: RepoHandle,
    result: any,
  limit: number,
  ): any {
    return this.summarySupport.buildConciseSubsystemSummary(repo, result, limit);
  }

  private async getSubsystemSummary(repo: RepoHandle, limit: number): Promise<any[]> {
    return this.summarySupport.getSubsystemSummary(repo, limit);
  }

  private async overview(
    repo: RepoHandle,
    params: { showClusters?: boolean; showProcesses?: boolean; showSubsystems?: boolean; showSubsystemDetails?: boolean; limit?: number },
  ): Promise<any> {
    return this.summarySupport.overview(repo, params);
  }

  private classifyRiskBand(score: number): 'low' | 'medium' | 'high' | 'critical' {
    return this.analysisSupport.classifyRiskBand(score);
  }

  private classifyOverloadSignal(lineCount: number | null, functionCount: number, hotspotShare: number): 'low' | 'medium' | 'high' | 'critical' {
    return this.analysisSupport.classifyOverloadSignal(lineCount, functionCount, hotspotShare);
  }

  private classifyStructuralPressureBand(score: number): 'low' | 'medium' | 'high' | 'critical' {
    return this.analysisSupport.classifyStructuralPressureBand(score);
  }

  private async getShapeSignals(
    repo: RepoHandle,
    filePath: string | undefined,
  ): Promise<{
    file: {
      line_count: number | null;
      function_count: number;
      largest_members: Array<{ name: string; kind: string; startLine: number; endLine: number; line_count: number }>;
      average_lines_per_function: number | null;
      hotspot_share: number | null;
      concentration: 'low' | 'medium' | 'high' | 'critical';
      grounded_extraction_seams: Array<{ name: string; symbol_count: number; startLine: number; endLine: number }>;
    };
  }> {
    return this.analysisSupport.getShapeSignals(repo, filePath);
  }

  private async context(repo: RepoHandle, params: {
    name?: string;
    uid?: string;
    file_path?: string;
    include_content?: boolean;
  }): Promise<any> {
    return this.analysisSupport.context(repo, params);
  }

  /**
   * Legacy explore — kept for backwards compatibility with resources.ts.
   * Routes cluster/process types to direct graph queries.
   */
  private async explore(repo: RepoHandle, params: { name: string; type: 'symbol' | 'cluster' | 'process' }): Promise<any> {
    await this.ensureInitialized(repo.id);
    const { name, type } = params;
    
    if (type === 'symbol') {
      return this.context(repo, { name });
    }
    
    if (type === 'cluster') {
      const clusters = await executeParameterized(repo.id, `
        MATCH (c:Community)
        WHERE c.label = $clusterName OR c.heuristicLabel = $clusterName
        RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
      `, { clusterName: name });
      if (clusters.length === 0) return { error: `Cluster '${name}' not found` };

      const rawClusters = clusters.map((c: any) => ({
        id: c.id || c[0], label: c.label || c[1], heuristicLabel: c.heuristicLabel || c[2],
        cohesion: c.cohesion || c[3], symbolCount: c.symbolCount || c[4],
      }));

      let totalSymbols = 0, weightedCohesion = 0;
      for (const c of rawClusters) {
        const s = c.symbolCount || 0;
        totalSymbols += s;
        weightedCohesion += (c.cohesion || 0) * s;
      }

      const members = await executeParameterized(repo.id, `
        MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
        WHERE c.label = $clusterName OR c.heuristicLabel = $clusterName
        RETURN DISTINCT n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
        LIMIT 30
      `, { clusterName: name });
      
      return {
        cluster: {
          id: rawClusters[0].id,
          label: rawClusters[0].heuristicLabel || rawClusters[0].label,
          heuristicLabel: rawClusters[0].heuristicLabel || rawClusters[0].label,
          cohesion: totalSymbols > 0 ? weightedCohesion / totalSymbols : 0,
          symbolCount: totalSymbols,
          subCommunities: rawClusters.length,
        },
        members: members.map((m: any) => ({
          name: m.name || m[0], type: m.type || m[1], filePath: m.filePath || m[2],
        })),
      };
    }
    
    if (type === 'process') {
      const processes = await executeParameterized(repo.id, `
        MATCH (p:Process)
        WHERE p.label = $processName OR p.heuristicLabel = $processName
        RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
        LIMIT 1
      `, { processName: name });
      if (processes.length === 0) return { error: `Process '${name}' not found` };

      const proc = processes[0];
      const procId = proc.id || proc[0];
      const steps = await executeParameterized(repo.id, `
        MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p {id: $procId})
        RETURN n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, r.step AS step
        ORDER BY r.step
      `, { procId });
      
      return {
        process: {
          id: procId, label: proc.label || proc[1], heuristicLabel: proc.heuristicLabel || proc[2],
          processType: proc.processType || proc[3], stepCount: proc.stepCount || proc[4],
        },
        steps: steps.map((s: any) => ({
          step: s.step || s[3], name: s.name || s[0], type: s.type || s[1], filePath: s.filePath || s[2],
        })),
      };
    }
    
    return { error: 'Invalid type. Use: symbol, cluster, or process' };
  }

  private async detectChanges(repo: RepoHandle, params: {
    scope?: string;
    base_ref?: string;
  }): Promise<any> {
    return this.analysisSupport.detectChanges(repo, params);
  }

  private async rename(repo: RepoHandle, params: {
    symbol_name?: string;
    symbol_uid?: string;
    new_name: string;
    file_path?: string;
    dry_run?: boolean;
  }): Promise<any> {
    return this.analysisSupport.rename(repo, params);
  }

  private async impact(repo: RepoHandle, params: {
    target?: string;
    uid?: string;
    file_path?: string;
    direction: 'upstream' | 'downstream';
    maxDepth?: number;
    relationTypes?: string[];
    includeTests?: boolean;
    minConfidence?: number;
  }): Promise<any> {
    return this.analysisSupport.impact(repo, params);
  }

  // ─── Direct Graph Queries (for resources.ts) ────────────────────

  /**
   * Query clusters (communities) directly from graph.
   * Used by getClustersResource — avoids legacy overview() dispatch.
   */
  async queryClusters(limit = 100): Promise<{ clusters: any[] }> {
    const repo = await this.resolveRepo();
    return this.summarySupport.queryClusters(repo, limit);
  }

  /**
   * Query processes directly from graph.
   * Used by getProcessesResource — avoids legacy overview() dispatch.
   */
  async queryProcesses(limit = 50): Promise<{ processes: any[] }> {
    const repo = await this.resolveRepo();
    return this.summarySupport.queryProcesses(repo, limit);
  }

  /**
   * Query cluster detail (members) directly from graph.
   * Used by getClusterDetailResource.
   */
  async queryClusterDetail(name: string): Promise<any> {
    const repo = await this.resolveRepo();
    return this.summarySupport.queryClusterDetail(repo, name);
  }

  /**
   * Query process detail (steps) directly from graph.
   * Used by getProcessDetailResource.
   */
  async queryProcessDetail(name: string): Promise<any> {
    const repo = await this.resolveRepo();
    return this.summarySupport.queryProcessDetail(repo, name);
  }

  async disconnect(): Promise<void> {
    await closeKuzu(); // close all connections
    // Note: we intentionally do NOT call disposeEmbedder() here.
    // ONNX Runtime's native cleanup segfaults on macOS and some Linux configs,
    // and importing the embedder module on Node v24+ crashes if onnxruntime
    // was never loaded during the session. Since process.exit(0) follows
    // immediately after disconnect(), the OS reclaims everything. See #38, #89.
    this.repo = null;
    this.contextCache = null;
    this.initialized = false;
  }
}
