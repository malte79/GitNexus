import path from 'path';
import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendSearchHost, SearchSeedResult } from './local-backend-search-types.js';

export class LocalBackendSearchLookupSupport {
  constructor(private readonly host: LocalBackendSearchHost) {}

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

  async getExactAliasCandidates(repo: RepoHandle, searchQuery: string): Promise<SearchSeedResult[]> {
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
      .filter((row: SearchSeedResult) => {
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
}
