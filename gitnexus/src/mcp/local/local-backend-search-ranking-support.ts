import path from 'path';
import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import type { RankedSearchResult, RepoHandle, RojoTargetSummary } from './local-backend-types.js';
import type {
  BroadQueryFileSignal,
  LocalBackendSearchHost,
  SearchEnrichmentBundle,
  SearchSeedResult,
} from './local-backend-search-types.js';
import { LocalBackendSearchEnrichmentSupport } from './local-backend-search-enrichment-support.js';
import { LocalBackendSearchLookupSupport } from './local-backend-search-lookup-support.js';
import { isTestFilePath } from './local-backend-common.js';

export class LocalBackendSearchRankingSupport {
  constructor(
    private readonly host: LocalBackendSearchHost,
    private readonly lookup: LocalBackendSearchLookupSupport,
    private readonly enrichment: LocalBackendSearchEnrichmentSupport,
  ) {}

  isBroadSearchQuery(searchQuery: string): boolean {
    const trimmed = searchQuery.trim();
    if (!trimmed) return false;
    if (/[\\/]/.test(trimmed)) return false;
    if (/\.(lua|luau)$/i.test(trimmed)) return false;
    return this.lookup.normalizeSearchText(trimmed).includes(' ');
  }

  isSubsystemDiscoveryQuery(searchQuery: string): boolean {
    const normalized = this.lookup.normalizeSearchText(searchQuery);
    if (!this.isBroadSearchQuery(searchQuery)) {
      return false;
    }

    return /\b(runtime|lifecycle|bridge|protocol|http|plugin|shell|projection|studio|server|client|world|subsystem|transport|router|executor|manager|orchestrator)\b/.test(normalized);
  }

  isTestFocusedQuery(searchQuery: string): boolean {
    const normalized = this.lookup.normalizeSearchText(searchQuery);
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

  computeBroadQuerySignalBoost(
    searchQuery: string,
    resultType: string,
    fileSignal: BroadQueryFileSignal | undefined,
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
    return this.lookup.normalizeSearchText(searchQuery)
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
        .map((value) => this.lookup.normalizeSearchText(value))
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

  async getBroadAnchorCandidates(
    repo: RepoHandle,
    searchQuery: string,
    rawResults: SearchSeedResult[],
    ownersMode = false,
  ): Promise<SearchSeedResult[]> {
    if (!ownersMode && !this.isSubsystemDiscoveryQuery(searchQuery)) {
      return [];
    }

    const candidateFilePathSet = new Set(
      rawResults
        .map((row) => row.filePath)
        .filter((filePath) => typeof filePath === 'string' && this.host.isLikelyProductionFile(filePath)),
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
    const normalizedQuery = this.lookup.normalizeSearchText(searchQuery);
    const normalizedName = this.lookup.normalizeSearchText(result.name);
    const fileBase = this.lookup.getSplitWordAlias(path.basename(result.filePath));
    const moduleAlias = result.moduleSymbol ? this.lookup.getSplitWordAlias(result.moduleSymbol) : '';
    const dataModelPath = result.dataModelPath ? this.lookup.normalizeSearchText(result.dataModelPath) : '';
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

  private async buildEnrichment(
    repo: RepoHandle,
    searchQuery: string,
    rawResults: SearchSeedResult[],
    ownersMode: boolean,
  ): Promise<SearchEnrichmentBundle> {
    const filePaths = [...new Set(rawResults.map((r) => r.filePath).filter(Boolean))];
    const [rojoProject, primaryModules, boundaryImports] = await Promise.all([
      this.enrichment.getRojoProjectIndex(repo),
      this.enrichment.getPrimaryModuleSymbols(repo, filePaths),
      this.enrichment.getBoundaryImports(repo, filePaths),
    ]);

    const hasMappedCandidates = rawResults.some((result) => this.enrichment.isRojoMappedResult(rojoProject, result.filePath));
    const preferMappedResults = (ownersMode || this.isBroadSearchQuery(searchQuery)) && hasMappedCandidates;
    const subsystemDiscovery = ownersMode || this.isSubsystemDiscoveryQuery(searchQuery);
    const broadQueryFileSignals = subsystemDiscovery
      ? await this.enrichment.getBroadQueryFileSignals(repo, filePaths)
      : new Map<string, BroadQueryFileSignal>();
    const anchorFiles = new Set(
      rawResults
        .filter((result) => this.host.isOwnerLikeSymbolKind(this.host.getNodeKind(result)))
        .map((result) => result.filePath)
        .filter(Boolean),
    );

    return {
      rojoProject,
      primaryModules,
      boundaryImports,
      broadQueryFileSignals,
      anchorFiles,
      preferMappedResults,
    };
  }

  async rankSearchResults(
    repo: RepoHandle,
    searchQuery: string,
    rawResults: SearchSeedResult[],
    limit: number,
    ownersMode = false,
  ): Promise<RankedSearchResult[]> {
    const exactAliasCandidates = await this.lookup.getExactAliasCandidates(repo, searchQuery);
    const broadAnchorCandidates = await this.getBroadAnchorCandidates(repo, searchQuery, rawResults, ownersMode);
    const dedupedRaw = [...rawResults, ...exactAliasCandidates, ...broadAnchorCandidates].filter((result, index, array) => {
      const key = result.nodeId || `${result.type}:${result.filePath}:${result.name}:${result.startLine || ''}`;
      return array.findIndex((candidate) => {
        const candidateKey = candidate.nodeId || `${candidate.type}:${candidate.filePath}:${candidate.name}:${candidate.startLine || ''}`;
        return candidateKey === key;
      }) === index;
    });

    const enrichment = await this.buildEnrichment(repo, searchQuery, dedupedRaw, ownersMode);
    const subsystemDiscovery = ownersMode || this.isSubsystemDiscoveryQuery(searchQuery);

    const ranked = dedupedRaw.map((result) => {
      const resultType = this.host.getNodeKind(result);
      const rojoTarget = this.enrichment.getRojoTarget(enrichment.rojoProject, result.filePath) as RojoTargetSummary | undefined;
      const moduleSymbol = resultType === 'Module' ? result.name : enrichment.primaryModules.get(result.filePath);
      const rojoMappingBoost = enrichment.preferMappedResults
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
        enrichment.broadQueryFileSignals.get(result.filePath),
        ownersMode,
      );
      const sameFileAnchorPenalty = subsystemDiscovery &&
        enrichment.anchorFiles.has(result.filePath) &&
        !this.host.isOwnerLikeSymbolKind(resultType)
        ? (ownersMode ? 5.5 : 3.5)
        : 0;
      const ownerShapePenalty = subsystemDiscovery
        ? this.getBroadOwnerShapePenalty(resultType, result.name, result.filePath, ownersMode, enrichment.anchorFiles)
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
        boundaryImports: enrichment.boundaryImports.get(result.filePath),
      } satisfies RankedSearchResult;
    });

    return ranked
      .sort((a, b) => b.score - a.score || b.bm25Score - a.bm25Score)
      .slice(0, limit);
  }
}
