import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import { logQueryError } from './local-backend-common.js';
import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendAnalysisHost, LocalBackendContextParams } from './local-backend-analysis-types.js';

export class LocalBackendContextSupport {
  constructor(private readonly host: LocalBackendAnalysisHost) {}

  private categorize(rows: any[]) {
    const cats: Record<string, any[]> = {};
    const seen = new Set<string>();
    for (const row of rows) {
      const relType = (row.relType || row[0] || '').toLowerCase();
      const kind = this.host.getNodeKind({ id: row.uid || row[1], type: row.kind || row[4] });
      const entry = {
        uid: row.uid || row[1],
        name: row.name || row[2],
        filePath: row.filePath || row[3],
        kind,
        ...(row.viaMember || row[5] ? { viaMember: row.viaMember || row[5] } : {}),
      };
      const dedupeKey = `${relType}:${entry.uid}:${entry.viaMember || ''}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (!cats[relType]) cats[relType] = [];
      cats[relType].push(entry);
    }
    return cats;
  }

  async context(repo: RepoHandle, params: LocalBackendContextParams): Promise<any> {
    await this.host.ensureInitialized(repo.id);

    const { name, uid, file_path, include_content } = params;

    if (!name && !uid) {
      return { error: 'Either "name" or "uid" parameter is required.' };
    }

    let symbols: any[];
    if (uid) {
      symbols = await executeParameterized(repo.id, `
        MATCH (n {id: $uid})
        RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine, n.runtimeArea AS runtimeArea, n.description AS description${include_content ? ', n.content AS content' : ''}
        LIMIT 1
      `, { uid });
    } else {
      symbols = await this.host.lookupNamedSymbols(repo, {
        name: name!,
        file_path,
        include_content,
      });
    }

    if (symbols.length === 0) {
      return { error: `Symbol '${name || uid}' not found` };
    }

    if (symbols.length > 1 && !uid) {
      const primaryModules = await this.host.getPrimaryModuleSymbols(repo, [...new Set(symbols.map((s: any) => s.filePath || s[3]).filter(Boolean))]);
      const rojoProject = await this.host.getRojoProjectIndex(repo);
      return {
        status: 'ambiguous',
        message: `Found ${symbols.length} symbols matching '${name}'. Use uid or file_path to disambiguate.`,
        candidates: symbols.map((s: any) => ({
          uid: s.id || s[0],
          name: s.name || s[1],
          kind: s.type || s[2],
          filePath: s.filePath || s[3],
          line: s.startLine || s[4],
          ...(s.runtimeArea || s[6] ? { runtimeArea: s.runtimeArea || s[6] } : {}),
          ...(primaryModules.get(s.filePath || s[3]) ? { module_symbol: primaryModules.get(s.filePath || s[3]) } : {}),
          ...(rojoProject?.getTargetsForFile(s.filePath || s[3])?.[0]?.dataModelPath ? { data_model_path: rojoProject.getTargetsForFile(s.filePath || s[3])[0].dataModelPath } : {}),
        })),
      };
    }

    const sym = symbols[0];
    const symId = sym.id || sym[0];
    const filePath = sym.filePath || sym[3];
    const [primaryModules, rojoProject, boundaryImports] = await Promise.all([
      this.host.getPrimaryModuleSymbols(repo, filePath ? [filePath] : []),
      this.host.getRojoProjectIndex(repo),
      this.host.getBoundaryImports(repo, filePath ? [filePath] : []),
    ]);
    const dataModelPath = rojoProject?.getTargetsForFile(filePath)?.[0]?.dataModelPath;
    const symbolKind = this.host.getNodeKind({ id: symId, type: sym.type || sym[2] });
    const moduleSymbol = symbolKind === 'Module' ? (sym.name || sym[1]) : primaryModules.get(filePath);
    const symbolDescription = sym.description || sym[7];

    const { rows: memberRows, source: memberSource } = await this.host.getContainedMembers(repo, {
      id: symId,
      kind: symbolKind,
      filePath,
      startLine: sym.startLine || sym[4],
      endLine: sym.endLine || sym[5],
      description: symbolDescription,
    });
    const memberIds = [...new Set(memberRows.map((row: any) => row.uid || row[0]).filter(Boolean))];
    const hasBackingContainerMembers = memberRows.some((row: any) => (row.role || row[7]) === 'backing_container_member');

    const incomingRows = await executeParameterized(repo.id, `
      MATCH (caller)-[r:CodeRelation]->(n {id: $symId})
      WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
      RETURN r.type AS relType, caller.id AS uid, caller.name AS name, caller.filePath AS filePath, labels(caller)[0] AS kind
      LIMIT 30
    `, { symId });

    const outgoingRows = await executeParameterized(repo.id, `
      MATCH (n {id: $symId})-[r:CodeRelation]->(target)
      WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
      RETURN r.type AS relType, target.id AS uid, target.name AS name, target.filePath AS filePath, labels(target)[0] AS kind
      LIMIT 30
    `, { symId });

    let processRows: any[] = [];
    try {
      processRows = await executeParameterized(repo.id, `
        MATCH (n {id: $symId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
        RETURN p.id AS pid, p.heuristicLabel AS label, r.step AS step, p.stepCount AS stepCount
      `, { symId });
    } catch (e) { logQueryError('context:process-participation', e); }

    let incomingViaMembersRows: any[] = [];
    let outgoingViaMembersRows: any[] = [];
    if (memberIds.length > 0) {
      const quotedMemberIds = memberIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(', ');
      try {
        incomingViaMembersRows = await executeQuery(repo.id, `
          MATCH (caller)-[r:CodeRelation]->(child)
          WHERE child.id IN [${quotedMemberIds}] AND r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
          RETURN r.type AS relType, caller.id AS uid, caller.name AS name, caller.filePath AS filePath,
                 labels(caller)[0] AS kind, child.name AS viaMember
          LIMIT 40
        `);
      } catch (e) { logQueryError('context:incoming-via-members', e); }
      try {
        outgoingViaMembersRows = await executeQuery(repo.id, `
          MATCH (child)-[r:CodeRelation]->(target)
          WHERE child.id IN [${quotedMemberIds}] AND r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
          RETURN r.type AS relType, target.id AS uid, target.name AS name, target.filePath AS filePath,
                 labels(target)[0] AS kind, child.name AS viaMember
          LIMIT 40
        `);
      } catch (e) { logQueryError('context:outgoing-via-members', e); }
      if (processRows.length === 0) {
        try {
          processRows = await executeQuery(repo.id, `
            MATCH (child)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
            WHERE child.id IN [${quotedMemberIds}]
            RETURN p.id AS pid, p.heuristicLabel AS label, r.step AS step, p.stepCount AS stepCount,
                   child.name AS viaMember
            LIMIT 30
          `);
        } catch (e) { logQueryError('context:processes-via-members', e); }
      }
    }

    const directRelationshipCount = incomingRows.length + outgoingRows.length + processRows.length;
    const memberRelationshipCount = incomingViaMembersRows.length + outgoingViaMembersRows.length;
    const partialCoverage =
      directRelationshipCount === 0 &&
      (memberRelationshipCount > 0 || memberRows.length > 0 || ['Class', 'Module', 'File'].includes(symbolKind));
    const confidence = memberSource === 'range' || memberSource === 'file_defines'
      ? 'partial'
      : partialCoverage
        ? 'partial'
        : memberRelationshipCount > 0
          ? 'expanded'
          : 'grounded';
    const coverageNote = memberSource === 'range'
      ? 'Direct container edges were not available for this symbol, so related members were inferred from same-file source ranges and filtered down to immediate container members. Results are materially better than raw symbol-only coverage, but graph coverage may still be incomplete.'
      : memberSource === 'file_defines'
        ? 'Direct container edges were not available for this symbol, so related members were recovered from grounded file-level definitions in the same source file. Results are materially better, but container ownership is still partial.'
        : symbolKind === 'Module' && typeof symbolDescription === 'string' && symbolDescription.startsWith('luau-module:weak') && memberRows.length > 0
          ? hasBackingContainerMembers
            ? 'This Luau module is a weak returned-table wrapper. CodeNexus is showing both the grounded exported wrapper members and the grounded backing-container methods that the wrapper explicitly delegates into. Backing-container members are structural context, not exported module members.'
            : 'This Luau module is a weak returned-table wrapper. CodeNexus is showing the grounded members referenced directly from the returned table, including delegate methods and explicit exported fields. Internal same-file tables and methods are intentionally not treated as exported module members unless the wrapper points to them explicitly.'
          : partialCoverage
            ? 'Direct relationships on this container symbol are sparse. Member-based relationships are shown where available, but graph coverage may still be incomplete.'
            : memberRelationshipCount > 0
              ? 'Includes additional relationships gathered through contained members.'
              : 'Relationships are grounded in direct graph edges for this symbol.';

    return {
      status: 'found',
      symbol: {
        uid: sym.id || sym[0],
        name: sym.name || sym[1],
        kind: symbolKind,
        filePath,
        startLine: sym.startLine || sym[4],
        endLine: sym.endLine || sym[5],
        ...(sym.runtimeArea || sym[6] ? { runtimeArea: sym.runtimeArea || sym[6] } : {}),
        ...(moduleSymbol ? { module_symbol: moduleSymbol } : {}),
        ...(typeof symbolDescription === 'string' && symbolDescription ? { description: symbolDescription } : {}),
        ...(dataModelPath ? { data_model_path: dataModelPath } : {}),
        ...(boundaryImports.get(filePath)?.length ? { boundary_imports: boundaryImports.get(filePath) } : {}),
        ...(include_content && (sym.content || sym[8]) ? { content: sym.content || sym[8] } : {}),
      },
      incoming: this.categorize([...incomingRows, ...incomingViaMembersRows]),
      outgoing: this.categorize([...outgoingRows, ...outgoingViaMembersRows]),
      processes: processRows.map((r: any) => ({
        id: r.pid || r[0],
        name: r.label || r[1],
        step_index: r.step || r[2],
        step_count: r.stepCount || r[3],
        ...(r.viaMember || r[4] ? { via_member: r.viaMember || r[4] } : {}),
      })),
      members: memberRows.map((row: any) => ({
        uid: row.uid || row[0],
        name: row.name || row[1],
        kind: this.host.getNodeKind({ id: row.uid || row[0], type: row.kind || row[2] }),
        filePath: row.filePath || row[3],
        ...((row.role || row[7]) ? { role: row.role || row[7] } : {}),
        ...((row.backingContainer || row[6]) ? { backing_container: row.backingContainer || row[6] } : {}),
      })),
      coverage: {
        confidence,
        note: coverageNote,
      },
    };
  }
}
