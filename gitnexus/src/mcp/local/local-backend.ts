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
  getRepoState,
  loadRepo,
  resolveRepoBoundary,
  type RepoMeta,
} from '../../storage/repo-manager.js';

/**
 * Quick test-file detection for filtering impact results.
 * Matches common test file patterns across all supported languages.
 */
export function isTestFilePath(filePath: string): boolean {
  const p = filePath.toLowerCase().replace(/\\/g, '/');
  return (
    p.includes('.test.') || p.includes('.spec.') ||
    p.includes('__tests__/') || p.includes('__mocks__/') ||
    /(^|\/)(test|tests|testing|fixtures)(\/|$)/.test(p) ||
    p.endsWith('_test.go') || p.endsWith('_test.py') ||
    /(^|\/)test_/.test(p) || p.includes('/conftest.')
  );
}

/** Valid KuzuDB node labels for safe Cypher query construction */
export const VALID_NODE_LABELS = new Set([
  'File', 'Folder', 'Function', 'Class', 'Interface', 'Method', 'CodeElement',
  'Community', 'Process', 'Struct', 'Enum', 'Macro', 'Typedef', 'Union',
  'Namespace', 'Trait', 'Impl', 'TypeAlias', 'Const', 'Static', 'Property',
  'Record', 'Delegate', 'Annotation', 'Constructor', 'Template', 'Module',
]);

/** Valid relation types for impact analysis filtering */
export const VALID_RELATION_TYPES = new Set(['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']);

/** Regex to detect write operations in user-supplied Cypher queries */
export const CYPHER_WRITE_RE = /\b(CREATE|DELETE|SET|MERGE|REMOVE|DROP|ALTER|COPY|DETACH)\b/i;

/** Check if a Cypher query contains write operations */
export function isWriteQuery(query: string): boolean {
  return CYPHER_WRITE_RE.test(query);
}

/** Structured error logging for query failures — replaces empty catch blocks */
function logQueryError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`CodeNexus [${context}]: ${msg}`);
}

export interface CodebaseContext {
  projectName: string;
  stats: {
    fileCount: number;
    functionCount: number;
    communityCount: number;
    processCount: number;
  };
}

interface RepoHandle {
  id: string;
  name: string;
  repoPath: string;
  storagePath: string;
  kuzuPath: string;
  indexedAt: string;
  lastCommit: string;
  stats?: RepoMeta['stats'];
}

interface RepoFreshnessSummary {
  state: string;
  indexed_at: string | null;
  loaded_service_commit: string | null;
  indexed_commit: string | null;
  current_commit: string | null;
  detail_flags: string[];
}

interface RojoTargetSummary {
  dataModelPath: string;
  runtimeArea: 'shared' | 'client' | 'server' | 'other';
}

interface RankedSearchResult {
  nodeId?: string;
  name: string;
  type: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  runtimeArea?: string;
  description?: string;
  bm25Score: number;
  score: number;
  moduleSymbol?: string;
  dataModelPath?: string;
  boundaryImports?: Array<{ name: string; filePath: string; runtimeArea?: string }>;
}

type MemberRecoverySource = 'contains' | 'defines' | 'file_defines' | 'range' | 'none';

export class LocalBackend {
  private repo: RepoHandle | null = null;
  private contextCache: CodebaseContext | null = null;
  private initialized = false;
  private rojoProjectCache = new Map<string, Promise<any | null>>();

  constructor(private readonly startPath = process.cwd()) {}

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
    if (!params.query?.trim()) {
      return { error: 'query parameter is required and cannot be empty.' };
    }
    
    await this.ensureInitialized(repo.id);
    
    const processLimit = params.limit || 5;
    const maxSymbolsPerProcess = params.max_symbols || 10;
    const includeContent = params.include_content ?? false;
    const ownerMode = params.owners ?? false;
    const searchQuery = params.query.trim();
    
    // Step 1: Run BM25 search to get matching symbols
    const searchLimit = processLimit * maxSymbolsPerProcess; // fetch enough raw results
    const bm25Results = await this.bm25Search(repo, searchQuery, searchLimit * 2);
    const rankedMatches = await this.rankSearchResults(repo, searchQuery, bm25Results, searchLimit, ownerMode);
    
    // Step 2: For each match with a nodeId, trace to process(es)
    const processMap = new Map<string, { id: string; label: string; heuristicLabel: string; processType: string; stepCount: number; totalScore: number; cohesionBoost: number; symbols: any[] }>();
    const definitions: any[] = []; // standalone symbols not in any process
    
    for (const sym of rankedMatches) {
      if (!sym.nodeId) {
        // File-level results go to definitions
        definitions.push({
          name: sym.name,
          type: sym.type || 'File',
          filePath: sym.filePath,
          ...(sym.runtimeArea ? { runtimeArea: sym.runtimeArea } : {}),
          ...(sym.moduleSymbol ? { module_symbol: sym.moduleSymbol } : {}),
          ...(sym.dataModelPath ? { data_model_path: sym.dataModelPath } : {}),
          ...(sym.boundaryImports && sym.boundaryImports.length > 0 ? { boundary_imports: sym.boundaryImports } : {}),
        });
        continue;
      }
      
      // Find processes this symbol participates in
      let processRows: any[] = [];
      try {
        processRows = await executeParameterized(repo.id, `
          MATCH (n {id: $nodeId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
          RETURN p.id AS pid, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount, r.step AS step
        `, { nodeId: sym.nodeId });
      } catch (e) { logQueryError('query:process-lookup', e); }

      // Get cluster membership + cohesion (cohesion used as internal ranking signal)
      let cohesion = 0;
      let module: string | undefined;
      try {
        const cohesionRows = await executeParameterized(repo.id, `
          MATCH (n {id: $nodeId})-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          RETURN c.cohesion AS cohesion, c.heuristicLabel AS module
          LIMIT 1
        `, { nodeId: sym.nodeId });
        if (cohesionRows.length > 0) {
          cohesion = (cohesionRows[0].cohesion ?? cohesionRows[0][0]) || 0;
          module = cohesionRows[0].module ?? cohesionRows[0][1];
        }
      } catch (e) { logQueryError('query:cluster-info', e); }

      // Optionally fetch content
      let content: string | undefined;
      if (includeContent) {
        try {
          const contentRows = await executeParameterized(repo.id, `
            MATCH (n {id: $nodeId})
            RETURN n.content AS content
          `, { nodeId: sym.nodeId });
          if (contentRows.length > 0) {
            content = contentRows[0].content ?? contentRows[0][0];
          }
        } catch (e) { logQueryError('query:content-fetch', e); }
      }

      const symbolEntry = {
        id: sym.nodeId,
        name: sym.name,
        type: sym.type,
        filePath: sym.filePath,
        startLine: sym.startLine,
        endLine: sym.endLine,
          ...(sym.runtimeArea ? { runtimeArea: sym.runtimeArea } : {}),
          ...(module ? { module } : {}),
          ...(sym.moduleSymbol ? { module_symbol: sym.moduleSymbol } : {}),
          ...(sym.dataModelPath ? { data_model_path: sym.dataModelPath } : {}),
          ...(sym.boundaryImports && sym.boundaryImports.length > 0 ? { boundary_imports: sym.boundaryImports } : {}),
          ...(includeContent && content ? { content } : {}),
        };
      
      if (processRows.length === 0) {
        // Symbol not in any process — goes to definitions
        definitions.push(symbolEntry);
      } else {
        // Add to each process it belongs to
        for (const row of processRows) {
          const pid = row.pid ?? row[0];
          const label = row.label ?? row[1];
          const hLabel = row.heuristicLabel ?? row[2];
          const pType = row.processType ?? row[3];
          const stepCount = row.stepCount ?? row[4];
          const step = row.step ?? row[5];
          
          if (!processMap.has(pid)) {
            processMap.set(pid, {
              id: pid,
              label,
              heuristicLabel: hLabel,
              processType: pType,
              stepCount,
              totalScore: 0,
              cohesionBoost: 0,
              symbols: [],
            });
          }
          
          const proc = processMap.get(pid)!;
          proc.totalScore += sym.score;
          proc.cohesionBoost = Math.max(proc.cohesionBoost, cohesion);
          proc.symbols.push({
            ...symbolEntry,
            process_id: pid,
            step_index: step,
          });
        }
      }
    }
    
    // Step 3: Rank processes by aggregate score + internal cohesion boost
    const rankedProcesses = Array.from(processMap.values())
      .map(p => ({
        ...p,
        priority: p.totalScore + (p.cohesionBoost * 0.1), // cohesion as subtle ranking signal
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, processLimit);
    
    // Step 4: Build response
    const processes = rankedProcesses.map(p => ({
      id: p.id,
      summary: p.heuristicLabel || p.label,
      priority: Math.round(p.priority * 1000) / 1000,
      symbol_count: p.symbols.length,
      process_type: p.processType,
      step_count: p.stepCount,
    }));
    
    const processSymbols = rankedProcesses.flatMap(p =>
      p.symbols.slice(0, maxSymbolsPerProcess).map(s => ({
        ...s,
        // remove internal fields
      }))
    );
    
    // Deduplicate process_symbols by id
    const seen = new Set<string>();
    const dedupedSymbols = processSymbols.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    
    return {
      ...(ownerMode ? { mode: 'owners' } : {}),
      processes,
      process_symbols: dedupedSymbols,
      definitions: definitions.slice(0, 20), // cap standalone definitions
    };
  }

  /**
   * BM25 keyword search helper - uses KuzuDB FTS for always-fresh results
   */
  private async bm25Search(repo: RepoHandle, query: string, limit: number): Promise<any[]> {
    const { searchFTSFromKuzu } = await import('../../core/search/bm25-index.js');
    let bm25Results;
    try {
      bm25Results = await searchFTSFromKuzu(query, limit, repo.id);
    } catch (err: any) {
      console.error('CodeNexus: BM25/FTS search failed (FTS indexes may not exist) -', err.message);
      return [];
    }
    return bm25Results.map((bm25Result: any) => ({
      ...bm25Result,
      bm25Score: bm25Result.score,
    }));
  }

  private normalizeSearchText(value: string): string {
    return value
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_./-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private getSplitWordAlias(value: string): string {
    return this.normalizeSearchText(
      value
        .replace(/\.(client|server)$/i, '')
        .replace(/\.(lua|luau)$/i, ''),
    );
  }

  private getCompactSearchText(value: string): string {
    return this.normalizeSearchText(value).replace(/\s+/g, '');
  }

  private getSafeShorthandAliases(value: string): string[] {
    const normalized = this.normalizeSearchText(value);
    if (!normalized) {
      return [];
    }
    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length < 3) {
      return [];
    }
    const aliases = new Set<string>();
    for (let start = 1; start <= parts.length - 2; start += 1) {
      const alias = parts.slice(start).join(' ');
      if (alias.split(' ').length >= 2) {
        aliases.add(alias);
      }
    }
    return [...aliases];
  }

  private getSymbolResolutionAliases(name: string, filePath?: string): string[] {
    const aliases = new Set<string>();
    const addAliases = (value?: string) => {
      if (!value) {
        return;
      }
      const normalized = this.normalizeSearchText(value);
      if (normalized) {
        aliases.add(normalized);
      }
      for (const alias of this.getSafeShorthandAliases(value)) {
        aliases.add(alias);
      }
    };

    addAliases(name);
    if (filePath) {
      addAliases(path.basename(filePath, path.extname(filePath)));
    }
    return [...aliases];
  }

  private async fetchSymbolsByIds(repo: RepoHandle, ids: string[], include_content = false): Promise<any[]> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return [];
    }
    const quotedIds = uniqueIds
      .map((id) => `'${String(id).replace(/'/g, "''")}'`)
      .join(', ');
    const rows = await executeQuery(repo.id, `
      MATCH (n)
      WHERE n.id IN [${quotedIds}]
      RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath,
             n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea,
             n.description AS description${include_content ? ', n.content AS content' : ''}
    `).catch(() => []);
    const byId = new Map(rows.map((row: any) => [row.id || row[0], row]));
    return uniqueIds
      .map((id) => byId.get(id))
      .filter(Boolean);
  }

  private async lookupNamedSymbols(
    repo: RepoHandle,
    params: { name: string; file_path?: string; include_content?: boolean },
  ): Promise<any[]> {
    const { name, file_path, include_content } = params;
    const isQualified = name.includes('/') || name.includes(':');

    let whereClause: string;
    let queryParams: Record<string, any>;
    if (file_path) {
      whereClause = `WHERE n.name = $symName AND n.filePath CONTAINS $filePath`;
      queryParams = { symName: name, filePath: file_path };
    } else if (isQualified) {
      whereClause = `WHERE n.id = $symName OR n.name = $symName`;
      queryParams = { symName: name };
    } else {
      whereClause = `WHERE n.name = $symName`;
      queryParams = { symName: name };
    }

    const exactMatches = await executeParameterized(repo.id, `
      MATCH (n) ${whereClause}
      RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath,
             n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea,
             n.description AS description${include_content ? ', n.content AS content' : ''}
      LIMIT 10
    `, queryParams);
    if (exactMatches.length > 0 || isQualified) {
      return exactMatches;
    }

    const normalizedQuery = this.normalizeSearchText(name);
    const compactQuery = this.getCompactSearchText(name);
    if (!normalizedQuery || !compactQuery) {
      return [];
    }

    const aliasRows = await executeParameterized(repo.id, `
      MATCH (n:Module)
      WHERE lower(n.name) CONTAINS $compactQuery OR lower(n.filePath) CONTAINS $compactQuery
      RETURN n.id AS id, n.name AS name, 'Module' AS type, n.filePath AS filePath,
             n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea,
             n.description AS description
      UNION
      MATCH (n:Class)
      WHERE lower(n.name) CONTAINS $compactQuery OR lower(n.filePath) CONTAINS $compactQuery
      RETURN n.id AS id, n.name AS name, 'Class' AS type, n.filePath AS filePath,
             n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea,
             n.description AS description
      UNION
      MATCH (n:File)
      WHERE lower(n.name) CONTAINS $compactQuery OR lower(n.filePath) CONTAINS $compactQuery
      RETURN n.id AS id, n.name AS name, 'File' AS type, n.filePath AS filePath,
             0 AS startLine, 0 AS endLine, n.runtimeArea AS runtimeArea,
             '' AS description
      LIMIT 40
    `, { compactQuery }).catch(() => []);

    const aliasMatches = aliasRows.filter((row: any) => {
      const rowFilePath = row.filePath || row[3] || '';
      if (file_path && typeof rowFilePath === 'string' && !rowFilePath.includes(file_path)) {
        return false;
      }
      const aliases = this.getSymbolResolutionAliases(row.name || row[1], rowFilePath);
      return aliases.includes(normalizedQuery);
    });
    if (aliasMatches.length === 0) {
      return [];
    }

    const filePaths = [...new Set(aliasMatches
      .map((row: any) => row.filePath || row[3])
      .filter((candidate: string | undefined) => typeof candidate === 'string' && candidate.length > 0))];
    const ownerSymbols = await this.getOwnerSymbolsForFiles(repo, filePaths);
    const selectedIds = filePaths.map((resolvedFilePath) => {
      const rowCandidates = aliasMatches
        .filter((row: any) => (row.filePath || row[3]) === resolvedFilePath)
        .map((row: any) => ({
          id: row.id || row[0],
          name: row.name || row[1],
          type: this.getNodeKind({ id: row.id || row[0], type: row.type || row[2] }),
          filePath: row.filePath || row[3],
          fanIn: 0,
        }));
      const ownerCandidates = ownerSymbols.filter((row: any) => row.filePath === resolvedFilePath);
      const rankedCandidates = this.rankOwnerCandidates(
        [...rowCandidates, ...ownerCandidates]
          .filter((row: any, index: number, array: any[]) => array.findIndex((candidate: any) => candidate.id === row.id) === index)
          .filter((row: any) => this.isOwnerLikeSymbolKind(row.type) || row.type === 'File'),
      );
      return (rankedCandidates[0] || rowCandidates[0])?.id;
    }).filter(Boolean);

    return this.fetchSymbolsByIds(repo, selectedIds, include_content);
  }

  private isBroadSearchQuery(searchQuery: string): boolean {
    const trimmed = searchQuery.trim();
    if (!trimmed) return false;
    if (/[\\/]/.test(trimmed)) return false;
    if (/\.(lua|luau)$/i.test(trimmed)) return false;
    return this.normalizeSearchText(trimmed).includes(' ');
  }

  private isSubsystemDiscoveryQuery(searchQuery: string): boolean {
    const normalized = this.normalizeSearchText(searchQuery);
    if (!this.isBroadSearchQuery(searchQuery)) {
      return false;
    }

    return /\b(runtime|lifecycle|bridge|protocol|http|plugin|shell|projection|studio|server|client|world|subsystem|transport|router|executor|manager|orchestrator)\b/.test(normalized);
  }

  private isTestFocusedQuery(searchQuery: string): boolean {
    const normalized = this.normalizeSearchText(searchQuery);
    if (!/\b(test|tests|testing|spec|smoke|playtest|harness|fixture|fixtures|matrix)\b/.test(normalized)) {
      return false;
    }
    return !/\b(runtime|lifecycle|bridge|protocol|http|plugin|shell|projection|studio|server|client|world|subsystem)\b/.test(normalized);
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
    const basename = path.basename(filePath || '');
    if (resultType === 'File' && /^__init__\./i.test(basename)) {
      return ownersMode ? 4 : 2.5;
    }
    if (
      resultType === 'Class' &&
      anchorFiles.has(filePath) &&
      /(Request|Response|Payload|Status|Snapshot|Result|Authority|Config|Options)$/i.test(name)
    ) {
      return ownersMode ? 5 : 3;
    }
    if (
      resultType === 'File' &&
      (/\.(json|ya?ml|toml)$/i.test(basename) || /(^|\/)(config|configs)\//i.test(filePath))
    ) {
      return ownersMode ? 6 : 3.5;
    }
    return 0;
  }

  private computeBroadSearchPenalties(
    searchQuery: string,
    filePath: string,
    ownersMode = false,
  ): { productionBoost: number; anchorBoost: number; testPenalty: number; secondaryPenalty: number; nonCodePenalty: number } {
    const broadSearch = ownersMode || this.isBroadSearchQuery(searchQuery);
    if (!broadSearch) {
      return { productionBoost: 0, anchorBoost: 0, testPenalty: 0, secondaryPenalty: 0, nonCodePenalty: 0 };
    }

    const subsystemDiscovery = ownersMode || this.isSubsystemDiscoveryQuery(searchQuery);
    const testFocusedQuery = this.isTestFocusedQuery(searchQuery);
    const productionBoost = this.isLikelyProductionFile(filePath)
      ? (ownersMode ? 6 : subsystemDiscovery ? 4.5 : 3)
      : 0;
    const testPenalty = isTestFilePath(filePath)
      ? (testFocusedQuery ? 2.5 : ownersMode ? 16 : subsystemDiscovery ? 12 : 8)
      : 0;
    const secondaryPenalty = !this.isLikelyProductionFile(filePath) && !isTestFilePath(filePath)
      ? (ownersMode ? 5 : subsystemDiscovery ? 4 : 2.5)
      : 0;
    const nonCodePenalty = subsystemDiscovery && !this.isLikelyCodeFile(filePath)
      ? (ownersMode ? 8 : 6)
      : 0;

    return {
      productionBoost,
      anchorBoost: ownersMode ? 3 : subsystemDiscovery ? 1 : 0,
      testPenalty,
      secondaryPenalty,
      nonCodePenalty,
    };
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
    const uniqueFilePaths = [...new Set(filePaths.filter(Boolean))];
    if (uniqueFilePaths.length === 0) {
      return new Map();
    }

    const quotedFilePaths = uniqueFilePaths
      .map((filePath) => `'${String(filePath).replace(/'/g, "''")}'`)
      .join(', ');

    const [communityRows, processRows] = await Promise.all([
      executeQuery(repo.id, `
        MATCH (f:File)-[:CodeRelation {type: 'DEFINES'}]->(s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
        WHERE f.filePath IN [${quotedFilePaths}]
        RETURN f.filePath AS filePath, COUNT(DISTINCT c.id) AS communityCount
      `).catch(() => []),
      executeQuery(repo.id, `
        MATCH (f:File)-[:CodeRelation {type: 'DEFINES'}]->(s)-[:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
        WHERE f.filePath IN [${quotedFilePaths}]
        RETURN f.filePath AS filePath, COUNT(DISTINCT p.id) AS processCount
      `).catch(() => []),
    ]);

    const out = new Map<string, { communityCount: number; processCount: number }>();
    for (const row of communityRows) {
      const filePath = row.filePath || row[0];
      if (!filePath) continue;
      out.set(filePath, {
        communityCount: row.communityCount || row[1] || 0,
        processCount: out.get(filePath)?.processCount || 0,
      });
    }
    for (const row of processRows) {
      const filePath = row.filePath || row[0];
      if (!filePath) continue;
      const existing = out.get(filePath) || { communityCount: 0, processCount: 0 };
      existing.processCount = row.processCount || row[1] || 0;
      out.set(filePath, existing);
    }
    return out;
  }

  private computeBroadQuerySignalBoost(
    searchQuery: string,
    resultType: string,
    fileSignal: { communityCount: number; processCount: number } | undefined,
    ownersMode = false,
  ): number {
    if ((!ownersMode && !this.isSubsystemDiscoveryQuery(searchQuery)) || !fileSignal) {
      return 0;
    }

    const anchorMultiplier = this.isOwnerLikeSymbolKind(resultType)
      ? 1.2
      : ownersMode
        ? 0.15
        : 0.5;
    return (
      Math.min(fileSignal.communityCount, 2) * 1.1 +
      Math.min(fileSignal.processCount, 2) * 0.9
    ) * anchorMultiplier;
  }

  private getBroadQueryWeightedTerms(searchQuery: string, ownersMode = false): Array<{ term: string; weight: number }> {
    if (!ownersMode && !this.isSubsystemDiscoveryQuery(searchQuery)) {
      return [];
    }

    const stopwords = new Set([
      'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with',
    ]);
    const actionTerms = new Set([
      'build', 'check', 'connect', 'copy', 'disconnect', 'execute', 'get', 'handle', 'log', 'run', 'send', 'set', 'start', 'status', 'stop',
    ]);
    const testTerms = new Set([
      'e2e', 'fixture', 'fixtures', 'harness', 'matrix', 'playtest', 'smoke', 'spec', 'test', 'testing', 'tests',
    ]);
    const highSignalTerms = new Set([
      'automation', 'bridge', 'connected', 'http', 'plugin', 'projection', 'protocol', 'shell', 'studio', 'transport', 'world',
    ]);
    const mediumSignalTerms = new Set([
      'client', 'executor', 'lifecycle', 'manager', 'orchestrator', 'router', 'runtime', 'server',
    ]);

    const seen = new Set<string>();
    return this.normalizeSearchText(searchQuery)
      .split(' ')
      .filter(Boolean)
      .filter((term) => term.length >= 2 && !stopwords.has(term))
      .filter((term) => {
        if (seen.has(term)) return false;
        seen.add(term);
        return true;
      })
      .map((term) => {
        if (actionTerms.has(term)) {
          return { term, weight: ownersMode ? 0.1 : 0.2 };
        }
        if (testTerms.has(term)) {
          return { term, weight: ownersMode ? 0.2 : 0.3 };
        }
        if (highSignalTerms.has(term)) {
          return { term, weight: ownersMode ? 1.8 : 1.5 };
        }
        if (mediumSignalTerms.has(term)) {
          return { term, weight: ownersMode ? 1.2 : 0.9 };
        }
        return { term, weight: 1.1 };
      });
  }

  private computeBroadQueryTermScore(
    searchQuery: string,
    result: { name: string; filePath: string; type: string; moduleSymbol?: string; description?: string },
    ownersMode = false,
  ): { boost: number; penalty: number } {
    const weightedTerms = this.getBroadQueryWeightedTerms(searchQuery, ownersMode);
    if (weightedTerms.length === 0) {
      return { boost: 0, penalty: 0 };
    }

    const candidateTokens = new Set(
      [
        result.name,
        path.basename(result.filePath || ''),
        result.filePath || '',
        result.moduleSymbol || '',
      ]
        .map((value) => this.normalizeSearchText(value))
        .flatMap((value) => value.split(' '))
        .filter(Boolean),
    );
    const overlapWeight = weightedTerms.reduce((total, entry) => (
      candidateTokens.has(entry.term) ? total + entry.weight : total
    ), 0);
    const signalTerms = weightedTerms.filter((entry) => entry.weight >= 0.9).length;
    const highSignalTerms = weightedTerms.filter((entry) => entry.weight >= 1.1);
    const matchedHighSignalTerms = highSignalTerms.filter((entry) => candidateTokens.has(entry.term)).length;
    const anchorMultiplier = this.isOwnerLikeSymbolKind(result.type)
      ? (ownersMode ? 1.5 : 1.2)
      : result.type === 'Method' || result.type === 'Function'
        ? (ownersMode ? 0.4 : 0.7)
        : 0.9;
    const boost = overlapWeight * anchorMultiplier;
    let penalty = signalTerms >= 2 && overlapWeight < 0.9
      ? (['Method', 'Function'].includes(result.type) ? (ownersMode ? 4 : 3) : 1.75)
      : 0;
    if (highSignalTerms.length >= 1 && matchedHighSignalTerms === 0) {
      penalty += ['Method', 'Function'].includes(result.type) ? (ownersMode ? 6 : 5) : 6;
    } else if (highSignalTerms.length >= 2 && matchedHighSignalTerms === 1) {
      penalty += ['Method', 'Function'].includes(result.type) ? (ownersMode ? 2.5 : 1.5) : 2.5;
    }
    return { boost, penalty };
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
    if (!rojoProject || !filePath) return false;
    return (rojoProject.getTargetsForFile(filePath) || []).length > 0;
  }

  private async getRojoProjectIndex(repo: RepoHandle): Promise<any | null> {
    let cached = this.rojoProjectCache.get(repo.id);
    if (!cached) {
      cached = (async () => {
        const rows = await executeQuery(repo.id, `
          MATCH (n:File)
          RETURN n.filePath AS filePath
        `);
        const filePaths = rows
          .map((row: any) => row.filePath || row[0])
          .filter(Boolean);
        const { loadRojoProjectIndex } = await import('../../core/ingestion/roblox/rojo-project.js');
        return loadRojoProjectIndex(repo.repoPath, filePaths);
      })();
      this.rojoProjectCache.set(repo.id, cached);
    }
    return cached;
  }

  private async getPrimaryModuleSymbols(repo: RepoHandle, filePaths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const filePath of filePaths) {
      try {
        const rows = await executeParameterized(repo.id, `
          MATCH (m:Module)
          WHERE m.filePath = $filePath
          RETURN m.name AS name, m.description AS description, m.startLine AS startLine
          ORDER BY CASE
            WHEN m.description STARTS WITH 'luau-module:strong' THEN 0
            ELSE 1
          END, m.startLine ASC
          LIMIT 1
        `, { filePath });
        if (rows.length > 0) {
          out.set(filePath, rows[0].name || rows[0][0]);
        }
      } catch {
        // ignore enrichment failures
      }
    }
    return out;
  }

  private async getBoundaryImports(repo: RepoHandle, filePaths: string[]): Promise<Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>> {
    const out = new Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>();
    for (const filePath of filePaths) {
      try {
        const rows = await executeParameterized(repo.id, `
          MATCH (src {filePath: $filePath})-[r:CodeRelation {type: 'IMPORTS'}]->(dst)
          WHERE src.runtimeArea IS NOT NULL AND dst.runtimeArea IS NOT NULL AND src.runtimeArea <> dst.runtimeArea
          RETURN dst.name AS name, dst.filePath AS filePath, dst.runtimeArea AS runtimeArea
          LIMIT 3
        `, { filePath });
        if (rows.length > 0) {
          out.set(filePath, rows.map((row: any) => ({
            name: row.name || row[0],
            filePath: row.filePath || row[1],
            runtimeArea: row.runtimeArea || row[2] || undefined,
          })));
        }
      } catch {
        // ignore enrichment failures
      }
    }
    return out;
  }

  private async getExactAliasCandidates(repo: RepoHandle, searchQuery: string): Promise<any[]> {
    const compactQuery = this.getCompactSearchText(searchQuery);
    if (!compactQuery) return [];

    const rows = await executeParameterized(repo.id, `
      MATCH (n:Module)
      WHERE lower(n.name) CONTAINS $compactQuery OR lower(n.filePath) CONTAINS $compactQuery
      RETURN n.id AS nodeId, n.name AS name, 'Module' AS type, n.filePath AS filePath,
             n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea,
             n.description AS description
      UNION
      MATCH (n:File)
      WHERE lower(n.name) CONTAINS $compactQuery OR lower(n.filePath) CONTAINS $compactQuery
      RETURN n.id AS nodeId, n.name AS name, 'File' AS type, n.filePath AS filePath,
             0 AS startLine, 0 AS endLine, n.runtimeArea AS runtimeArea,
             '' AS description
    `, { compactQuery });

    return rows
      .map((row: any) => ({
        nodeId: row.nodeId || row[0],
        name: row.name || row[1],
        type: row.type || row[2],
        filePath: row.filePath || row[3],
        startLine: row.startLine || row[4],
        endLine: row.endLine || row[5],
        runtimeArea: row.runtimeArea || row[6],
        description: row.description || row[7],
        score: 0,
        bm25Score: 0,
      }))
      .filter((row: any) => {
        const normalizedQuery = this.normalizeSearchText(searchQuery);
        const compact = this.getCompactSearchText(searchQuery);
        const fileBase = this.getSplitWordAlias(path.basename(row.filePath || ''));
        const compactFileBase = this.getCompactSearchText(path.basename(row.filePath || '').replace(/\.(client|server)?\.?luau?$/i, ''));
        const normalizedName = this.normalizeSearchText(row.name || '');
        const compactName = this.getCompactSearchText(row.name || '');
        return (
          normalizedName === normalizedQuery ||
          fileBase === normalizedQuery ||
          compactName === compact ||
          compactFileBase === compact
        );
      });
  }

  private async getBroadAnchorCandidates(repo: RepoHandle, searchQuery: string, rawResults: any[], ownersMode = false): Promise<any[]> {
    if (!ownersMode && !this.isSubsystemDiscoveryQuery(searchQuery)) {
      return [];
    }

    const candidateFilePathSet = new Set(
      rawResults
        .map((row: any) => row.filePath)
        .filter((filePath: string | undefined) => typeof filePath === 'string' && this.isLikelyProductionFile(filePath)),
    );
    const exploratoryTerms = this.getBroadQueryWeightedTerms(searchQuery, ownersMode)
      .filter((entry) => entry.weight >= 1.1)
      .map((entry) => entry.term)
      .slice(0, 4);
    for (const term of exploratoryTerms) {
      try {
        const rows = await executeParameterized(repo.id, `
          MATCH (n:File)
          WHERE lower(n.filePath) CONTAINS $term OR lower(n.name) CONTAINS $term
          RETURN n.filePath AS filePath
          UNION
          MATCH (n:Module)
          WHERE lower(n.filePath) CONTAINS $term OR lower(n.name) CONTAINS $term
          RETURN n.filePath AS filePath
          LIMIT 10
        `, { term });
        for (const row of rows) {
          const filePath = row.filePath || row[0];
          if (typeof filePath === 'string' && this.isLikelyProductionFile(filePath)) {
            candidateFilePathSet.add(filePath);
          }
        }
      } catch {
        // ignore term-anchor enrichment failures
      }
    }

    const candidateFilePaths = [...candidateFilePathSet].slice(0, 30);

    if (candidateFilePaths.length === 0) {
      return [];
    }

    const quotedFilePaths = candidateFilePaths
      .map((filePath) => `'${String(filePath).replace(/'/g, "''")}'`)
      .join(', ');

    const rows = await executeQuery(repo.id, `
      MATCH (n:File)
      WHERE n.filePath IN [${quotedFilePaths}]
      RETURN n.id AS nodeId, n.name AS name, 'File' AS type, n.filePath AS filePath,
             0 AS startLine, 0 AS endLine, n.runtimeArea AS runtimeArea,
             '' AS description
      UNION
      MATCH (n:Module)
      WHERE n.filePath IN [${quotedFilePaths}]
      RETURN n.id AS nodeId, n.name AS name, 'Module' AS type, n.filePath AS filePath,
             n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea,
             n.description AS description
      UNION
      MATCH (n:Class)
      WHERE n.filePath IN [${quotedFilePaths}]
      RETURN n.id AS nodeId, n.name AS name, 'Class' AS type, n.filePath AS filePath,
             n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea,
             n.description AS description
    `);

    return rows.map((row: any) => ({
      nodeId: row.nodeId || row[0],
      name: row.name || row[1] || path.basename(row.filePath || row[3] || ''),
      type: row.type || row[2],
      filePath: row.filePath || row[3],
      startLine: row.startLine || row[4],
      endLine: row.endLine || row[5],
      runtimeArea: row.runtimeArea || row[6],
      description: row.description || row[7],
      score: 0,
      bm25Score: 0,
    }));
  }

  private computeSearchBoost(
    searchQuery: string,
    result: { name: string; filePath: string; type: string; runtimeArea?: string; dataModelPath?: string; moduleSymbol?: string; description?: string },
    ownersMode = false,
  ): number {
    const normalizedQuery = this.normalizeSearchText(searchQuery);
    const normalizedName = this.normalizeSearchText(result.name);
    const fileBase = this.getSplitWordAlias(path.basename(result.filePath));
    const moduleAlias = result.moduleSymbol ? this.getSplitWordAlias(result.moduleSymbol) : '';
    const dataModelPath = result.dataModelPath ? this.normalizeSearchText(result.dataModelPath) : '';
    let boost = 0;

    if (normalizedName === normalizedQuery) boost += 6;
    if (moduleAlias && moduleAlias === normalizedQuery) boost += result.type === 'Module' ? 5 : 3;
    if (fileBase === normalizedQuery) boost += result.type === 'File' ? 4 : 2.5;
    if (normalizedName.includes(normalizedQuery)) boost += 1.5;
    if (moduleAlias && moduleAlias.includes(normalizedQuery)) boost += 1.25;
    if (fileBase.includes(normalizedQuery)) boost += 1;
    if (dataModelPath && dataModelPath.includes(normalizedQuery)) boost += 1.5;

    if (normalizedQuery.includes('client')) {
      boost += result.runtimeArea === 'client' ? (ownersMode ? 2.5 : 1.25) : result.runtimeArea ? (ownersMode ? -3 : -1.25) : 0;
    }
    if (normalizedQuery.includes('server')) {
      boost += result.runtimeArea === 'server' ? (ownersMode ? 2.5 : 1.25) : result.runtimeArea ? (ownersMode ? -3 : -1.25) : 0;
    }
    if (normalizedQuery.includes('shared')) {
      boost += result.runtimeArea === 'shared' ? (ownersMode ? 2.5 : 1.25) : result.runtimeArea ? (ownersMode ? -3 : -1.25) : 0;
    }
    if (normalizedQuery.includes('ui')) {
      const uiPath = /(^|\/)ui(\/|$)/i.test(result.filePath) || (dataModelPath && /(^| )ui( |$)/i.test(dataModelPath));
      boost += uiPath ? (ownersMode ? 2 : 1.1) : ownersMode ? -1.5 : -0.4;
    }

    if (result.type === 'Module' && result.description?.startsWith('luau-module:strong')) boost += 1;
    if (result.type === 'Module' && result.description?.startsWith('luau-module:weak')) boost -= 0.5;

    return boost;
  }

  private async rankSearchResults(repo: RepoHandle, searchQuery: string, rawResults: any[], limit: number, ownersMode = false): Promise<RankedSearchResult[]> {
    const exactAliasCandidates = await this.getExactAliasCandidates(repo, searchQuery);
    const broadAnchorCandidates = await this.getBroadAnchorCandidates(repo, searchQuery, rawResults, ownersMode);
    const dedupedRaw = [...rawResults, ...exactAliasCandidates, ...broadAnchorCandidates].filter((result, index, array) => {
      const key = result.nodeId || `${result.type}:${result.filePath}:${result.name}:${result.startLine || ''}`;
      return array.findIndex((candidate) => {
        const candidateKey = candidate.nodeId || `${candidate.type}:${candidate.filePath}:${candidate.name}:${candidate.startLine || ''}`;
        return candidateKey === key;
      }) === index;
    });
    const filePaths = [...new Set(dedupedRaw.map(r => r.filePath).filter(Boolean))];
    const [rojoProject, primaryModules, boundaryImports] = await Promise.all([
      this.getRojoProjectIndex(repo),
      this.getPrimaryModuleSymbols(repo, filePaths),
      this.getBoundaryImports(repo, filePaths),
    ]);

    const hasMappedCandidates = dedupedRaw.some((result: any) => this.isRojoMappedResult(rojoProject, result.filePath));
    const preferMappedResults = (ownersMode || this.isBroadSearchQuery(searchQuery)) && hasMappedCandidates;
    const subsystemDiscovery = ownersMode || this.isSubsystemDiscoveryQuery(searchQuery);
    const broadQueryFileSignals = subsystemDiscovery
      ? await this.getBroadQueryFileSignals(repo, filePaths)
      : new Map<string, { communityCount: number; processCount: number }>();
    const anchorFiles = new Set(
      dedupedRaw
        .filter((result: any) => this.isOwnerLikeSymbolKind(this.getNodeKind(result)))
        .map((result: any) => result.filePath)
        .filter(Boolean),
    );

    const ranked = dedupedRaw.map((result: any) => {
      const resultType = this.getNodeKind(result);
      const rojoTarget = rojoProject?.getTargetsForFile(result.filePath)?.[0] as RojoTargetSummary | undefined;
      const moduleSymbol = resultType === 'Module' ? result.name : primaryModules.get(result.filePath);
      const rojoMappingBoost = preferMappedResults
        ? (rojoTarget ? 5 : -5)
        : 0;
      const { productionBoost, anchorBoost, testPenalty, secondaryPenalty, nonCodePenalty } = this.computeBroadSearchPenalties(searchQuery, result.filePath, ownersMode);
      const primarySourceBoost = subsystemDiscovery && this.isPrimarySourceFile(result.filePath) ? 2.5 : 0;
      const anchorTypeBoost = subsystemDiscovery
        ? (resultType === 'File' || resultType === 'Module'
          ? anchorBoost + (ownersMode ? 3.5 : 2)
          : resultType === 'Class'
            ? anchorBoost + (ownersMode ? 1.25 : 1.5)
          : this.isOwnerLikeSymbolKind(resultType)
            ? anchorBoost + 1
          : resultType === 'Method'
            ? 0
            : 0)
        : 0;
      const actionPenalty = this.getBroadQueryActionPenalty(resultType, result.name, searchQuery, ownersMode);
      const { boost: broadTermBoost, penalty: broadTermPenalty } = this.computeBroadQueryTermScore(searchQuery, {
        name: result.name,
        filePath: result.filePath,
        type: resultType,
        moduleSymbol,
        description: result.description,
      }, ownersMode);
      const graphSignalBoost = this.computeBroadQuerySignalBoost(
        searchQuery,
        resultType,
        broadQueryFileSignals.get(result.filePath),
        ownersMode,
      );
      const sameFileAnchorPenalty = subsystemDiscovery &&
        anchorFiles.has(result.filePath) &&
        !this.isOwnerLikeSymbolKind(resultType)
        ? (ownersMode ? 5.5 : 3.5)
        : 0;
      const ownerShapePenalty = subsystemDiscovery
        ? this.getBroadOwnerShapePenalty(resultType, result.name, result.filePath, ownersMode, anchorFiles)
        : 0;
      const weakWrapperPenalty = ownersMode && resultType === 'Module' && result.description?.startsWith('luau-module:weak')
        ? 1.5
        : 0;
      const score = (result.bm25Score ?? result.score ?? 0) + this.computeSearchBoost(searchQuery, {
        name: result.name,
        filePath: result.filePath,
        type: resultType,
        runtimeArea: result.runtimeArea,
        dataModelPath: rojoTarget?.dataModelPath,
        moduleSymbol,
        description: result.description,
      }, ownersMode) + rojoMappingBoost + productionBoost + primarySourceBoost + anchorTypeBoost + graphSignalBoost + broadTermBoost - testPenalty - secondaryPenalty - nonCodePenalty - actionPenalty - broadTermPenalty - sameFileAnchorPenalty - weakWrapperPenalty - ownerShapePenalty;

      return {
        nodeId: result.nodeId,
        name: result.name,
        type: resultType,
        filePath: result.filePath,
        startLine: result.startLine,
        endLine: result.endLine,
        runtimeArea: result.runtimeArea,
        description: result.description,
        bm25Score: result.bm25Score ?? result.score ?? 0,
        score,
        moduleSymbol,
        dataModelPath: rojoTarget?.dataModelPath,
        boundaryImports: boundaryImports.get(result.filePath),
      } satisfies RankedSearchResult;
    });

    return ranked
      .sort((a, b) => b.score - a.score || b.bm25Score - a.bm25Score)
      .slice(0, limit);
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
    const groups = new Map<string, { ids: string[]; totalSymbols: number; weightedCohesion: number; largest: any }>();

    for (const c of clusters) {
      const label = c.heuristicLabel || c.label || 'Unknown';
      const symbols = c.symbolCount || 0;
      const cohesion = c.cohesion || 0;
      const existing = groups.get(label);

      if (!existing) {
        groups.set(label, { ids: [c.id], totalSymbols: symbols, weightedCohesion: cohesion * symbols, largest: c });
      } else {
        existing.ids.push(c.id);
        existing.totalSymbols += symbols;
        existing.weightedCohesion += cohesion * symbols;
        if (symbols > (existing.largest.symbolCount || 0)) {
          existing.largest = c;
        }
      }
    }

    return Array.from(groups.entries())
      .map(([label, g]) => ({
        id: g.largest.id,
        label,
        heuristicLabel: label,
        symbolCount: g.totalSymbols,
        cohesion: g.totalSymbols > 0 ? g.weightedCohesion / g.totalSymbols : 0,
        subCommunities: g.ids.length,
      }))
      .filter(c => c.symbolCount >= 5)
      .sort((a, b) => b.symbolCount - a.symbolCount);
  }

  private humanizeSummaryLabel(label: string): string {
    return label
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isLowSignalSubsystemLabel(label: string): boolean {
    const normalized = this.humanizeSummaryLabel(label).toLowerCase();
    if (!normalized) {
      return true;
    }
    if (normalized.includes('→')) {
      return true;
    }
    return new Set([
      'adapter',
      'adapters',
      'component',
      'components',
      'log',
      'logging',
      'runtime',
      'system',
      'systems',
      'tool',
      'tools',
      'unit',
      'scenarios',
    ]).has(normalized);
  }

  private isBroadSubsystemLabel(label: string): boolean {
    const normalized = this.humanizeSummaryLabel(label).toLowerCase();
    return new Set([
      'app',
      'client',
      'common',
      'core',
      'game',
      'server',
      'shared',
      'world',
    ]).has(normalized);
  }

  private normalizeSubsystemPhraseSegment(segment: string): string {
    const humanized = this.humanizeSummaryLabel(segment);
    return humanized
      .replace(/\b(Adapters|Components|Modules|Systems|Tools)\b$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getPathSummaryPhrase(filePath: string): string | null {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    const ignoredSegments = new Set([
      'src',
      'typed',
      'app',
      'lib',
      'pkg',
      'internal',
      'server',
      'client',
      'shared',
      'replicatedstorage',
      'serverscriptservice',
      'starterplayerscripts',
      'starterplayer',
    ]);
    const directorySegments = segments.slice(0, -1).filter((segment) => !ignoredSegments.has(segment.toLowerCase()));
    const tail = directorySegments.slice(-2);
    if (tail.length === 0) {
      const basename = path.basename(normalized, path.extname(normalized));
      return basename ? this.humanizeSummaryLabel(basename) : null;
    }
    const normalizedTail = tail
      .map((segment) => this.normalizeSubsystemPhraseSegment(segment))
      .filter(Boolean);
    if (normalizedTail.length === 2 && this.isBroadSubsystemLabel(normalizedTail[0]) && !this.isLowSignalSubsystemLabel(normalizedTail[1])) {
      return normalizedTail[1];
    }
    return normalizedTail.join(' ');
  }

  private deriveSubsystemLabel(
    rawLabel: string,
    filePaths: string[],
    topOwners: Array<{ filePath?: string; fan_in?: number; fanIn?: number }>,
    hotAnchors: Array<{ filePath?: string; fan_in?: number; fanIn?: number }>,
  ): string {
    const humanizedRaw = this.humanizeSummaryLabel(rawLabel);
    if (!this.isLowSignalSubsystemLabel(rawLabel) && !this.isBroadSubsystemLabel(rawLabel)) {
      return humanizedRaw || rawLabel;
    }

    const candidateScores = new Map<string, number>();
    const addCandidate = (phrase: string | null | undefined, weight: number) => {
      if (!phrase) return;
      const normalized = this.humanizeSummaryLabel(phrase);
      if (!normalized || this.isLowSignalSubsystemLabel(normalized)) {
        return;
      }
      candidateScores.set(normalized, (candidateScores.get(normalized) || 0) + weight);
    };

    for (const owner of topOwners) {
      addCandidate(owner.filePath ? this.getPathSummaryPhrase(owner.filePath) : null, owner.fan_in || owner.fanIn || 4);
    }
    for (const anchor of hotAnchors) {
      addCandidate(anchor.filePath ? this.getPathSummaryPhrase(anchor.filePath) : null, anchor.fan_in || anchor.fanIn || 3);
    }
    for (const filePath of filePaths.slice(0, 12)) {
      addCandidate(this.getPathSummaryPhrase(filePath), 1);
    }

    const bestCandidate = [...candidateScores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (bestCandidate && (this.isLowSignalSubsystemLabel(rawLabel) || this.isBroadSubsystemLabel(rawLabel))) {
      return bestCandidate;
    }
    return bestCandidate || humanizedRaw || rawLabel;
  }

  private buildConciseSubsystemSummary(
    repo: RepoHandle,
    result: any,
  limit: number,
  ): any {
    const toTitleWords = (value: string): string => value
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    const toDisplayLabel = (entry: any): string | null => {
      if (!entry) return null;
      const kind = this.getNodeKind({ id: entry.id, type: entry.type });
      const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
      const filePath = typeof entry.filePath === 'string' ? entry.filePath : '';
      const fileStem = filePath
        ? this.humanizeSummaryLabel(path.basename(filePath, path.extname(filePath)))
        : '';
      const ownerLike = this.isOwnerLikeSymbolKind(kind);
      if (kind === 'File' && fileStem) {
        return toTitleWords(fileStem);
      }
      if (ownerLike && rawName) {
        return toTitleWords(this.humanizeSummaryLabel(rawName));
      }
      if (fileStem) {
        return toTitleWords(fileStem);
      }
      if (!rawName) {
        return null;
      }
      if (kind === 'Method' || kind === 'Function' || this.isLowSignalSummarySymbol(rawName)) {
        return fileStem ? toTitleWords(fileStem) : toTitleWords(this.humanizeSummaryLabel(rawName));
      }
      return toTitleWords(this.humanizeSummaryLabel(rawName));
    };

    const toSubsystemDisplayName = (value: string): string => {
      const normalized = this.normalizeSubsystemPhraseSegment(value);
      const display = this.humanizeSummaryLabel(normalized || value);
      return toTitleWords(display);
    };
    const signalAlignsToSubsystem = (subsystemName: string, entry: any): boolean => {
      if (!entry) return false;
      const rawSubsystemTokens = this.normalizeSearchText(subsystemName)
        .split(' ')
        .filter(Boolean);
      const subsystemTokens = new Set(
        rawSubsystemTokens.filter((token) => token.length >= 3),
      );
      if (subsystemTokens.size === 0) {
        for (const token of rawSubsystemTokens) {
          subsystemTokens.add(token);
        }
      }
      if (subsystemTokens.size === 0) {
        return false;
      }
      const candidatePhrases = [
        typeof entry.name === 'string' ? entry.name : '',
        typeof entry.filePath === 'string' ? this.getPathSummaryPhrase(entry.filePath) || '' : '',
        typeof entry.filePath === 'string' ? path.basename(entry.filePath, path.extname(entry.filePath)) : '',
      ];
      return candidatePhrases.some((phrase) =>
        this.normalizeSearchText(phrase)
          .split(' ')
          .filter((token) => token.length >= 3 || subsystemTokens.has(token))
          .some((token) => subsystemTokens.has(token)),
      );
    };
    const rankableSubsystems = (result.subsystems || []).filter((subsystem: any) => typeof subsystem?.name === 'string' && subsystem.name.trim());
    const seenSubsystemNames = new Set<string>();
    const uniqueSubsystems = rankableSubsystems.filter((subsystem: any) => {
      const key = toSubsystemDisplayName(subsystem.name).toLowerCase();
      if (seenSubsystemNames.has(key)) {
        return false;
      }
      seenSubsystemNames.add(key);
      return true;
    });
    const preferredSubsystems = uniqueSubsystems.filter((subsystem: any) =>
      !this.isLowSignalSubsystemLabel(subsystem.name) && !this.isBroadSubsystemLabel(subsystem.name),
    );
    const fallbackSubsystems = uniqueSubsystems.filter((subsystem: any) =>
      this.isLowSignalSubsystemLabel(subsystem.name) || this.isBroadSubsystemLabel(subsystem.name),
    );
    const selectedSubsystems = [...preferredSubsystems, ...fallbackSubsystems].slice(0, Math.max(1, limit));

    const subsystems = selectedSubsystems.map((subsystem: any) => ({
      name: toSubsystemDisplayName(subsystem.name),
      production_files: subsystem.production_files,
      test_files: subsystem.test_files,
      top_owners: (subsystem.top_owners || [])
        .map((owner: any) => toDisplayLabel(owner))
        .filter((owner: string | null, index: number, owners: Array<string | null>) => owner && owners.indexOf(owner) === index)
        .slice(0, 2),
      top_hotspots: (subsystem.hot_anchors || [])
        .filter((anchor: any) => signalAlignsToSubsystem(subsystem.name, anchor))
        .map((anchor: any) => toDisplayLabel(anchor))
        .filter((anchor: string | null, index: number, anchors: Array<string | null>) => anchor && anchors.indexOf(anchor) === index)
        .slice(0, 2),
      top_lifecycle_chokepoints: (subsystem.hot_processes || []).slice(0, 1).map((process: any) => process.name),
      pressure: {
        fan_in: subsystem.fan_in_pressure,
        fan_out: subsystem.fan_out_pressure,
      },
    }));

    const topHotspots = subsystems
      .flatMap((subsystem: any) => subsystem.top_hotspots.map((anchor: any) => ({ name: anchor, subsystem: subsystem.name })))
      .filter((anchor: any, index: number, array: any[]) =>
        array.findIndex((candidate) => candidate.name === anchor.name && candidate.subsystem === anchor.subsystem) === index,
      )
      .slice(0, 2);

    const lifecycleChokepoints = subsystems
      .flatMap((subsystem: any) =>
        subsystem.top_lifecycle_chokepoints.map((process: any) => ({
          name: process,
          subsystem: subsystem.name,
        })),
      )
      .filter((process: any, index: number, array: any[]) =>
        array.findIndex((candidate) => candidate.name === process.name && candidate.subsystem === process.subsystem) === index,
      )
      .slice(0, 2);

    return {
      repo: result.repo,
      stats: repo.stats,
      indexedAt: result.indexedAt,
      lastCommit: result.lastCommit,
      freshness: result.freshness ? {
        state: result.freshness.state,
        indexed_commit: result.freshness.indexed_commit,
        current_commit: result.freshness.current_commit,
      } : null,
      production_vs_test: result.production_vs_test,
      top_hotspots: topHotspots,
      top_lifecycle_chokepoints: lifecycleChokepoints,
      subsystems,
    };
  }

  private async getSubsystemSummary(repo: RepoHandle, limit: number): Promise<any[]> {
    const rawLimit = Math.max(limit * 5, 100);
    const clusters = await executeQuery(repo.id, `
      MATCH (c:Community)
      RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
      ORDER BY c.symbolCount DESC, c.heuristicLabel ASC
      LIMIT ${rawLimit}
    `);
    const aggregated = this.aggregateClusters(clusters.map((c: any) => ({
      id: c.id || c[0],
      label: c.label || c[1],
      heuristicLabel: c.heuristicLabel || c[2],
      cohesion: c.cohesion || c[3],
      symbolCount: c.symbolCount || c[4],
    }))).slice(0, limit);

    const subsystems = await Promise.all(aggregated.map(async (cluster: any) => {
      const label = cluster.heuristicLabel || cluster.label;
      const [fileRows, processRows, pressureRows] = await Promise.all([
        executeParameterized(repo.id, `
          MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          WHERE c.heuristicLabel = $label OR c.label = $label
          RETURN DISTINCT n.filePath AS filePath
        `, { label }).catch(() => []),
        executeParameterized(repo.id, `
          MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          WHERE c.heuristicLabel = $label OR c.label = $label
          MATCH (n)-[:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
          RETURN p.heuristicLabel AS label, COUNT(DISTINCT n.id) AS hits
          ORDER BY hits DESC, label ASC
          LIMIT 3
        `, { label }).catch(() => []),
        executeParameterized(repo.id, `
          MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          WHERE c.heuristicLabel = $label OR c.label = $label
          OPTIONAL MATCH (src)-[rin:CodeRelation]->(n)
          WHERE rin.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
          WITH COLLECT(DISTINCT rin) AS incomingEdges, COLLECT(DISTINCT n) AS members
          UNWIND members AS member
          OPTIONAL MATCH (member)-[rout:CodeRelation]->(dst)
          WHERE rout.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
          RETURN SIZE(incomingEdges) AS fanIn, COUNT(DISTINCT rout) AS fanOut
        `, { label }).catch(() => []),
      ]);

      const filePaths = fileRows.map((row: any) => row.filePath || row[0]).filter(Boolean);
      const subsystemOwnerRows = await executeParameterized(repo.id, `
        MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
        WHERE (c.heuristicLabel = $label OR c.label = $label)
          AND n.filePath IS NOT NULL
        OPTIONAL MATCH (src)-[r:CodeRelation]->(n)
        WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
        RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, COUNT(DISTINCT src.id) AS fanIn
        ORDER BY fanIn DESC, n.name ASC
        LIMIT 50
      `, { label }).catch(() => []);
      const directSubsystemOwners = this.rankOwnerCandidates(
        subsystemOwnerRows
          .map((row: any) => ({
            id: row.id || row[0],
            name: row.name || row[1],
            type: this.getNodeKind({ id: row.id || row[0], type: row.type || row[2] }),
            filePath: row.filePath || row[3],
            fan_in: row.fanIn || row[4] || 0,
          }))
          .filter((row: any) =>
            row.filePath &&
            this.isLikelyProductionFile(row.filePath) &&
            this.isPrimaryOwnerKind(row.type),
          ),
      );
      const quotedFilePaths = [...new Set(filePaths)]
        .map((filePath) => `'${String(filePath).replace(/'/g, "''")}'`)
        .join(', ');
      const hotAnchorRows = quotedFilePaths
        ? await executeQuery(repo.id, `
            MATCH (src)-[r:CodeRelation]->(n)
            WHERE n.filePath IN [${quotedFilePaths}]
              AND r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
            RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, COUNT(DISTINCT src.id) AS fanIn
            ORDER BY fanIn DESC, name ASC
            LIMIT 25
          `).catch(() => [])
        : [];
      const hotAnchors = hotAnchorRows
        .map((row: any) => ({
          id: row.id || row[0],
          name: row.name || row[1],
          type: this.getNodeKind({ id: row.id || row[0], type: row.type || row[2] }),
          filePath: row.filePath || row[3],
          fan_in: row.fanIn || row[4] || 0,
        }))
        .filter((row: any) =>
          row.filePath &&
          this.isLikelyProductionFile(row.filePath) &&
          row.fan_in > 0 &&
          !this.isLowSignalSummarySymbol(row.name),
        )
        .sort((a: any, b: any) =>
          b.fan_in - a.fan_in ||
          this.getOwnerSymbolPriority(b.type) - this.getOwnerSymbolPriority(a.type) ||
          a.name.localeCompare(b.name),
        )
        .filter((row: any, index: number, array: any[]) => array.findIndex((candidate) => candidate.id === row.id) === index)
        .slice(0, 3);
      const supplementalOwners = this.rankOwnerCandidates(
        (await this.getOwnerSymbolsForFiles(repo, filePaths))
          .filter((row: any) =>
            row.filePath &&
            this.isLikelyProductionFile(row.filePath) &&
            (this.isOwnerLikeSymbolKind(row.type) || row.type === 'File'),
          )
          .map((row: any) => ({
            id: row.id,
            name: row.name,
            type: row.type,
            filePath: row.filePath,
            fan_in: row.fanIn,
          })),
      );
      let topOwners = [...directSubsystemOwners, ...supplementalOwners]
        .filter((row, index, array) => array.findIndex((candidate) => candidate.id === row.id) === index)
        .slice(0, 3);
      const structuralHotAnchors = hotAnchors.filter((row: any) => this.isOwnerLikeSymbolKind(row.type) || row.type === 'File');
      if (topOwners.length === 0 && hotAnchors.length > 0) {
        topOwners = (structuralHotAnchors.length > 0 ? structuralHotAnchors : hotAnchors).slice(0, 3);
      } else if (
        topOwners.length > 0 &&
        topOwners.every((row: any) => row.type === 'File') &&
        structuralHotAnchors.some((row: any) => row.type !== 'File')
      ) {
        topOwners = structuralHotAnchors.slice(0, 3);
      }
      const productionFiles = filePaths.filter((filePath: string) => this.isLikelyProductionFile(filePath)).length;
      const testFiles = filePaths.filter((filePath: string) => isTestFilePath(filePath)).length;
      const pressure = pressureRows[0] || {};
      const displayLabel = this.deriveSubsystemLabel(label, filePaths, topOwners, hotAnchors);

      return {
        name: displayLabel,
        source_label: label,
        symbol_count: cluster.symbolCount,
        cohesion: cluster.cohesion,
        top_owners: topOwners,
        production_files: productionFiles,
        test_files: testFiles,
        fan_in_pressure: pressure.fanIn || pressure[0] || 0,
        fan_out_pressure: pressure.fanOut || pressure[1] || 0,
        hot_anchors: hotAnchors,
        hot_processes: processRows.map((row: any) => ({
          name: row.label || row[0],
          hits: row.hits || row[1] || 0,
        })),
      };
    }));

    return subsystems.sort((a, b) =>
      b.symbol_count - a.symbol_count ||
      b.fan_in_pressure - a.fan_in_pressure ||
      a.name.localeCompare(b.name),
    );
  }

  private async overview(
    repo: RepoHandle,
    params: { showClusters?: boolean; showProcesses?: boolean; showSubsystems?: boolean; showSubsystemDetails?: boolean; limit?: number },
  ): Promise<any> {
    await this.ensureInitialized(repo.id);
    await this.refreshRepoHandle(repo.repoPath);
    const activeRepo = (this.repo && this.repo.id === repo.id ? this.repo : repo) || repo;
    
    const requestedLimit = params.limit;
    const limit = params.limit || 20;
    const result: any = {
      repo: activeRepo.name,
      repoPath: activeRepo.repoPath,
      stats: activeRepo.stats,
      indexedAt: activeRepo.indexedAt,
      lastCommit: activeRepo.lastCommit,
      coverage: {
        confidence: 'grounded',
        sections: {} as Record<string, 'grounded' | 'partial'>,
        notes: [] as string[],
      },
    };
    result.freshness = await this.getRepoFreshnessSummary(activeRepo.repoPath);
    if (result.freshness?.indexed_at) {
      result.indexedAt = result.freshness.indexed_at;
    }
    if (result.freshness?.indexed_commit) {
      result.lastCommit = result.freshness.indexed_commit;
    }

    try {
      const fileRows = await executeQuery(repo.id, `
        MATCH (f:File)
        RETURN f.filePath AS filePath
      `);
      const filePaths = fileRows.map((row: any) => row.filePath || row[0]).filter(Boolean);
      const testFiles = filePaths.filter((filePath: string) => isTestFilePath(filePath));
      result.production_vs_test = {
        production_files: filePaths.length - testFiles.length,
        test_files: testFiles.length,
      };
      result.coverage.sections.production_vs_test = 'grounded';
    } catch (error: any) {
      result.production_vs_test = null;
      result.coverage.sections.production_vs_test = 'partial';
      result.coverage.notes.push(`production_vs_test unavailable: ${error?.message || 'query failed'}`);
    }

    try {
      const centralRows = await executeQuery(repo.id, `
        MATCH (src)-[r:CodeRelation]->(n)
        WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
        RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, COUNT(*) AS fanIn
        ORDER BY fanIn DESC
        LIMIT ${Math.max(limit * 3, 30)}
      `);
      result.top_symbols = centralRows
        .map((row: any) => {
          const type = this.getNodeKind({ id: row.id || row[0], type: row.type || row[2] });
          return {
            id: row.id || row[0],
            name: row.name || row[1],
            type,
            filePath: row.filePath || row[3],
            fan_in: row.fanIn || row[4] || 0,
            priority:
              (row.fanIn || row[4] || 0) +
              (type === 'Class' ? 4 : 0) +
              (type === 'Method' ? 2 : 0) -
              (this.isLowSignalSummarySymbol(row.name || row[1]) ? 5 : 0),
          };
        })
        .filter((row: any) => row.filePath && this.isLikelyProductionFile(row.filePath))
        .sort((a: any, b: any) => b.priority - a.priority || b.fan_in - a.fan_in)
        .map(({ priority: _priority, ...row }: any) => row)
        .slice(0, limit);
      result.coverage.sections.top_symbols = 'grounded';
    } catch (error: any) {
      result.top_symbols = null;
      result.coverage.sections.top_symbols = 'partial';
      result.coverage.notes.push(`top_symbols unavailable: ${error?.message || 'query failed'}`);
    }
    
    if (params.showClusters !== false) {
      try {
        // Fetch more raw communities than the display limit so aggregation has enough data
        const rawLimit = Math.max(limit * 5, 200);
        const clusters = await executeQuery(repo.id, `
          MATCH (c:Community)
          RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
          ORDER BY c.symbolCount DESC
          LIMIT ${rawLimit}
        `);
        const rawClusters = clusters.map((c: any) => ({
          id: c.id || c[0],
          label: c.label || c[1],
          heuristicLabel: c.heuristicLabel || c[2],
          cohesion: c.cohesion || c[3],
          symbolCount: c.symbolCount || c[4],
        }));
        result.clusters = this.aggregateClusters(rawClusters).slice(0, limit);
        result.coverage.sections.clusters = 'grounded';
      } catch (error: any) {
        result.clusters = null;
        result.coverage.sections.clusters = 'partial';
        result.coverage.notes.push(`clusters unavailable: ${error?.message || 'query failed'}`);
      }
    }
    
    if (params.showProcesses !== false) {
      try {
        const processes = await executeQuery(repo.id, `
          MATCH (p:Process)
          RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
          ORDER BY p.stepCount DESC
          LIMIT ${limit}
        `);
        result.processes = processes.map((p: any) => ({
          id: p.id || p[0],
          label: p.label || p[1],
          heuristicLabel: p.heuristicLabel || p[2],
          processType: p.processType || p[3],
          stepCount: p.stepCount || p[4],
        }));
        result.coverage.sections.processes = 'grounded';
      } catch (error: any) {
        result.processes = null;
        result.coverage.sections.processes = 'partial';
        result.coverage.notes.push(`processes unavailable: ${error?.message || 'query failed'}`);
      }
    }

    if (params.showSubsystems === true) {
      try {
        result.subsystems = await this.getSubsystemSummary(activeRepo, limit);
        result.coverage.sections.subsystems = 'grounded';
      } catch (error: any) {
        result.subsystems = null;
        result.coverage.sections.subsystems = 'partial';
        result.coverage.notes.push(`subsystems unavailable: ${error?.message || 'query failed'}`);
      }
    }

    if (result.coverage.notes.length > 0) {
      result.coverage.confidence = 'partial';
    }

    if (params.showSubsystems === true && params.showSubsystemDetails !== true) {
      const conciseLimit = Number.isInteger(requestedLimit)
        ? Math.min(limit, 8)
        : 5;
      return this.buildConciseSubsystemSummary(activeRepo, result, conciseLimit);
    }

    return result;
  }

  private classifyRiskBand(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 3) return 'critical';
    if (score >= 2) return 'high';
    if (score >= 1) return 'medium';
    return 'low';
  }

  private classifyOverloadSignal(lineCount: number | null, functionCount: number, hotspotShare: number): 'low' | 'medium' | 'high' | 'critical' {
    if ((lineCount ?? 0) >= 2000 || functionCount >= 50 || hotspotShare >= 0.45) {
      return 'critical';
    }
    if ((lineCount ?? 0) >= 1400 || functionCount >= 35 || hotspotShare >= 0.3) {
      return 'high';
    }
    if ((lineCount ?? 0) >= 700 || functionCount >= 18 || hotspotShare >= 0.18) {
      return 'medium';
    }
    return 'low';
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
    if (!filePath) {
      return {
        file: {
          line_count: null,
          function_count: 0,
          largest_members: [],
          average_lines_per_function: null,
          hotspot_share: null,
          concentration: 'low',
          grounded_extraction_seams: [],
        },
      };
    }

    const freshness = await this.getRepoFreshnessSummary(repo.repoPath).catch(() => null);
    const canUseLiveFile = freshness?.state === 'serving_current' || freshness?.state === 'indexed_current';

    const memberRows = await executeParameterized(repo.id, `
      MATCH (n)
      WHERE n.filePath = $filePath
        AND n.startLine IS NOT NULL
        AND n.endLine IS NOT NULL
      RETURN n.id AS id, n.name AS name, labels(n)[0] AS kind, n.startLine AS startLine, n.endLine AS endLine
      ORDER BY n.startLine ASC
    `, { filePath }).catch(() => []);

    const members = memberRows
      .map((row: any) => ({
        id: row.id || row[0],
        name: row.name || row[1],
        kind: this.getNodeKind({ id: row.id || row[0], type: row.kind || row[2] }),
        startLine: row.startLine || row[3] || 0,
        endLine: row.endLine || row[4] || 0,
      }))
      .filter((row: any) => row.startLine > 0 && row.endLine >= row.startLine);
    const indexedLineCount = members.reduce((max: number, row: any) => Math.max(max, row.endLine), 0) || null;

    let lineCount: number | null = indexedLineCount;
    if (canUseLiveFile) {
      try {
        const content = await fs.readFile(path.resolve(repo.repoPath, filePath), 'utf-8');
        lineCount = content.split(/\r?\n/).length;
      } catch {
        lineCount = indexedLineCount;
      }
    }

    const structuredMembers = members
      .filter((row: any) => ['Function', 'Method', 'Constructor', 'Property'].includes(row.kind))
    const functionMembers = structuredMembers.filter((row: any) => ['Function', 'Method', 'Constructor'].includes(row.kind));
    const largestMembers = [...functionMembers]
      .sort((a: any, b: any) => (b.endLine - b.startLine) - (a.endLine - a.startLine) || a.startLine - b.startLine)
      .slice(0, 5)
      .map((row: any) => ({
        ...row,
        line_count: row.endLine - row.startLine + 1,
      }));
    const hotspotLines = largestMembers.reduce((total: number, row: any) => total + row.line_count, 0);
    const hotspotShare = lineCount && lineCount > 0 ? Number((hotspotLines / lineCount).toFixed(3)) : null;
    const averageLinesPerFunction = lineCount && functionMembers.length > 0
      ? Number((lineCount / functionMembers.length).toFixed(1))
      : null;

    const seamRows = await executeParameterized(repo.id, `
      MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
      WHERE n.filePath = $filePath
        AND n.startLine IS NOT NULL
        AND n.endLine IS NOT NULL
      RETURN c.heuristicLabel AS name, n.id AS id, labels(n)[0] AS kind, n.startLine AS startLine, n.endLine AS endLine
      ORDER BY n.startLine ASC
    `, { filePath }).catch(() => []);
    const seamGroups = new Map<string, { symbol_count: number; startLine: number; endLine: number }>();
    for (const row of seamRows) {
      const kind = this.getNodeKind({ id: row.id || row[1], type: row.kind || row[2] });
      if (!['Function', 'Method', 'Constructor', 'Property'].includes(kind)) {
        continue;
      }
      const rawName = this.humanizeSummaryLabel(row.name || row[0] || '');
      if (!rawName) {
        continue;
      }
      const startLine = row.startLine || row[3] || 0;
      const endLine = row.endLine || row[4] || 0;
      const existing = seamGroups.get(rawName);
      if (!existing) {
        seamGroups.set(rawName, { symbol_count: 1, startLine, endLine });
        continue;
      }
      existing.symbol_count += 1;
      existing.startLine = Math.min(existing.startLine, startLine);
      existing.endLine = Math.max(existing.endLine, endLine);
    }
    const groundedExtractionSeams = [...seamGroups.entries()]
      .map(([name, seam]) => ({
        name,
        symbol_count: seam.symbol_count,
        startLine: seam.startLine,
        endLine: seam.endLine,
      }))
      .filter((row: any) => row.symbol_count >= 2 && row.name && !this.isLowSignalSubsystemLabel(row.name));

    return {
      file: {
        line_count: lineCount,
        function_count: functionMembers.length,
        largest_members: largestMembers,
        average_lines_per_function: averageLinesPerFunction,
        hotspot_share: hotspotShare,
        concentration: this.classifyOverloadSignal(lineCount, functionMembers.length, hotspotShare || 0),
        grounded_extraction_seams: groundedExtractionSeams,
      },
    };
  }

  /**
   * Context tool — 360-degree symbol view with categorized refs.
   * Disambiguation when multiple symbols share a name.
   * UID-based direct lookup. No cluster in output.
   */
  private async context(repo: RepoHandle, params: {
    name?: string;
    uid?: string;
    file_path?: string;
    include_content?: boolean;
  }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    const { name, uid, file_path, include_content } = params;
    
    if (!name && !uid) {
      return { error: 'Either "name" or "uid" parameter is required.' };
    }
    
    // Step 1: Find the symbol
    let symbols: any[];
    
    if (uid) {
      symbols = await executeParameterized(repo.id, `
        MATCH (n {id: $uid})
        RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea, n.description AS description${include_content ? ', n.content AS content' : ''}
        LIMIT 1
      `, { uid });
    } else {
      symbols = await this.lookupNamedSymbols(repo, {
        name: name!,
        file_path,
        include_content,
      });
    }
    
    if (symbols.length === 0) {
      return { error: `Symbol '${name || uid}' not found` };
    }
    
    // Step 2: Disambiguation
    if (symbols.length > 1 && !uid) {
      const primaryModules = await this.getPrimaryModuleSymbols(repo, [...new Set(symbols.map((s: any) => s.filePath || s[3]).filter(Boolean))]);
      const rojoProject = await this.getRojoProjectIndex(repo);
      return {
        status: 'ambiguous',
        message: `Found ${symbols.length} symbols matching '${name}'. Use uid or file_path to disambiguate.`,
        candidates: symbols.map((s: any) => ({
          uid: s.id || s[0],
          name: s.name || s[1],
          kind: s.type || s[2],
          filePath: s.filePath || s[3],
          line: s.startLine || s[4],
          ...(s.runtimeArea || s[6] ? { runtimeArea: s.runtimeArea || s[6] } : {}),
          ...(primaryModules.get(s.filePath || s[3]) ? { module_symbol: primaryModules.get(s.filePath || s[3]) } : {}),
          ...(rojoProject?.getTargetsForFile(s.filePath || s[3])?.[0]?.dataModelPath ? { data_model_path: rojoProject.getTargetsForFile(s.filePath || s[3])[0].dataModelPath } : {}),
        })),
      };
    }
    
    // Step 3: Build full context
    const sym = symbols[0];
    const symId = sym.id || sym[0];
    const filePath = sym.filePath || sym[3];
    const [primaryModules, rojoProject, boundaryImports] = await Promise.all([
      this.getPrimaryModuleSymbols(repo, filePath ? [filePath] : []),
      this.getRojoProjectIndex(repo),
      this.getBoundaryImports(repo, filePath ? [filePath] : []),
    ]);
    const dataModelPath = rojoProject?.getTargetsForFile(filePath)?.[0]?.dataModelPath;
    const symbolKind = this.getNodeKind({ id: symId, type: sym.type || sym[2] });
    const moduleSymbol = symbolKind === 'Module' ? (sym.name || sym[1]) : primaryModules.get(filePath);
    const symbolDescription = sym.description || sym[7];

    const { rows: memberRows, inferred: inferredMembers, source: memberSource } = await this.getContainedMembers(repo, {
      id: symId,
      kind: symbolKind,
      filePath,
      startLine: sym.startLine || sym[4],
      endLine: sym.endLine || sym[5],
      description: symbolDescription,
    });
    const memberIds = [...new Set(memberRows.map((row: any) => row.uid || row[0]).filter(Boolean))];
    const hasBackingContainerMembers = memberRows.some((row: any) => (row.role || row[7]) === 'backing_container_member');

    // Categorized incoming refs
    const incomingRows = await executeParameterized(repo.id, `
      MATCH (caller)-[r:CodeRelation]->(n {id: $symId})
      WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
      RETURN r.type AS relType, caller.id AS uid, caller.name AS name, caller.filePath AS filePath, labels(caller)[0] AS kind
      LIMIT 30
    `, { symId });

    // Categorized outgoing refs
    const outgoingRows = await executeParameterized(repo.id, `
      MATCH (n {id: $symId})-[r:CodeRelation]->(target)
      WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
      RETURN r.type AS relType, target.id AS uid, target.name AS name, target.filePath AS filePath, labels(target)[0] AS kind
      LIMIT 30
    `, { symId });

    // Process participation
    let processRows: any[] = [];
    try {
      processRows = await executeParameterized(repo.id, `
        MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
        RETURN p.id AS pid, p.heuristicLabel AS label, r.step AS step, p.stepCount AS stepCount
      `, { symId });
    } catch (e) { logQueryError('context:process-participation', e); }

    let incomingViaMembersRows: any[] = [];
    let outgoingViaMembersRows: any[] = [];
    if (memberIds.length > 0) {
      const quotedMemberIds = memberIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(', ');
      try {
        incomingViaMembersRows = await executeQuery(repo.id, `
          MATCH (caller)-[r:CodeRelation]->(child)
          WHERE child.id IN [${quotedMemberIds}] AND r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
          RETURN r.type AS relType, caller.id AS uid, caller.name AS name, caller.filePath AS filePath,
                 labels(caller)[0] AS kind, child.name AS viaMember
          LIMIT 40
        `);
      } catch (e) { logQueryError('context:incoming-via-members', e); }
      try {
        outgoingViaMembersRows = await executeQuery(repo.id, `
          MATCH (child)-[r:CodeRelation]->(target)
          WHERE child.id IN [${quotedMemberIds}] AND r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
          RETURN r.type AS relType, target.id AS uid, target.name AS name, target.filePath AS filePath,
                 labels(target)[0] AS kind, child.name AS viaMember
          LIMIT 40
        `);
      } catch (e) { logQueryError('context:outgoing-via-members', e); }
      if (processRows.length === 0) {
        try {
          processRows = await executeQuery(repo.id, `
            MATCH (child)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
            WHERE child.id IN [${quotedMemberIds}]
            RETURN p.id AS pid, p.heuristicLabel AS label, r.step AS step, p.stepCount AS stepCount,
                   child.name AS viaMember
            LIMIT 30
          `);
        } catch (e) { logQueryError('context:processes-via-members', e); }
      }
    }
    
    // Helper to categorize refs
    const categorize = (rows: any[]) => {
      const cats: Record<string, any[]> = {};
      const seen = new Set<string>();
      for (const row of rows) {
        const relType = (row.relType || row[0] || '').toLowerCase();
        const kind = this.getNodeKind({ id: row.uid || row[1], type: row.kind || row[4] });
        const entry = {
          uid: row.uid || row[1],
          name: row.name || row[2],
          filePath: row.filePath || row[3],
          kind,
          ...(row.viaMember || row[5] ? { viaMember: row.viaMember || row[5] } : {}),
        };
        const dedupeKey = `${relType}:${entry.uid}:${entry.viaMember || ''}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        if (!cats[relType]) cats[relType] = [];
        cats[relType].push(entry);
      }
      return cats;
    };

    const directRelationshipCount = incomingRows.length + outgoingRows.length + processRows.length;
    const memberRelationshipCount = incomingViaMembersRows.length + outgoingViaMembersRows.length;
    const partialCoverage =
      directRelationshipCount === 0 &&
      (memberRelationshipCount > 0 || memberRows.length > 0 || ['Class', 'Module', 'File'].includes(symbolKind));
    const confidence = memberSource === 'range' || memberSource === 'file_defines'
      ? 'partial'
      : partialCoverage
        ? 'partial'
        : memberRelationshipCount > 0
          ? 'expanded'
          : 'grounded';
    const coverageNote = memberSource === 'range'
      ? 'Direct container edges were not available for this symbol, so related members were inferred from same-file source ranges and filtered down to immediate container members. Results are materially better than raw symbol-only coverage, but graph coverage may still be incomplete.'
      : memberSource === 'file_defines'
        ? 'Direct container edges were not available for this symbol, so related members were recovered from grounded file-level definitions in the same source file. Results are materially better, but container ownership is still partial.'
        : symbolKind === 'Module' && typeof symbolDescription === 'string' && symbolDescription.startsWith('luau-module:weak') && memberRows.length > 0
          ? hasBackingContainerMembers
            ? 'This Luau module is a weak returned-table wrapper. CodeNexus is showing both the grounded exported wrapper members and the grounded backing-container methods that the wrapper explicitly delegates into. Backing-container members are structural context, not exported module members.'
            : 'This Luau module is a weak returned-table wrapper. CodeNexus is showing the grounded members referenced directly from the returned table, including delegate methods and explicit exported fields. Internal same-file tables and methods are intentionally not treated as exported module members unless the wrapper points to them explicitly.'
          : partialCoverage
            ? 'Direct relationships on this container symbol are sparse. Member-based relationships are shown where available, but graph coverage may still be incomplete.'
            : memberRelationshipCount > 0
              ? 'Includes additional relationships gathered through contained members.'
              : 'Relationships are grounded in direct graph edges for this symbol.';
    
    return {
      status: 'found',
      symbol: {
        uid: sym.id || sym[0],
        name: sym.name || sym[1],
        kind: symbolKind,
        filePath,
        startLine: sym.startLine || sym[4],
        endLine: sym.endLine || sym[5],
        ...(sym.runtimeArea || sym[6] ? { runtimeArea: sym.runtimeArea || sym[6] } : {}),
        ...(moduleSymbol ? { module_symbol: moduleSymbol } : {}),
        ...(typeof symbolDescription === 'string' && symbolDescription ? { description: symbolDescription } : {}),
        ...(dataModelPath ? { data_model_path: dataModelPath } : {}),
        ...(boundaryImports.get(filePath)?.length ? { boundary_imports: boundaryImports.get(filePath) } : {}),
        ...(include_content && (sym.content || sym[8]) ? { content: sym.content || sym[8] } : {}),
      },
      incoming: categorize([...incomingRows, ...incomingViaMembersRows]),
      outgoing: categorize([...outgoingRows, ...outgoingViaMembersRows]),
      processes: processRows.map((r: any) => ({
        id: r.pid || r[0],
        name: r.label || r[1],
        step_index: r.step || r[2],
        step_count: r.stepCount || r[3],
        ...(r.viaMember || r[4] ? { via_member: r.viaMember || r[4] } : {}),
      })),
      members: memberRows.map((row: any) => ({
        uid: row.uid || row[0],
        name: row.name || row[1],
        kind: this.getNodeKind({ id: row.uid || row[0], type: row.kind || row[2] }),
        filePath: row.filePath || row[3],
        ...((row.role || row[7]) ? { role: row.role || row[7] } : {}),
        ...((row.backingContainer || row[6]) ? { backing_container: row.backingContainer || row[6] } : {}),
      })),
      coverage: {
        confidence,
        note: coverageNote,
      },
    };
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

  /**
   * Detect changes — git-diff based impact analysis.
   * Maps changed lines to indexed symbols, then finds affected processes.
   */
  private async detectChanges(repo: RepoHandle, params: {
    scope?: string;
    base_ref?: string;
  }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    const scope = params.scope || 'unstaged';
    const { execFileSync } = await import('child_process');

    // Build git diff args based on scope (using execFileSync to avoid shell injection)
    let diffArgs: string[];
    switch (scope) {
      case 'staged':
        diffArgs = ['diff', '--staged', '--name-only'];
        break;
      case 'all':
        diffArgs = ['diff', 'HEAD', '--name-only'];
        break;
      case 'compare':
        if (!params.base_ref) return { error: 'base_ref is required for "compare" scope' };
        diffArgs = ['diff', params.base_ref, '--name-only'];
        break;
      case 'unstaged':
      default:
        diffArgs = ['diff', '--name-only'];
        break;
    }

    let changedFiles: string[];
    try {
      const output = execFileSync('git', diffArgs, { cwd: repo.repoPath, encoding: 'utf-8' });
      changedFiles = output.trim().split('\n').filter(f => f.length > 0);
    } catch (err: any) {
      return { error: `Git diff failed: ${err.message}` };
    }
    
    if (changedFiles.length === 0) {
      return {
        summary: { changed_count: 0, affected_count: 0, risk_level: 'none', message: 'No changes detected.' },
        changed_symbols: [],
        affected_processes: [],
      };
    }
    
    // Map changed files to indexed symbols
    const changedSymbols: any[] = [];
    for (const file of changedFiles) {
      const normalizedFile = file.replace(/\\/g, '/');
      try {
        const symbols = await executeParameterized(repo.id, `
          MATCH (n) WHERE n.filePath CONTAINS $filePath
          RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
          LIMIT 20
        `, { filePath: normalizedFile });
        for (const sym of symbols) {
          changedSymbols.push({
            id: sym.id || sym[0],
            name: sym.name || sym[1],
            type: sym.type || sym[2],
            filePath: sym.filePath || sym[3],
            change_type: 'Modified',
          });
        }
      } catch (e) { logQueryError('detect-changes:file-symbols', e); }
    }

    // Find affected processes
    const affectedProcesses = new Map<string, any>();
    for (const sym of changedSymbols) {
      try {
        const procs = await executeParameterized(repo.id, `
          MATCH (n {id: $nodeId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
          RETURN p.id AS pid, p.heuristicLabel AS label, p.processType AS processType, p.stepCount AS stepCount, r.step AS step
        `, { nodeId: sym.id });
        for (const proc of procs) {
          const pid = proc.pid || proc[0];
          if (!affectedProcesses.has(pid)) {
            affectedProcesses.set(pid, {
              id: pid,
              name: proc.label || proc[1],
              process_type: proc.processType || proc[2],
              step_count: proc.stepCount || proc[3],
              changed_steps: [],
            });
          }
          affectedProcesses.get(pid)!.changed_steps.push({
            symbol: sym.name,
            step: proc.step || proc[4],
          });
        }
      } catch (e) { logQueryError('detect-changes:process-lookup', e); }
    }

    const processCount = affectedProcesses.size;
    const risk = processCount === 0 ? 'low' : processCount <= 5 ? 'medium' : processCount <= 15 ? 'high' : 'critical';
    
    return {
      summary: {
        changed_count: changedSymbols.length,
        affected_count: processCount,
        changed_files: changedFiles.length,
        risk_level: risk,
      },
      changed_symbols: changedSymbols,
      affected_processes: Array.from(affectedProcesses.values()),
    };
  }

  /**
   * Rename tool — multi-file coordinated rename using graph + text search.
   * Graph refs are tagged "graph" (high confidence).
   * Additional refs found via text search are tagged "text_search" (lower confidence).
   */
  private async rename(repo: RepoHandle, params: {
    symbol_name?: string;
    symbol_uid?: string;
    new_name: string;
    file_path?: string;
    dry_run?: boolean;
  }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    const { new_name, file_path } = params;
    const dry_run = params.dry_run ?? true;

    if (!params.symbol_name && !params.symbol_uid) {
      return { error: 'Either symbol_name or symbol_uid is required.' };
    }

    /** Guard: ensure a file path resolves within the repo root (prevents path traversal) */
    const assertSafePath = (filePath: string): string => {
      const full = path.resolve(repo.repoPath, filePath);
      if (!full.startsWith(repo.repoPath + path.sep) && full !== repo.repoPath) {
        throw new Error(`Path traversal blocked: ${filePath}`);
      }
      return full;
    };
    
    // Step 1: Find the target symbol (reuse context's lookup)
    const lookupResult = await this.context(repo, {
      name: params.symbol_name,
      uid: params.symbol_uid,
      file_path,
    });
    
    if (lookupResult.status === 'ambiguous') {
      return lookupResult; // pass disambiguation through
    }
    if (lookupResult.error) {
      return lookupResult;
    }
    
    const sym = lookupResult.symbol;
    const oldName = sym.name;
    
    if (oldName === new_name) {
      return { error: 'New name is the same as the current name.' };
    }
    
    // Step 2: Collect edits from graph (high confidence)
    const changes = new Map<string, { file_path: string; edits: any[] }>();
    
    const addEdit = (filePath: string, line: number, oldText: string, newText: string, confidence: string) => {
      if (!changes.has(filePath)) {
        changes.set(filePath, { file_path: filePath, edits: [] });
      }
      changes.get(filePath)!.edits.push({ line, old_text: oldText, new_text: newText, confidence });
    };
    
    // The definition itself
    if (sym.filePath && sym.startLine) {
      try {
        const content = await fs.readFile(assertSafePath(sym.filePath), 'utf-8');
        const lines = content.split('\n');
        const lineIdx = sym.startLine - 1;
        if (lineIdx >= 0 && lineIdx < lines.length && lines[lineIdx].includes(oldName)) {
          const defRegex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          addEdit(sym.filePath, sym.startLine, lines[lineIdx].trim(), lines[lineIdx].replace(defRegex, new_name).trim(), 'graph');
        }
      } catch (e) { logQueryError('rename:read-definition', e); }
    }

    // All incoming refs from graph (callers, importers, etc.)
    const allIncoming = [
      ...(lookupResult.incoming.calls || []),
      ...(lookupResult.incoming.imports || []),
      ...(lookupResult.incoming.extends || []),
      ...(lookupResult.incoming.implements || []),
    ];
    
    let graphEdits = changes.size > 0 ? 1 : 0; // count definition edit
    
    for (const ref of allIncoming) {
      if (!ref.filePath) continue;
      try {
        const content = await fs.readFile(assertSafePath(ref.filePath), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(oldName)) {
            addEdit(ref.filePath, i + 1, lines[i].trim(), lines[i].replace(new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), new_name).trim(), 'graph');
            graphEdits++;
            break; // one edit per file from graph refs
          }
        }
      } catch (e) { logQueryError('rename:read-ref', e); }
    }

    // Step 3: Text search for refs the graph might have missed
    let astSearchEdits = 0;
    const graphFiles = new Set([sym.filePath, ...allIncoming.map(r => r.filePath)].filter(Boolean));
    
    // Simple text search across the repo for the old name (in files not already covered by graph)
    try {
      const { execFileSync } = await import('child_process');
      const rgArgs = [
        '-l',
        '--type-add', 'code:*.{ts,tsx,js,jsx,py,go,rs,java,c,h,cpp,cc,cxx,hpp,hxx,hh,cs,php,swift}',
        '-t', 'code',
        `\\b${oldName}\\b`,
        '.',
      ];
      const output = execFileSync('rg', rgArgs, { cwd: repo.repoPath, encoding: 'utf-8', timeout: 5000 });
      const files = output.trim().split('\n').filter(f => f.length > 0);
      
      for (const file of files) {
        const normalizedFile = file.replace(/\\/g, '/').replace(/^\.\//, '');
        if (graphFiles.has(normalizedFile)) continue; // already covered by graph
        
        try {
          const content = await fs.readFile(assertSafePath(normalizedFile), 'utf-8');
          const lines = content.split('\n');
          const regex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              regex.lastIndex = 0;
              addEdit(normalizedFile, i + 1, lines[i].trim(), lines[i].replace(regex, new_name).trim(), 'text_search');
              astSearchEdits++;
            }
          }
        } catch (e) { logQueryError('rename:text-search-read', e); }
      }
    } catch (e) { logQueryError('rename:ripgrep', e); }
    
    // Step 4: Apply or preview
    const allChanges = Array.from(changes.values());
    const totalEdits = allChanges.reduce((sum, c) => sum + c.edits.length, 0);
    
    if (!dry_run) {
      // Apply edits to files
      for (const change of allChanges) {
        try {
          const fullPath = assertSafePath(change.file_path);
          let content = await fs.readFile(fullPath, 'utf-8');
          const regex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          content = content.replace(regex, new_name);
          await fs.writeFile(fullPath, content, 'utf-8');
        } catch (e) { logQueryError('rename:apply-edit', e); }
      }
    }
    
    return {
      status: 'success',
      old_name: oldName,
      new_name,
      files_affected: allChanges.length,
      total_edits: totalEdits,
      graph_edits: graphEdits,
      text_search_edits: astSearchEdits,
      changes: allChanges,
      applied: !dry_run,
    };
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
    await this.ensureInitialized(repo.id);
    
    const { target, direction, uid, file_path } = params;
    const maxDepth = params.maxDepth || 3;
    const rawRelTypes = params.relationTypes && params.relationTypes.length > 0
      ? params.relationTypes.filter(t => VALID_RELATION_TYPES.has(t))
      : ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
    const relationTypes = rawRelTypes.length > 0 ? rawRelTypes : ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
    const includeTests = params.includeTests ?? false;
    const minConfidence = params.minConfidence ?? 0;

    const relTypeFilter = relationTypes.map(t => `'${t}'`).join(', ');
    const confidenceFilter = minConfidence > 0 ? ` AND r.confidence >= ${minConfidence}` : '';

    if (!target && !uid) {
      return { error: 'Either "target" or "uid" parameter is required.' };
    }

    const lookupResult = await this.context(repo, {
      name: target,
      uid,
      file_path,
    });
    if (lookupResult.status === 'ambiguous') {
      return lookupResult;
    }
    if (lookupResult.error) {
      return lookupResult;
    }

    const sym = lookupResult.symbol;
    const symId = sym.uid || sym.id;
    const symType = this.getNodeKind({ id: symId, type: sym.kind || sym.type });
    const { rows: memberRows, inferred: inferredMembers, source: memberSource } = await this.getContainedMembers(repo, {
      id: symId,
      kind: symType,
      filePath: sym.filePath,
      startLine: sym.startLine,
      endLine: sym.endLine,
      description: sym.description,
    });
    const memberIds = [...new Set(memberRows.map((row: any) => row.id || row.uid || row[0]).filter(Boolean))];
    const traversalSourceIds = [symId, ...memberIds];
    
    const impacted: any[] = [];
    const visited = new Set<string>(traversalSourceIds);
    let frontier = traversalSourceIds;
    
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      
      // Batch frontier nodes into a single Cypher query per depth level
      const idList = frontier.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
      const query = direction === 'upstream'
        ? `MATCH (caller)-[r:CodeRelation]->(n) WHERE n.id IN [${idList}] AND r.type IN [${relTypeFilter}]${confidenceFilter} RETURN n.id AS sourceId, caller.id AS id, caller.name AS name, labels(caller)[0] AS type, caller.filePath AS filePath, r.type AS relType, r.confidence AS confidence`
        : `MATCH (n)-[r:CodeRelation]->(callee) WHERE n.id IN [${idList}] AND r.type IN [${relTypeFilter}]${confidenceFilter} RETURN n.id AS sourceId, callee.id AS id, callee.name AS name, labels(callee)[0] AS type, callee.filePath AS filePath, r.type AS relType, r.confidence AS confidence`;
      
      try {
        const related = await executeQuery(repo.id, query);
        
        for (const rel of related) {
          const relId = rel.id || rel[1];
          const filePath = rel.filePath || rel[4] || '';
          
          if (!includeTests && isTestFilePath(filePath)) continue;
          
          if (!visited.has(relId)) {
            visited.add(relId);
            nextFrontier.push(relId);
            impacted.push({
              depth,
              id: relId,
              name: rel.name || rel[2],
              type: this.getNodeKind({ id: relId, type: rel.type || rel[3] }),
              filePath,
              relationType: rel.relType || rel[5],
              confidence: rel.confidence || rel[6] || 1.0,
            });
          }
        }
      } catch (e) { logQueryError('impact:depth-traversal', e); }
      
      frontier = nextFrontier;
    }
    
    const grouped: Record<number, any[]> = {};
    for (const item of impacted) {
      if (!grouped[item.depth]) grouped[item.depth] = [];
      grouped[item.depth].push(item);
    }

    // ── Enrichment: affected processes, modules, risk ──────────────
    const directCount = (grouped[1] || []).length;
    let affectedProcesses: any[] = [];
    let affectedModules: any[] = [];
    let propagationSource: 'direct' | 'file_owner' | 'none' = 'none';

    if (impacted.length > 0) {
      const allIds = impacted.map(i => `'${i.id.replace(/'/g, "''")}'`).join(', ');
      const d1Ids = (grouped[1] || []).map((i: any) => `'${i.id.replace(/'/g, "''")}'`).join(', ');

      // Affected processes: which execution flows are broken and at which step
      const [processRows, moduleRows, directModuleRows] = await Promise.all([
        executeQuery(repo.id, `
          MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
          WHERE s.id IN [${allIds}]
          RETURN p.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits, MIN(r.step) AS minStep, p.stepCount AS stepCount
          ORDER BY hits DESC
          LIMIT 20
        `).catch(() => []),
        executeQuery(repo.id, `
          MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          WHERE s.id IN [${allIds}]
          RETURN c.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits
          ORDER BY hits DESC
          LIMIT 20
        `).catch(() => []),
        d1Ids ? executeQuery(repo.id, `
          MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          WHERE s.id IN [${d1Ids}]
          RETURN DISTINCT c.heuristicLabel AS name
        `).catch(() => []) : Promise.resolve([]),
      ]);

      affectedProcesses = processRows.map((r: any) => ({
        name: r.name || r[0],
        hits: r.hits || r[1],
        broken_at_step: r.minStep ?? r[2],
        step_count: r.stepCount ?? r[3],
      }));

      const directModuleSet = new Set(directModuleRows.map((r: any) => r.name || r[0]));
      affectedModules = moduleRows.map((r: any) => {
        const name = r.name || r[0];
        return {
          name,
          hits: r.hits || r[1],
          impact: directModuleSet.has(name) ? 'direct' : 'indirect',
        };
      });
      if (affectedProcesses.length > 0 || affectedModules.length > 0) {
        propagationSource = 'direct';
      }

    }

    const directFileImpacts = (grouped[1] || []).filter((item: any) => item.type === 'File' && item.filePath);
    const affectedAreas = await this.getDetailedAffectedAreas(
      repo,
      directFileImpacts.map((item: any) => item.filePath),
    );
    const shapeSignals = await this.getShapeSignals(repo, sym.filePath);
    const directFileImpactNames = [...new Set(directFileImpacts.map((item: any) => path.basename(item.filePath)))].slice(0, 4);
    if (propagationSource === 'none' && directFileImpacts.length > 0) {
      const ownerSymbols = await this.getOwnerSymbolsForFiles(repo, directFileImpacts.map((item: any) => item.filePath));
      if (ownerSymbols.length > 0) {
        const ownerIds = ownerSymbols.map((item: any) => `'${item.id.replace(/'/g, "''")}'`).join(', ');
        const [ownerProcessRows, ownerModuleRows] = await Promise.all([
          executeQuery(repo.id, `
            MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
            WHERE s.id IN [${ownerIds}]
            RETURN p.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits, MIN(r.step) AS minStep, p.stepCount AS stepCount
            ORDER BY hits DESC
            LIMIT 20
          `).catch(() => []),
          executeQuery(repo.id, `
            MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
            WHERE s.id IN [${ownerIds}]
            RETURN c.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits
            ORDER BY hits DESC
            LIMIT 20
          `).catch(() => []),
        ]);

        if (ownerProcessRows.length > 0 || ownerModuleRows.length > 0) {
          propagationSource = 'file_owner';
          affectedProcesses = ownerProcessRows.map((r: any) => ({
            name: r.name || r[0],
            hits: r.hits || r[1],
            broken_at_step: r.minStep ?? r[2],
            step_count: r.stepCount ?? r[3],
            source: 'file_owner',
          }));
          affectedModules = ownerModuleRows.map((r: any) => ({
            name: r.name || r[0],
            hits: r.hits || r[1],
            impact: 'via_file_owner',
          }));
        } else {
          propagationSource = 'file_owner';
          affectedModules = ownerSymbols.slice(0, 8).map((owner: any) => ({
            name: owner.name,
            filePath: owner.filePath,
            hits: owner.fanIn || 0,
            impact: 'via_file_owner',
            kind: owner.type,
          }));
        }
      }
    }

    if (
      propagationSource === 'file_owner' &&
      affectedModules.length > 0 &&
      affectedModules.every((item: any) => item.kind === 'File') &&
      affectedAreas.some((area) => area.top_owners.length > 0)
    ) {
      affectedModules = affectedAreas
        .flatMap((area) => area.top_owners.map((owner: any) => ({
          name: owner.name,
          filePath: owner.filePath,
          hits: owner.fanIn || owner.fan_in || 0,
          impact: 'via_area_owner',
          kind: owner.type,
          area: area.name,
        })))
        .filter((item, index, array) => array.findIndex((candidate) => candidate.name === item.name && candidate.filePath === item.filePath) === index)
        .slice(0, 8);
    }

    const processCount = affectedProcesses.length;
    const moduleCount = affectedModules.length;
    const incomingSignal = this.classifyCoverageSignal(
      directCount > 0 ? 1 : memberRows.length > 0 ? 0.5 : 0.15,
    );
    const outgoingSignal = this.classifyCoverageSignal(
      impacted.length >= directCount && directCount > 0 ? 0.8 : impacted.length > 0 ? 0.5 : 0.15,
    );
    const memberSignal = this.classifyCoverageSignal(
      memberRows.length === 0
        ? (['Class', 'Module', 'File'].includes(symType) ? 0.2 : 1)
        : memberSource === 'contains' || memberSource === 'defines'
          ? 1
          : memberSource === 'file_defines'
            ? 0.65
            : 0.5,
    );
    const propagationSignal = this.classifyCoverageSignal(
      affectedProcesses.length > 0 || affectedModules.length > 0
        ? propagationSource === 'direct' ? 1 : 0.65
        : affectedAreas.some((area) => area.top_owners.length > 0 || area.hot_anchors.length > 0)
          ? 0.6
          : affectedAreas.length > 0 ? 0.45 : 0.1,
    );
    const overallConfidence =
      memberSource === 'range' || memberSource === 'file_defines'
        ? 'partial'
        : propagationSignal === 'high' && memberSignal !== 'low'
          ? 'grounded'
          : memberRows.length > 0 && propagationSignal !== 'low'
            ? 'expanded'
            : memberRows.length > 0 || affectedAreas.length > 0
              ? 'partial'
              : 'grounded';

    const centralityScore = directCount >= 20 || impacted.length >= 35
      ? 3
      : directCount >= 8 || impacted.length >= 15
        ? 2
        : directCount >= 3 || impacted.length >= 5
          ? 1
          : 0;
    const couplingBreadthScore = moduleCount >= 6 || affectedAreas.length >= 5
      ? 3
      : moduleCount >= 3 || affectedAreas.length >= 3
        ? 2
        : moduleCount >= 1 || affectedAreas.length >= 1
          ? 1
          : 0;
    const lifecycleComplexityScore = processCount >= 12
      ? 3
      : processCount >= 5
        ? 2
        : processCount >= 1
          ? 1
          : 0;
    const boundaryAmbiguityScore = overallConfidence === 'grounded'
      ? 0
      : overallConfidence === 'expanded'
        ? 1
        : overallConfidence === 'partial'
          ? 2
          : 3;
    const internalConcentrationScore = ({
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    } as const)[shapeSignals.file.concentration];

    let risk = 'LOW';
    if ((inferredMembers || (impacted.length === 0 && ['Class', 'Module', 'File'].includes(symType))) && impacted.length === 0) {
      risk = 'UNKNOWN';
    } else if (centralityScore >= 3 && couplingBreadthScore >= 2) {
      risk = 'CRITICAL';
    } else if (
      centralityScore >= 2 ||
      (couplingBreadthScore >= 2 && lifecycleComplexityScore >= 2) ||
      internalConcentrationScore >= 3
    ) {
      risk = 'HIGH';
    } else if (
      centralityScore >= 1 ||
      couplingBreadthScore >= 1 ||
      lifecycleComplexityScore >= 1 ||
      internalConcentrationScore >= 2 ||
      boundaryAmbiguityScore >= 2
    ) {
      risk = 'MEDIUM';
    }

    return {
      target: {
        id: symId,
        name: sym.name,
        type: symType,
        filePath: sym.filePath,
        member_count: memberRows.length,
      },
      direction,
      impactedCount: impacted.length,
      risk,
      risk_dimensions: {
        centrality: this.classifyRiskBand(centralityScore),
        coupling_breadth: this.classifyRiskBand(couplingBreadthScore),
        internal_concentration: this.classifyRiskBand(internalConcentrationScore),
        lifecycle_complexity: this.classifyRiskBand(lifecycleComplexityScore),
        boundary_ambiguity: this.classifyRiskBand(boundaryAmbiguityScore),
      },
      shape: shapeSignals,
      coverage: {
        confidence: overallConfidence,
        note:
          propagationSource === 'file_owner'
            ? `Direct impact is landing on file-level callers (${directFileImpactNames.join(', ')}). Higher-level architectural context is being derived from grounded owners and hot anchors across affected areas (${affectedAreas.map((area) => area.name).join(', ')}), so subsystem context is stronger but still bounded by file-owner evidence rather than explicit process membership.`
            : memberSource === 'range'
            ? directCount > 0 && processCount === 0 && moduleCount === 0 && affectedAreas.length > 0
              ? `Direct container edges were not available for this symbol, so impact expansion used same-file source ranges filtered to immediate container members. Direct impact is landing in ${affectedAreas.map((area) => area.name).join(', ')}, but grounded process/module memberships are still missing there, so coverage remains partial.`
              : 'Direct container edges were not available for this symbol, so impact expansion used same-file source ranges filtered to immediate container members. Coverage is improved, but still partial.'
            : memberSource === 'file_defines'
              ? 'Direct container edges were not available for this symbol, so impact expansion used grounded file-level definitions to recover likely members. Coverage is improved, but still partial.'
            : impacted.length === 0 && (memberRows.length > 0 || ['Class', 'Module', 'File'].includes(symType))
              ? 'No affected symbols were found through direct graph traversal. For container-style symbols, impact coverage may still be incomplete even after expanding through contained members.'
              : directCount > 0 && processCount === 0 && moduleCount === 0 && directFileImpactNames.length > 0
                ? `Direct impact is currently landing on file-level callers (${directFileImpactNames.join(', ')}), and the strongest affected areas are ${affectedAreas.map((area) => area.name).join(', ')}. The graph still does not attach grounded process or module memberships to those direct callers, so structural blast radius remains partial.`
                : memberRows.length > 0
                  ? 'Impact includes relationships gathered through contained members for this symbol.'
                  : 'Impact is grounded in direct graph traversal for this symbol.',
        signals: {
          member_coverage: memberSignal,
          incoming_edges: incomingSignal,
          outgoing_edges: outgoingSignal,
          higher_level_propagation: propagationSignal,
        },
      },
      summary: {
        direct: directCount,
        processes_affected: processCount,
        modules_affected: moduleCount,
        overloaded_file_lines: shapeSignals.file.line_count,
        overloaded_file_functions: shapeSignals.file.function_count,
      },
      affected_processes: affectedProcesses,
      affected_modules: affectedModules,
      affected_areas: affectedAreas,
      byDepth: grouped,
    };
  }

  // ─── Direct Graph Queries (for resources.ts) ────────────────────

  /**
   * Query clusters (communities) directly from graph.
   * Used by getClustersResource — avoids legacy overview() dispatch.
   */
  async queryClusters(limit = 100): Promise<{ clusters: any[] }> {
    const repo = await this.resolveRepo();
    await this.ensureInitialized(repo.id);

    try {
      const rawLimit = Math.max(limit * 5, 200);
      const clusters = await executeQuery(repo.id, `
        MATCH (c:Community)
        RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
        ORDER BY c.symbolCount DESC
        LIMIT ${rawLimit}
      `);
      const rawClusters = clusters.map((c: any) => ({
        id: c.id || c[0],
        label: c.label || c[1],
        heuristicLabel: c.heuristicLabel || c[2],
        cohesion: c.cohesion || c[3],
        symbolCount: c.symbolCount || c[4],
      }));
      return { clusters: this.aggregateClusters(rawClusters).slice(0, limit) };
    } catch {
      return { clusters: [] };
    }
  }

  /**
   * Query processes directly from graph.
   * Used by getProcessesResource — avoids legacy overview() dispatch.
   */
  async queryProcesses(limit = 50): Promise<{ processes: any[] }> {
    const repo = await this.resolveRepo();
    await this.ensureInitialized(repo.id);

    try {
      const processes = await executeQuery(repo.id, `
        MATCH (p:Process)
        RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
        ORDER BY p.stepCount DESC
        LIMIT ${limit}
      `);
      return {
        processes: processes.map((p: any) => ({
          id: p.id || p[0],
          label: p.label || p[1],
          heuristicLabel: p.heuristicLabel || p[2],
          processType: p.processType || p[3],
          stepCount: p.stepCount || p[4],
        })),
      };
    } catch {
      return { processes: [] };
    }
  }

  /**
   * Query cluster detail (members) directly from graph.
   * Used by getClusterDetailResource.
   */
  async queryClusterDetail(name: string): Promise<any> {
    const repo = await this.resolveRepo();
    await this.ensureInitialized(repo.id);

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

  /**
   * Query process detail (steps) directly from graph.
   * Used by getProcessDetailResource.
   */
  async queryProcessDetail(name: string): Promise<any> {
    const repo = await this.resolveRepo();
    await this.ensureInitialized(repo.id);

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
