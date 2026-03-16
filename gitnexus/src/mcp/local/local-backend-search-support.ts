import path from 'path';
import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import { isTestFilePath } from './local-backend-common.js';
import type { RankedSearchResult, RepoHandle, RojoTargetSummary } from './local-backend-types.js';

export interface LocalBackendSearchHost {
  ensureInitialized(repoId: string): Promise<void>;
  getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  isOwnerLikeSymbolKind(resultType: string): boolean;
  isPrimaryOwnerKind(resultType: string): boolean;
  isLikelyProductionFile(filePath: string): boolean;
  isLikelyCodeFile(filePath: string): boolean;
  isPrimarySourceFile(filePath: string): boolean;
  isLowSignalSummarySymbol(name: string): boolean;
  getOwnerSymbolPriority(kind: string): number;
  rankOwnerCandidates<T extends { type: string; fanIn?: number; fan_in?: number; name: string; filePath?: string }>(owners: T[]): T[];
  rankRepresentativeSymbols<T extends { type: string; name: string; filePath?: string; fanIn?: number; fan_in?: number; startLine?: number }>(symbols: T[]): T[];
  rojoProjectCache: Map<string, Promise<any | null>>;
}

export class LocalBackendSearchSupport {
  constructor(private readonly host: LocalBackendSearchHost) {}

  async query(
    repo: RepoHandle,
    params: {
      query: string;
      task_context?: string;
      goal?: string;
      owners?: boolean;
      limit?: number;
      max_symbols?: number;
      include_content?: boolean;
    },
  ): Promise<any> {
    if (!params.query?.trim()) {
      return { error: 'query parameter is required and cannot be empty.' };
    }

    await this.host.ensureInitialized(repo.id);

    const processLimit = params.limit || 5;
    const maxSymbolsPerProcess = params.max_symbols || 10;
    const includeContent = params.include_content ?? false;
    const ownerMode = params.owners ?? false;
    const searchQuery = params.query.trim();

    const searchLimit = processLimit * maxSymbolsPerProcess;
    const bm25Results = await this.bm25Search(repo, searchQuery, searchLimit * 2);
    const rankedMatches = await this.rankSearchResults(repo, searchQuery, bm25Results, searchLimit, ownerMode);

    const processMap = new Map<string, { id: string; label: string; heuristicLabel: string; processType: string; stepCount: number; totalScore: number; cohesionBoost: number; symbols: any[] }>();
    const definitions: any[] = [];

    for (const sym of rankedMatches) {
      if (!sym.nodeId) {
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

      let processRows: any[] = [];
      try {
        processRows = await executeParameterized(repo.id, `
          MATCH (n {id: $nodeId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
          RETURN p.id AS pid, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount, r.step AS step
        `, { nodeId: sym.nodeId });
      } catch {
        processRows = [];
      }

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
      } catch {
        cohesion = 0;
      }

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
        } catch {
          content = undefined;
        }
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
        definitions.push(symbolEntry);
      } else {
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

    const rankedProcesses = Array.from(processMap.values())
      .map((p) => ({
        ...p,
        priority: p.totalScore + (p.cohesionBoost * 0.1),
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, processLimit);

    const processes = rankedProcesses.map((p) => ({
      id: p.id,
      summary: p.heuristicLabel || p.label,
      priority: Math.round(p.priority * 1000) / 1000,
      symbol_count: p.symbols.length,
      process_type: p.processType,
      step_count: p.stepCount,
    }));

    const processSymbols = rankedProcesses.flatMap((p) =>
      p.symbols.slice(0, maxSymbolsPerProcess),
    );

    const seen = new Set<string>();
    const dedupedSymbols = processSymbols.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    return {
      ...(ownerMode ? { mode: 'owners' } : {}),
      processes,
      process_symbols: dedupedSymbols,
      definitions: definitions.slice(0, 20),
    };
  }

  normalizeSearchText(value: string): string {
    return value
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_./-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  getSplitWordAlias(value: string): string {
    return this.normalizeSearchText(
      value
        .replace(/\.(client|server)$/i, '')
        .replace(/\.(lua|luau)$/i, ''),
    );
  }

  getCompactSearchText(value: string): string {
    return this.normalizeSearchText(value).replace(/\s+/g, '');
  }

  getSafeShorthandAliases(value: string): string[] {
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

  getSymbolResolutionAliases(name: string, filePath?: string): string[] {
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

  async fetchSymbolsByIds(repo: RepoHandle, ids: string[], includeContent = false): Promise<any[]> {
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
             n.description AS description${includeContent ? ', n.content AS content' : ''}
    `).catch(() => []);
    const byId = new Map(rows.map((row: any) => [row.id || row[0], row]));
    return uniqueIds
      .map((id) => byId.get(id))
      .filter(Boolean);
  }

  async lookupNamedSymbols(
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
    const ownerSymbols = await this.host.getOwnerSymbolsForFiles(repo, filePaths);
    const selectedIds = filePaths.map((resolvedFilePath) => {
      const rowCandidates = aliasMatches
        .filter((row: any) => (row.filePath || row[3]) === resolvedFilePath)
        .map((row: any) => ({
          id: row.id || row[0],
          name: row.name || row[1],
          type: this.host.getNodeKind({ id: row.id || row[0], type: row.type || row[2] }),
          filePath: row.filePath || row[3],
          fanIn: 0,
        }));
      const ownerCandidates = ownerSymbols.filter((row: any) => row.filePath === resolvedFilePath);
      const rankedCandidates = this.host.rankOwnerCandidates(
        [...rowCandidates, ...ownerCandidates]
          .filter((row: any, index: number, array: any[]) => array.findIndex((candidate: any) => candidate.id === row.id) === index)
          .filter((row: any) => this.host.isOwnerLikeSymbolKind(row.type) || row.type === 'File'),
      );
      return (rankedCandidates[0] || rowCandidates[0])?.id;
    }).filter(Boolean);

    return this.fetchSymbolsByIds(repo, selectedIds, include_content);
  }

  isBroadSearchQuery(searchQuery: string): boolean {
    const trimmed = searchQuery.trim();
    if (!trimmed) return false;
    if (/[\\/]/.test(trimmed)) return false;
    if (/\.(lua|luau)$/i.test(trimmed)) return false;
    return this.normalizeSearchText(trimmed).includes(' ');
  }

  isSubsystemDiscoveryQuery(searchQuery: string): boolean {
    const normalized = this.normalizeSearchText(searchQuery);
    if (!this.isBroadSearchQuery(searchQuery)) {
      return false;
    }

    return /\b(runtime|lifecycle|bridge|protocol|http|plugin|shell|projection|studio|server|client|world|subsystem|transport|router|executor|manager|orchestrator)\b/.test(normalized);
  }

  isTestFocusedQuery(searchQuery: string): boolean {
    const normalized = this.normalizeSearchText(searchQuery);
    if (!/\b(test|tests|testing|spec|smoke|playtest|harness|fixture|fixtures|matrix)\b/.test(normalized)) {
      return false;
    }
    return !/\b(runtime|lifecycle|bridge|protocol|http|plugin|shell|projection|studio|server|client|world|subsystem)\b/.test(normalized);
  }

  getBroadOwnerShapePenalty(
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

  getBroadQueryActionPenalty(resultType: string, name: string, searchQuery: string, ownersMode = false): number {
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

  computeBroadSearchPenalties(
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
    const productionBoost = this.host.isLikelyProductionFile(filePath)
      ? (ownersMode ? 6 : subsystemDiscovery ? 4.5 : 3)
      : 0;
    const testPenalty = isTestFilePath(filePath)
      ? (testFocusedQuery ? 2.5 : ownersMode ? 16 : subsystemDiscovery ? 12 : 8)
      : 0;
    const secondaryPenalty = !this.host.isLikelyProductionFile(filePath) && !isTestFilePath(filePath)
      ? (ownersMode ? 5 : subsystemDiscovery ? 4 : 2.5)
      : 0;
    const nonCodePenalty = subsystemDiscovery && !this.host.isLikelyCodeFile(filePath)
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

  async getBroadQueryFileSignals(
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

  computeBroadQuerySignalBoost(
    searchQuery: string,
    resultType: string,
    fileSignal: { communityCount: number; processCount: number } | undefined,
    ownersMode = false,
  ): number {
    if ((!ownersMode && !this.isSubsystemDiscoveryQuery(searchQuery)) || !fileSignal) {
      return 0;
    }

    const anchorMultiplier = this.host.isOwnerLikeSymbolKind(resultType)
      ? 1.2
      : ownersMode
        ? 0.15
        : 0.5;
    return (
      Math.min(fileSignal.communityCount, 2) * 1.1 +
      Math.min(fileSignal.processCount, 2) * 0.9
    ) * anchorMultiplier;
  }

  getBroadQueryWeightedTerms(searchQuery: string, ownersMode = false): Array<{ term: string; weight: number }> {
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

  computeBroadQueryTermScore(
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
    const anchorMultiplier = this.host.isOwnerLikeSymbolKind(result.type)
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

  isRojoMappedResult(rojoProject: any | null, filePath?: string): boolean {
    if (!rojoProject || !filePath) return false;
    return (rojoProject.getTargetsForFile(filePath) || []).length > 0;
  }

  async getRojoProjectIndex(repo: RepoHandle): Promise<any | null> {
    let cached = this.host.rojoProjectCache.get(repo.id);
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
      this.host.rojoProjectCache.set(repo.id, cached);
    }
    return cached;
  }

  async getPrimaryModuleSymbols(repo: RepoHandle, filePaths: string[]): Promise<Map<string, string>> {
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

  async getBoundaryImports(repo: RepoHandle, filePaths: string[]): Promise<Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>> {
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

  async getExactAliasCandidates(repo: RepoHandle, searchQuery: string): Promise<any[]> {
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

  async getBroadAnchorCandidates(repo: RepoHandle, searchQuery: string, rawResults: any[], ownersMode = false): Promise<any[]> {
    if (!ownersMode && !this.isSubsystemDiscoveryQuery(searchQuery)) {
      return [];
    }

    const candidateFilePathSet = new Set(
      rawResults
        .map((row: any) => row.filePath)
        .filter((filePath: string | undefined) => typeof filePath === 'string' && this.host.isLikelyProductionFile(filePath)),
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
          if (typeof filePath === 'string' && this.host.isLikelyProductionFile(filePath)) {
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

  computeSearchBoost(
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

  async rankSearchResults(repo: RepoHandle, searchQuery: string, rawResults: any[], limit: number, ownersMode = false): Promise<RankedSearchResult[]> {
    const exactAliasCandidates = await this.getExactAliasCandidates(repo, searchQuery);
    const broadAnchorCandidates = await this.getBroadAnchorCandidates(repo, searchQuery, rawResults, ownersMode);
    const dedupedRaw = [...rawResults, ...exactAliasCandidates, ...broadAnchorCandidates].filter((result, index, array) => {
      const key = result.nodeId || `${result.type}:${result.filePath}:${result.name}:${result.startLine || ''}`;
      return array.findIndex((candidate) => {
        const candidateKey = candidate.nodeId || `${candidate.type}:${candidate.filePath}:${candidate.name}:${candidate.startLine || ''}`;
        return candidateKey === key;
      }) === index;
    });
    const filePaths = [...new Set(dedupedRaw.map((r) => r.filePath).filter(Boolean))];
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
        .filter((result: any) => this.host.isOwnerLikeSymbolKind(this.host.getNodeKind(result)))
        .map((result: any) => result.filePath)
        .filter(Boolean),
    );

    const ranked = dedupedRaw.map((result: any) => {
      const resultType = this.host.getNodeKind(result);
      const rojoTarget = rojoProject?.getTargetsForFile(result.filePath)?.[0] as RojoTargetSummary | undefined;
      const moduleSymbol = resultType === 'Module' ? result.name : primaryModules.get(result.filePath);
      const rojoMappingBoost = preferMappedResults
        ? (rojoTarget ? 5 : -5)
        : 0;
      const { productionBoost, anchorBoost, testPenalty, secondaryPenalty, nonCodePenalty } = this.computeBroadSearchPenalties(searchQuery, result.filePath, ownersMode);
      const primarySourceBoost = subsystemDiscovery && this.host.isPrimarySourceFile(result.filePath) ? 2.5 : 0;
      const anchorTypeBoost = subsystemDiscovery
        ? (resultType === 'File' || resultType === 'Module'
          ? anchorBoost + (ownersMode ? 3.5 : 2)
          : resultType === 'Class'
            ? anchorBoost + (ownersMode ? 1.25 : 1.5)
          : this.host.isOwnerLikeSymbolKind(resultType)
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
        !this.host.isOwnerLikeSymbolKind(resultType)
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

  async bm25Search(repo: RepoHandle, query: string, limit: number): Promise<any[]> {
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
}
