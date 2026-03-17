import { executeQuery } from '../core/kuzu-adapter.js';
import type { RepoFreshnessSummary, RepoHandle } from './local-backend-types.js';
import { LocalBackendSummaryPresentationSupport } from './local-backend-summary-presentation-support.js';
import { LocalBackendSummaryQuerySupport } from './local-backend-summary-query-support.js';

export interface LocalBackendOverviewHost {
  ensureInitialized(repoId: string): Promise<void>;
  refreshRepoHandle(repoRoot: string): Promise<void>;
  getRepoFreshnessSummary(repoRoot: string): Promise<RepoFreshnessSummary | null>;
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  isLikelyProductionFile(filePath: string): boolean;
  isLowSignalSummarySymbol(name: string): boolean;
}

export class LocalBackendOverviewSupport {
  constructor(
    private readonly host: LocalBackendOverviewHost,
    private readonly summaryQueries: LocalBackendSummaryQuerySupport,
    private readonly summaryPresentation: LocalBackendSummaryPresentationSupport,
  ) {}

  async overview(
    repo: RepoHandle,
    params: { showClusters?: boolean; showProcesses?: boolean; showSubsystems?: boolean; showSubsystemDetails?: boolean; limit?: number },
  ): Promise<any> {
    await this.host.ensureInitialized(repo.id);
    await this.host.refreshRepoHandle(repo.repoPath);
    const activeRepo = repo;

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
    result.freshness = await this.host.getRepoFreshnessSummary(activeRepo.repoPath);
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
      const testFiles = filePaths.filter((filePath: string) => !this.host.isLikelyProductionFile(filePath));
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
          const type = this.host.getNodeKind({ id: row.id || row[0], type: row.type || row[2] });
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
              (this.host.isLowSignalSummarySymbol(row.name || row[1]) ? 5 : 0),
          };
        })
        .filter((row: any) => row.filePath && this.host.isLikelyProductionFile(row.filePath))
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
        result.clusters = await this.summaryQueries.getClustersForOverview(repo, limit);
        result.coverage.sections.clusters = 'grounded';
      } catch (error: any) {
        result.clusters = null;
        result.coverage.sections.clusters = 'partial';
        result.coverage.notes.push(`clusters unavailable: ${error?.message || 'query failed'}`);
      }
    }

    if (params.showProcesses !== false) {
      try {
        result.processes = await this.summaryQueries.getProcessesForOverview(repo, limit);
        result.coverage.sections.processes = 'grounded';
      } catch (error: any) {
        result.processes = null;
        result.coverage.sections.processes = 'partial';
        result.coverage.notes.push(`processes unavailable: ${error?.message || 'query failed'}`);
      }
    }

    if (params.showSubsystems === true) {
      try {
        result.subsystems = await this.summaryQueries.getSubsystemSummary(activeRepo, limit);
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
      return this.summaryPresentation.buildConciseSubsystemSummary(activeRepo, result, conciseLimit);
    }

    return result;
  }
}
