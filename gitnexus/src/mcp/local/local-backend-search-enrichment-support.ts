import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import type { RepoHandle } from './local-backend-types.js';
import type { BroadQueryFileSignal, LocalBackendSearchHost, RojoTargetLookup } from './local-backend-search-types.js';

export class LocalBackendSearchEnrichmentSupport {
  constructor(private readonly host: LocalBackendSearchHost) {}

  isRojoMappedResult(rojoProject: any | null, filePath?: string): boolean {
    if (!rojoProject || !filePath) return false;
    return (rojoProject.getTargetsForFile(filePath) || []).length > 0;
  }

  getRojoTarget(rojoProject: any | null, filePath: string): RojoTargetLookup {
    return rojoProject?.getTargetsForFile(filePath)?.[0];
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

  async getBroadQueryFileSignals(
    repo: RepoHandle,
    filePaths: string[],
  ): Promise<Map<string, BroadQueryFileSignal>> {
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

    const out = new Map<string, BroadQueryFileSignal>();
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
}
