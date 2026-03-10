/**
 * Full-Text Search via KuzuDB FTS
 * 
 * Uses KuzuDB's built-in full-text search indexes for keyword-based search.
 * Always reads from the database (no cached state to drift).
 */

import { queryFTS } from '../kuzu/kuzu-adapter.js';

export interface BM25SearchResult {
  nodeId: string;
  name: string;
  type: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  runtimeArea?: string;
  description?: string;
  score: number;
  rank: number;
}

/**
 * Execute a single FTS query via a custom executor (for MCP connection pool).
 * Returns the same shape as core queryFTS.
 */
async function queryFTSViaExecutor(
  executor: (cypher: string) => Promise<any[]>,
  tableName: string,
  indexName: string,
  query: string,
  limit: number,
): Promise<Array<Omit<BM25SearchResult, 'rank'>>> {
  const escapedQuery = query.replace(/'/g, "''");
  const cypher = `
    CALL QUERY_FTS_INDEX('${tableName}', '${indexName}', '${escapedQuery}', conjunctive := false)
    RETURN
      node.id AS nodeId,
      node.name AS name,
      labels(node)[0] AS type,
      node.filePath AS filePath,
      node.startLine AS startLine,
      node.endLine AS endLine,
      node.runtimeArea AS runtimeArea,
      node.description AS description,
      score
    ORDER BY score DESC
    LIMIT ${limit}
  `;
  try {
    const rows = await executor(cypher);
    return rows.map((row: any) => {
      const score = row.score ?? row[8] ?? 0;
      return {
        nodeId: row.nodeId ?? row[0] ?? '',
        name: row.name ?? row[1] ?? '',
        type: row.type ?? row[2] ?? tableName,
        filePath: row.filePath ?? row[3] ?? '',
        startLine: row.startLine ?? row[4] ?? undefined,
        endLine: row.endLine ?? row[5] ?? undefined,
        runtimeArea: row.runtimeArea ?? row[6] ?? undefined,
        description: row.description ?? row[7] ?? undefined,
        score: typeof score === 'number' ? score : parseFloat(score) || 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Search using KuzuDB's built-in FTS (always fresh, reads from disk)
 * 
 * Queries multiple node tables (File, Function, Class, Method) in parallel
 * and merges results by filePath, summing scores for the same file.
 * 
 * @param query - Search query string
 * @param limit - Maximum results
 * @param repoId - If provided, queries will be routed via the MCP connection pool
 * @returns Ranked search results from FTS indexes
 */
export const searchFTSFromKuzu = async (query: string, limit: number = 20, repoId?: string): Promise<BM25SearchResult[]> => {
  let fileResults: any[], functionResults: any[], classResults: any[], methodResults: any[], interfaceResults: any[], moduleResults: any[];

  if (repoId) {
    // Use MCP connection pool via dynamic import
    // IMPORTANT: KuzuDB uses a single connection per repo — queries must be sequential
    // to avoid deadlocking. Do NOT use Promise.all here.
    const { executeQuery } = await import('../../mcp/core/kuzu-adapter.js');
    const executor = (cypher: string) => executeQuery(repoId, cypher);
    fileResults = await queryFTSViaExecutor(executor, 'File', 'file_fts', query, limit);
    functionResults = await queryFTSViaExecutor(executor, 'Function', 'function_fts', query, limit);
    classResults = await queryFTSViaExecutor(executor, 'Class', 'class_fts', query, limit);
    methodResults = await queryFTSViaExecutor(executor, 'Method', 'method_fts', query, limit);
    interfaceResults = await queryFTSViaExecutor(executor, 'Interface', 'interface_fts', query, limit);
    moduleResults = await queryFTSViaExecutor(executor, 'Module', 'module_fts', query, limit);
  } else {
    // Use core kuzu adapter (CLI / pipeline context) — also sequential for safety
    fileResults = await queryFTS('File', 'file_fts', query, limit, false).catch(() => []);
    functionResults = await queryFTS('Function', 'function_fts', query, limit, false).catch(() => []);
    classResults = await queryFTS('Class', 'class_fts', query, limit, false).catch(() => []);
    methodResults = await queryFTS('Method', 'method_fts', query, limit, false).catch(() => []);
    interfaceResults = await queryFTS('Interface', 'interface_fts', query, limit, false).catch(() => []);
    moduleResults = await queryFTS('Module', 'module_fts', query, limit, false).catch(() => []);
  }

  const normalizeLegacyRows = (results: any[], tableName: string): Array<Omit<BM25SearchResult, 'rank'>> => {
    return results.map((row: any) => {
      if ('nodeId' in row || 'name' in row || 'type' in row) {
        return row;
      }
      const node = row.node || row[0] || {};
      const score = row.score ?? row[1] ?? 0;
      return {
        nodeId: node.id || '',
        name: node.name || '',
        type: tableName,
        filePath: node.filePath || '',
        startLine: node.startLine,
        endLine: node.endLine,
        runtimeArea: node.runtimeArea,
        description: node.description,
        score: typeof score === 'number' ? score : parseFloat(score) || 0,
      };
    });
  };

  const merged = [
    ...normalizeLegacyRows(fileResults, 'File'),
    ...normalizeLegacyRows(functionResults, 'Function'),
    ...normalizeLegacyRows(classResults, 'Class'),
    ...normalizeLegacyRows(methodResults, 'Method'),
    ...normalizeLegacyRows(interfaceResults, 'Interface'),
    ...normalizeLegacyRows(moduleResults, 'Module'),
  ];

  const deduped = new Map<string, Omit<BM25SearchResult, 'rank'>>();
  for (const row of merged) {
    const key = row.nodeId || `${row.type}:${row.filePath}:${row.name}`;
    const existing = deduped.get(key);
    if (!existing || row.score > existing.score) {
      deduped.set(key, row);
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r, index) => ({
      ...r,
      rank: index + 1,
    }));
};
