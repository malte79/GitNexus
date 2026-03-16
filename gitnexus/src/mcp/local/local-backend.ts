/**
 * Local Backend
 *
 * Provides tool implementations for one repo-local .codenexus index.
 * The backend is bound to the nearest enclosing git repo boundary.
 * KuzuDB connections are opened lazily on first query.
 */

import fs from 'fs/promises';
import path from 'path';
import { executeQuery, executeParameterized, closeKuzu, isKuzuReady } from '../core/kuzu-adapter.js';
import { getNodeProperties, getPropertyResourceUri } from '../schema-properties.js';
import {
  CYPHER_WRITE_RE,
  VALID_NODE_LABELS,
  VALID_RELATION_TYPES,
  isTestFilePath,
  isWriteQuery,
} from './local-backend-common.js';
import type {
  CodebaseContext,
  RepoHandle,
} from './local-backend-types.js';
import { LocalBackendSearchSupport } from './local-backend-search-support.js';
import { LocalBackendSummarySupport } from './local-backend-summary-support.js';
import { LocalBackendAnalysisSupport } from './local-backend-analysis-support.js';
import { LocalBackendRuntimeSupport } from './local-backend-runtime-support.js';
import { LocalBackendGraphSupport } from './local-backend-graph-support.js';
export {
  CYPHER_WRITE_RE,
  VALID_NODE_LABELS,
  VALID_RELATION_TYPES,
  isTestFilePath,
  isWriteQuery,
};
export type { CodebaseContext } from './local-backend-types.js';

export class LocalBackend {
  private rojoProjectCache = new Map<string, Promise<any | null>>();
  private readonly runtimeSupport: LocalBackendRuntimeSupport;
  private readonly graphSupport: LocalBackendGraphSupport;
  private readonly searchSupport: LocalBackendSearchSupport;
  private readonly summarySupport: LocalBackendSummarySupport;
  private readonly analysisSupport: LocalBackendAnalysisSupport;

  constructor(private readonly startPath = process.cwd()) {
    this.runtimeSupport = new LocalBackendRuntimeSupport(startPath);
    this.graphSupport = new LocalBackendGraphSupport();
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
    this.summarySupport = new LocalBackendSummarySupport({
      ensureInitialized: this.runtimeSupport.ensureInitialized.bind(this.runtimeSupport),
      refreshRepoHandle: this.runtimeSupport.refreshRepoHandle.bind(this.runtimeSupport),
      getRepoFreshnessSummary: this.runtimeSupport.getRepoFreshnessSummary.bind(this.runtimeSupport),
      getOwnerSymbolsForFiles: this.graphSupport.getOwnerSymbolsForFiles.bind(this.graphSupport),
      getNodeKind: this.graphSupport.getNodeKind.bind(this.graphSupport),
      isOwnerLikeSymbolKind: this.graphSupport.isOwnerLikeSymbolKind.bind(this.graphSupport),
      isPrimaryOwnerKind: this.graphSupport.isPrimaryOwnerKind.bind(this.graphSupport),
      isLikelyProductionFile: this.graphSupport.isLikelyProductionFile.bind(this.graphSupport),
      isLowSignalSummarySymbol: this.graphSupport.isLowSignalSummarySymbol.bind(this.graphSupport),
      getOwnerSymbolPriority: this.graphSupport.getOwnerSymbolPriority.bind(this.graphSupport),
      rankOwnerCandidates: this.graphSupport.rankOwnerCandidates.bind(this.graphSupport),
    });
    this.analysisSupport = new LocalBackendAnalysisSupport({
      ensureInitialized: this.runtimeSupport.ensureInitialized.bind(this.runtimeSupport),
      getRepoFreshnessSummary: this.runtimeSupport.getRepoFreshnessSummary.bind(this.runtimeSupport),
      getNodeKind: this.graphSupport.getNodeKind.bind(this.graphSupport),
      humanizeSummaryLabel: this.summarySupport.humanizeSummaryLabel.bind(this.summarySupport),
      isLowSignalSubsystemLabel: this.summarySupport.isLowSignalSubsystemLabel.bind(this.summarySupport),
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
        return this.summarySupport.overview(repo, params);
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
        return this.summarySupport.overview(repo, params);
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
    await this.runtimeSupport.ensureInitialized(repo.id);

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

  private buildConciseSubsystemSummary(
    repo: RepoHandle,
    result: any,
    limit: number,
  ): any {
    return this.summarySupport.buildConciseSubsystemSummary(repo, result, limit);
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
      const aggregatedClusters = this.summarySupport.aggregateClusters(rawClusters);

      let totalSymbols = 0, weightedCohesion = 0;
      for (const c of aggregatedClusters) {
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
          id: aggregatedClusters[0]?.id || rawClusters[0].id,
          label: aggregatedClusters[0]?.heuristicLabel || aggregatedClusters[0]?.label || rawClusters[0].heuristicLabel || rawClusters[0].label,
          heuristicLabel: aggregatedClusters[0]?.heuristicLabel || aggregatedClusters[0]?.label || rawClusters[0].heuristicLabel || rawClusters[0].label,
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
    this.runtimeSupport.disconnect();
  }
}
