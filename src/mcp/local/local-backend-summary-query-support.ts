import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import { isTestFilePath } from './local-backend-common.js';
import type { RepoHandle } from './local-backend-types.js';
import { LocalBackendSummaryPresentationSupport } from './local-backend-summary-presentation-support.js';

export interface LocalBackendSummaryQueryHost {
  ensureInitialized(repoId: string): Promise<void>;
  getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  isOwnerLikeSymbolKind(resultType: string): boolean;
  isPrimaryOwnerKind(resultType: string): boolean;
  isLikelyProductionFile(filePath: string): boolean;
  isLowSignalSummarySymbol(name: string): boolean;
  getOwnerSymbolPriority(kind: string): number;
  rankOwnerCandidates<T extends { type: string; fanIn?: number; fan_in?: number; name: string; filePath?: string }>(owners: T[]): T[];
}

export class LocalBackendSummaryQuerySupport {
  constructor(
    private readonly host: LocalBackendSummaryQueryHost,
    private readonly presentation: LocalBackendSummaryPresentationSupport,
  ) {}

  private async loadClusters(repo: RepoHandle, limit: number): Promise<any[]> {
    await this.host.ensureInitialized(repo.id);

    const rawLimit = Math.max(limit * 5, 200);
    const clusters = await executeQuery(repo.id, `
      MATCH (c:Community)
      RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
      ORDER BY c.symbolCount DESC
      LIMIT ${rawLimit}
    `);
    const rawClusters = clusters.map((cluster: any) => ({
      id: cluster.id || cluster[0],
      label: cluster.label || cluster[1],
      heuristicLabel: cluster.heuristicLabel || cluster[2],
      cohesion: cluster.cohesion || cluster[3],
      symbolCount: cluster.symbolCount || cluster[4],
    }));
    return this.aggregateClusters(rawClusters).slice(0, limit);
  }

  private async loadProcesses(repo: RepoHandle, limit: number): Promise<any[]> {
    await this.host.ensureInitialized(repo.id);

    const processes = await executeQuery(repo.id, `
      MATCH (p:Process)
      RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
      ORDER BY p.stepCount DESC
      LIMIT ${limit}
    `);
    return processes.map((process: any) => ({
      id: process.id || process[0],
      label: process.label || process[1],
      heuristicLabel: process.heuristicLabel || process[2],
      processType: process.processType || process[3],
      stepCount: process.stepCount || process[4],
    }));
  }

  aggregateClusters(clusters: any[]): any[] {
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
      .map(([label, group]) => ({
        id: group.largest.id,
        label,
        heuristicLabel: label,
        symbolCount: group.totalSymbols,
        cohesion: group.totalSymbols > 0 ? group.weightedCohesion / group.totalSymbols : 0,
        subCommunities: group.ids.length,
      }))
      .filter((cluster) => cluster.symbolCount >= 5)
      .sort((a, b) => b.symbolCount - a.symbolCount);
  }

  async getSubsystemSummary(repo: RepoHandle, limit: number): Promise<any[]> {
    const rawLimit = Math.max(limit * 5, 100);
    const clusters = await executeQuery(repo.id, `
      MATCH (c:Community)
      RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
      ORDER BY c.symbolCount DESC, c.heuristicLabel ASC
      LIMIT ${rawLimit}
    `);
    const aggregated = this.aggregateClusters(clusters.map((cluster: any) => ({
      id: cluster.id || cluster[0],
      label: cluster.label || cluster[1],
      heuristicLabel: cluster.heuristicLabel || cluster[2],
      cohesion: cluster.cohesion || cluster[3],
      symbolCount: cluster.symbolCount || cluster[4],
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
      const directSubsystemOwners = this.host.rankOwnerCandidates(
        subsystemOwnerRows
          .map((row: any) => ({
            id: row.id || row[0],
            name: row.name || row[1],
            type: this.host.getNodeKind({ id: row.id || row[0], type: row.type || row[2] }),
            filePath: row.filePath || row[3],
            fan_in: row.fanIn || row[4] || 0,
          }))
          .filter((row: any) =>
            row.filePath &&
            this.host.isLikelyProductionFile(row.filePath) &&
            this.host.isPrimaryOwnerKind(row.type),
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
          type: this.host.getNodeKind({ id: row.id || row[0], type: row.type || row[2] }),
          filePath: row.filePath || row[3],
          fan_in: row.fanIn || row[4] || 0,
        }))
        .filter((row: any) =>
          row.filePath &&
          this.host.isLikelyProductionFile(row.filePath) &&
          row.fan_in > 0 &&
          !this.host.isLowSignalSummarySymbol(row.name),
        )
        .sort((a: any, b: any) =>
          b.fan_in - a.fan_in ||
          this.host.getOwnerSymbolPriority(b.type) - this.host.getOwnerSymbolPriority(a.type) ||
          a.name.localeCompare(b.name),
        )
        .filter((row: any, index: number, array: any[]) => array.findIndex((candidate) => candidate.id === row.id) === index)
        .slice(0, 8);
      const supplementalOwners = this.host.rankOwnerCandidates(
        (await this.host.getOwnerSymbolsForFiles(repo, filePaths))
          .filter((row: any) =>
            row.filePath &&
            this.host.isLikelyProductionFile(row.filePath) &&
            (this.host.isOwnerLikeSymbolKind(row.type) || row.type === 'File'),
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
        .slice(0, 8);
      const structuralHotAnchors = hotAnchors.filter((row: any) => this.host.isOwnerLikeSymbolKind(row.type) || row.type === 'File');
      if (topOwners.length === 0 && hotAnchors.length > 0) {
        topOwners = (structuralHotAnchors.length > 0 ? structuralHotAnchors : hotAnchors).slice(0, 8);
      } else if (
        topOwners.length > 0 &&
        topOwners.every((row: any) => row.type === 'File') &&
        structuralHotAnchors.some((row: any) => row.type !== 'File')
      ) {
        topOwners = structuralHotAnchors.slice(0, 8);
      }
      const productionFiles = filePaths.filter((filePath: string) => this.host.isLikelyProductionFile(filePath)).length;
      const testFiles = filePaths.filter((filePath: string) => isTestFilePath(filePath)).length;
      const pressure = pressureRows[0] || {};
      const displayLabel = this.presentation.deriveSubsystemLabel(label, filePaths, topOwners, hotAnchors);

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

  async queryClusters(repo: RepoHandle, limit = 100): Promise<{ clusters: any[] }> {
    try {
      return { clusters: await this.loadClusters(repo, limit) };
    } catch {
      return { clusters: [] };
    }
  }

  async queryProcesses(repo: RepoHandle, limit = 50): Promise<{ processes: any[] }> {
    try {
      return { processes: await this.loadProcesses(repo, limit) };
    } catch {
      return { processes: [] };
    }
  }

  async getClustersForOverview(repo: RepoHandle, limit: number): Promise<any[]> {
    return this.loadClusters(repo, limit);
  }

  async getProcessesForOverview(repo: RepoHandle, limit: number): Promise<any[]> {
    return this.loadProcesses(repo, limit);
  }

  async queryClusterDetail(repo: RepoHandle, name: string): Promise<any> {
    await this.host.ensureInitialized(repo.id);

    const clusters = await executeParameterized(repo.id, `
      MATCH (c:Community)
      WHERE c.label = $clusterName OR c.heuristicLabel = $clusterName
      RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
    `, { clusterName: name });
    if (clusters.length === 0) return { error: `Cluster '${name}' not found` };

    const rawClusters = clusters.map((cluster: any) => ({
      id: cluster.id || cluster[0],
      label: cluster.label || cluster[1],
      heuristicLabel: cluster.heuristicLabel || cluster[2],
      cohesion: cluster.cohesion || cluster[3],
      symbolCount: cluster.symbolCount || cluster[4],
    }));

    let totalSymbols = 0;
    let weightedCohesion = 0;
    for (const cluster of rawClusters) {
      const symbolCount = cluster.symbolCount || 0;
      totalSymbols += symbolCount;
      weightedCohesion += (cluster.cohesion || 0) * symbolCount;
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
      members: members.map((member: any) => ({
        name: member.name || member[0],
        type: member.type || member[1],
        filePath: member.filePath || member[2],
      })),
    };
  }

  async queryProcessDetail(repo: RepoHandle, name: string): Promise<any> {
    await this.host.ensureInitialized(repo.id);

    const processes = await executeParameterized(repo.id, `
      MATCH (p:Process)
      WHERE p.label = $processName OR p.heuristicLabel = $processName
      RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
      LIMIT 1
    `, { processName: name });
    if (processes.length === 0) return { error: `Process '${name}' not found` };

    const process = processes[0];
    const processId = process.id || process[0];
    const steps = await executeParameterized(repo.id, `
      MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p {id: $procId})
      RETURN n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, r.step AS step
      ORDER BY r.step
    `, { procId: processId });

    return {
      process: {
        id: processId,
        label: process.label || process[1],
        heuristicLabel: process.heuristicLabel || process[2],
        processType: process.processType || process[3],
        stepCount: process.stepCount || process[4],
      },
      steps: steps.map((step: any) => ({
        step: step.step || step[3],
        name: step.name || step[0],
        type: step.type || step[1],
        filePath: step.filePath || step[2],
      })),
    };
  }
}
