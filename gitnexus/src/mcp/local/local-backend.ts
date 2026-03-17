/**
 * Local Backend
 *
 * Provides tool implementations for one repo-local .codenexus index.
 * The backend is bound to the nearest enclosing git repo boundary.
 * KuzuDB connections are opened lazily on first query.
 */

import { closeKuzu } from '../core/kuzu-adapter.js';
import {
  VALID_NODE_LABELS,
  VALID_RELATION_TYPES,
  isTestFilePath,
  isWriteQuery,
} from './local-backend-common.js';
import type {
  CodebaseContext,
  RepoHandle,
} from './local-backend-types.js';
import { LocalBackendCypherSupport } from './local-backend-cypher-support.js';
import { LocalBackendSearchSupport } from './local-backend-search-support.js';
import { LocalBackendAnalysisSupport } from './local-backend-analysis-support.js';
import { LocalBackendRuntimeSupport } from './local-backend-runtime-support.js';
import { LocalBackendGraphSupport } from './local-backend-graph-support.js';
import { LocalBackendOverviewSupport } from './local-backend-overview-support.js';
import { LocalBackendSummaryPresentationSupport } from './local-backend-summary-presentation-support.js';
import { LocalBackendSummaryQuerySupport } from './local-backend-summary-query-support.js';
export {
  CYPHER_WRITE_RE,
  VALID_NODE_LABELS,
  VALID_RELATION_TYPES,
  isTestFilePath,
  isWriteQuery,
} from './local-backend-common.js';
export type { CodebaseContext } from './local-backend-types.js';

export class LocalBackend {
  private rojoProjectCache = new Map<string, Promise<any | null>>();
  private readonly runtimeSupport: LocalBackendRuntimeSupport;
  private readonly graphSupport: LocalBackendGraphSupport;
  private readonly cypherSupport: LocalBackendCypherSupport;
  private readonly searchSupport: LocalBackendSearchSupport;
  private readonly summaryPresentationSupport: LocalBackendSummaryPresentationSupport;
  private readonly summaryQuerySupport: LocalBackendSummaryQuerySupport;
  private readonly overviewSupport: LocalBackendOverviewSupport;
  private readonly analysisSupport: LocalBackendAnalysisSupport;

  constructor(private readonly startPath = process.cwd()) {
    this.runtimeSupport = new LocalBackendRuntimeSupport(startPath);
    this.graphSupport = new LocalBackendGraphSupport();
    this.cypherSupport = new LocalBackendCypherSupport();
    this.searchSupport = new LocalBackendSearchSupport({
      ensureInitialized: this.runtimeSupport.ensureInitialized.bind(this.runtimeSupport),
      getOwnerSymbolsForFiles: this.graphSupport.getOwnerSymbolsForFiles.bind(this.graphSupport),
      getNodeKind: this.graphSupport.getNodeKind.bind(this.graphSupport),
      isOwnerLikeSymbolKind: this.graphSupport.isOwnerLikeSymbolKind.bind(this.graphSupport),
      isPrimaryOwnerKind: this.graphSupport.isPrimaryOwnerKind.bind(this.graphSupport),
      isLikelyProductionFile: this.graphSupport.isLikelyProductionFile.bind(this.graphSupport),
      isLikelyCodeFile: this.graphSupport.isLikelyCodeFile.bind(this.graphSupport),
      isPrimarySourceFile: this.graphSupport.isPrimarySourceFile.bind(this.graphSupport),
      isLowSignalSummarySymbol: this.graphSupport.isLowSignalSummarySymbol.bind(this.graphSupport),
      getOwnerSymbolPriority: this.graphSupport.getOwnerSymbolPriority.bind(this.graphSupport),
      rankOwnerCandidates: this.graphSupport.rankOwnerCandidates.bind(this.graphSupport),
      rankRepresentativeSymbols: this.graphSupport.rankRepresentativeSymbols.bind(this.graphSupport),
      rojoProjectCache: this.rojoProjectCache,
    });
    this.summaryPresentationSupport = new LocalBackendSummaryPresentationSupport({
      getNodeKind: this.graphSupport.getNodeKind.bind(this.graphSupport),
      isOwnerLikeSymbolKind: this.graphSupport.isOwnerLikeSymbolKind.bind(this.graphSupport),
      isLowSignalSummarySymbol: this.graphSupport.isLowSignalSummarySymbol.bind(this.graphSupport),
      getOwnerSymbolPriority: this.graphSupport.getOwnerSymbolPriority.bind(this.graphSupport),
    });
    this.summaryQuerySupport = new LocalBackendSummaryQuerySupport({
      ensureInitialized: this.runtimeSupport.ensureInitialized.bind(this.runtimeSupport),
      getOwnerSymbolsForFiles: this.graphSupport.getOwnerSymbolsForFiles.bind(this.graphSupport),
      getNodeKind: this.graphSupport.getNodeKind.bind(this.graphSupport),
      isOwnerLikeSymbolKind: this.graphSupport.isOwnerLikeSymbolKind.bind(this.graphSupport),
      isPrimaryOwnerKind: this.graphSupport.isPrimaryOwnerKind.bind(this.graphSupport),
      isLikelyProductionFile: this.graphSupport.isLikelyProductionFile.bind(this.graphSupport),
      isLowSignalSummarySymbol: this.graphSupport.isLowSignalSummarySymbol.bind(this.graphSupport),
      getOwnerSymbolPriority: this.graphSupport.getOwnerSymbolPriority.bind(this.graphSupport),
      rankOwnerCandidates: this.graphSupport.rankOwnerCandidates.bind(this.graphSupport),
    }, this.summaryPresentationSupport);
    this.overviewSupport = new LocalBackendOverviewSupport({
      ensureInitialized: this.runtimeSupport.ensureInitialized.bind(this.runtimeSupport),
      refreshRepoHandle: this.runtimeSupport.refreshRepoHandle.bind(this.runtimeSupport),
      getRepoFreshnessSummary: this.runtimeSupport.getRepoFreshnessSummary.bind(this.runtimeSupport),
      getNodeKind: this.graphSupport.getNodeKind.bind(this.graphSupport),
      isLikelyProductionFile: this.graphSupport.isLikelyProductionFile.bind(this.graphSupport),
      isLowSignalSummarySymbol: this.graphSupport.isLowSignalSummarySymbol.bind(this.graphSupport),
    }, this.summaryQuerySupport, this.summaryPresentationSupport);
    this.analysisSupport = new LocalBackendAnalysisSupport({
      ensureInitialized: this.runtimeSupport.ensureInitialized.bind(this.runtimeSupport),
      getRepoFreshnessSummary: this.runtimeSupport.getRepoFreshnessSummary.bind(this.runtimeSupport),
      getNodeKind: this.graphSupport.getNodeKind.bind(this.graphSupport),
      humanizeSummaryLabel: this.summaryPresentationSupport.humanizeSummaryLabel.bind(this.summaryPresentationSupport),
      isLowSignalSubsystemLabel: this.summaryPresentationSupport.isLowSignalSubsystemLabel.bind(this.summaryPresentationSupport),
      context: this.context.bind(this),
      getShapeSignals: this.getShapeSignals.bind(this),
      lookupNamedSymbols: this.searchSupport.lookupNamedSymbols.bind(this.searchSupport),
      getPrimaryModuleSymbols: this.searchSupport.getPrimaryModuleSymbols.bind(this.searchSupport),
      getRojoProjectIndex: this.searchSupport.getRojoProjectIndex.bind(this.searchSupport),
      getBoundaryImports: this.searchSupport.getBoundaryImports.bind(this.searchSupport),
      getContainedMembers: this.getContainedMembers.bind(this),
      classifyCoverageSignal: this.graphSupport.classifyCoverageSignal.bind(this.graphSupport),
      getDetailedAffectedAreas: this.getDetailedAffectedAreas.bind(this),
      getOwnerSymbolsForFiles: this.graphSupport.getOwnerSymbolsForFiles.bind(this.graphSupport),
    });
  }

  // ─── Initialization ──────────────────────────────────────────────

  /**
   * Initialize against the nearest enclosing repo boundary.
   * Returns true only when a usable local .codenexus index exists.
   */
  async init(): Promise<boolean> {
    return this.runtimeSupport.init();
  }

  // ─── Repo Resolution ─────────────────────────────────────────────

  async resolveRepo(repoParam?: string): Promise<RepoHandle> {
    return this.runtimeSupport.resolveRepo(repoParam);
  }

  async reload(): Promise<void> {
    return this.runtimeSupport.reload();
  }

  // ─── Public Getters ──────────────────────────────────────────────

  /**
   * Get context for the bound repo.
   */
  getContext(repoId?: string): CodebaseContext | null {
    return this.runtimeSupport.getContext(repoId);
  }

  // ─── Tool Dispatch ───────────────────────────────────────────────

  async callTool(method: string, params: any): Promise<any> {
    const repo = await this.resolveRepo(params?.repo);

    switch (method) {
      case 'summary':
        return this.overviewSupport.overview(repo, params);
      case 'query':
        return this.searchSupport.query(repo, params);
      case 'cypher': {
        const raw = await this.cypher(repo, params);
        return this.formatCypherAsMarkdown(raw);
      }
      case 'context':
        return this.context(repo, params);
      case 'impact':
        return this.analysisSupport.impact(repo, params);
      case 'detect_changes':
        return this.analysisSupport.detectChanges(repo, params);
      case 'rename':
        return this.analysisSupport.rename(repo, params);
      // Legacy aliases for backwards compatibility
      case 'search':
        return this.searchSupport.query(repo, params);
      case 'explore':
        return this.explore(repo, { type: 'symbol', name: params?.name, ...params });
      case 'overview':
        return this.overviewSupport.overview(repo, params);
      default:
        throw new Error(`Unknown tool: ${method}`);
    }
  }

  private async getContainedMembers(
    repo: RepoHandle,
    symbol: { id: string; kind?: string; filePath?: string; startLine?: number; endLine?: number; description?: string },
  ): Promise<{
    rows: any[];
    inferred: boolean;
    source: 'contains' | 'defines' | 'file_defines' | 'range' | 'none';
  }> {
    return this.graphSupport.getContainedMembers(repo, symbol);
  }

  private async getDetailedAffectedAreas(
    repo: RepoHandle,
    filePaths: string[],
  ): Promise<Array<{ name: string; files: number; production_files: number; test_files: number; top_owners: any[]; hot_anchors: any[] }>> {
    return this.graphSupport.getDetailedAffectedAreas(repo, filePaths);
  }

  async executeCypher(query: string): Promise<any> {
    const repo = await this.resolveRepo();
    return this.cypher(repo, { query });
  }

  private async cypher(repo: RepoHandle, params: { query: string }): Promise<any> {
    await this.runtimeSupport.ensureInitialized(repo.id);
    return this.cypherSupport.execute(repo, params);
  }

  /**
   * Format raw Cypher result rows as a markdown table for LLM readability.
   * Falls back to raw result if rows aren't tabular objects.
   */
  private formatCypherAsMarkdown(result: any): any {
    return this.cypherSupport.formatAsMarkdown(result);
  }

  private buildConciseSubsystemSummary(
    repo: RepoHandle,
    result: any,
    limit: number,
  ): any {
    return this.summaryPresentationSupport.buildConciseSubsystemSummary(repo, result, limit);
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
    await this.runtimeSupport.ensureInitialized(repo.id);
    const { name, type } = params;
    
    if (type === 'symbol') {
      return this.context(repo, { name });
    }
    
    if (type === 'cluster') {
      return this.summaryQuerySupport.queryClusterDetail(repo, name);
    }
    
    if (type === 'process') {
      return this.summaryQuerySupport.queryProcessDetail(repo, name);
    }
    
    return { error: 'Invalid type. Use: symbol, cluster, or process' };
  }

  // ─── Direct Graph Queries (for resources.ts) ────────────────────

  /**
   * Query clusters (communities) directly from graph.
   * Used by getClustersResource — avoids legacy overview() dispatch.
   */
  async queryClusters(limit = 100): Promise<{ clusters: any[] }> {
    const repo = await this.resolveRepo();
    return this.summaryQuerySupport.queryClusters(repo, limit);
  }

  /**
   * Query processes directly from graph.
   * Used by getProcessesResource — avoids legacy overview() dispatch.
   */
  async queryProcesses(limit = 50): Promise<{ processes: any[] }> {
    const repo = await this.resolveRepo();
    return this.summaryQuerySupport.queryProcesses(repo, limit);
  }

  /**
   * Query cluster detail (members) directly from graph.
   * Used by getClusterDetailResource.
   */
  async queryClusterDetail(name: string): Promise<any> {
    const repo = await this.resolveRepo();
    return this.summaryQuerySupport.queryClusterDetail(repo, name);
  }

  /**
   * Query process detail (steps) directly from graph.
   * Used by getProcessDetailResource.
   */
  async queryProcessDetail(name: string): Promise<any> {
    const repo = await this.resolveRepo();
    return this.summaryQuerySupport.queryProcessDetail(repo, name);
  }

  async disconnect(): Promise<void> {
    await closeKuzu(); // close all connections
    // Note: we intentionally do NOT call disposeEmbedder() here.
    // ONNX Runtime's native cleanup segfaults on macOS and some Linux configs,
    // and importing the embedder module on Node v24+ crashes if onnxruntime
    // was never loaded during the session. Since process.exit(0) follows
    // immediately after disconnect(), the OS reclaims everything. See #38, #89.
    this.runtimeSupport.disconnect();
  }
}
