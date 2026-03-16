import path from 'path';
import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import { generateId } from '../../lib/utils.js';
import { isTestFilePath } from './local-backend-common.js';
import type { MemberRecoverySource, RepoHandle } from './local-backend-types.js';

export class LocalBackendGraphSupport {
  isLikelyProductionFile(filePath: string): boolean {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    if (isTestFilePath(normalized)) return false;
    if (/(^|\/)(artifacts|docs?|archive|examples|planning|vendor|scripts?|fixtures?)(\/|$)/.test(normalized)) {
      return false;
    }
    return true;
  }

  isLikelyCodeFile(filePath: string): boolean {
    return /\.(c|cc|cpp|cs|cxx|go|h|hpp|hxx|hh|java|js|jsx|kt|lua|luau|mjs|py|php|rb|rs|swift|ts|tsx)$/i.test(filePath);
  }

  isPrimarySourceFile(filePath: string): boolean {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    return /^(src|typed|app|lib|pkg|internal)\//.test(normalized);
  }

  summarizeAffectedAreas(filePaths: string[]): Array<{ name: string; files: number }> {
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

  classifyCoverageSignal(score: number): 'high' | 'medium' | 'low' {
    if (score >= 0.75) return 'high';
    if (score >= 0.35) return 'medium';
    return 'low';
  }

  getOwnerSymbolPriority(kind: string): number {
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

  isOwnerLikeSymbolKind(resultType: string): boolean {
    return ['File', 'Module', 'Class', 'Interface', 'Struct', 'Namespace'].includes(resultType);
  }

  isPrimaryOwnerKind(resultType: string): boolean {
    return ['Module', 'Class', 'Interface', 'Struct', 'Namespace'].includes(resultType);
  }

  isLowSignalSummarySymbol(name: string): boolean {
    return /^(main|new|init|encode|decode|worker|assert[a-z0-9_]*)$/i.test(name);
  }

  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string {
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

  rankRepresentativeSymbols<T extends { type: string; name: string; filePath?: string; fanIn?: number; fan_in?: number; startLine?: number }>(symbols: T[]): T[] {
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

  rankOwnerCandidates<T extends { type: string; fanIn?: number; fan_in?: number; name: string; filePath?: string }>(owners: T[]): T[] {
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

  async getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]> {
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

  async getDetailedAffectedAreas(
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

  async getContainedMembers(
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
}
