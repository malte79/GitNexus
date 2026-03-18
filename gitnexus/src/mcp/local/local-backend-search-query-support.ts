import { executeParameterized } from '../core/kuzu-adapter.js';
import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendSearchHost } from './local-backend-search-types.js';
import { LocalBackendSearchRankingSupport } from './local-backend-search-ranking-support.js';

export class LocalBackendSearchQuerySupport {
  constructor(
    private readonly host: LocalBackendSearchHost,
    private readonly ranking: LocalBackendSearchRankingSupport,
  ) {}

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
    const rankedMatches = await this.ranking.rankSearchResults(repo, searchQuery, bm25Results, searchLimit, ownerMode);

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
}
