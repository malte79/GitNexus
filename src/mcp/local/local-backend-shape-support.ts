import fs from 'fs/promises';
import path from 'path';
import { executeParameterized } from '../core/kuzu-adapter.js';
import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendAnalysisHost, ShapeSignals } from './local-backend-analysis-types.js';

export class LocalBackendShapeSupport {
  constructor(private readonly host: LocalBackendAnalysisHost) {}

  classifyRiskBand(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 3) return 'critical';
    if (score >= 2) return 'high';
    if (score >= 1) return 'medium';
    return 'low';
  }

  classifyOverloadSignal(lineCount: number | null, functionCount: number, hotspotShare: number): 'low' | 'medium' | 'high' | 'critical' {
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

  classifyStructuralPressureBand(score: number): 'low' | 'medium' | 'high' | 'critical' {
    return this.classifyRiskBand(score);
  }

  async getShapeSignals(repo: RepoHandle, filePath: string | undefined): Promise<ShapeSignals> {
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

    const freshness = await this.host.getRepoFreshnessSummary(repo.repoPath).catch(() => null);
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
        kind: this.host.getNodeKind({ id: row.id || row[0], type: row.kind || row[2] }),
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

    const structuredMembers = members.filter((row: any) => ['Function', 'Method', 'Constructor', 'Property'].includes(row.kind));
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
      const kind = this.host.getNodeKind({ id: row.id || row[1], type: row.kind || row[2] });
      if (!['Function', 'Method', 'Constructor', 'Property'].includes(kind)) {
        continue;
      }
      const rawName = this.host.humanizeSummaryLabel(row.name || row[0] || '');
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
      .filter((row: any) => row.symbol_count >= 2 && row.name && !this.host.isLowSignalSubsystemLabel(row.name));

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
}
