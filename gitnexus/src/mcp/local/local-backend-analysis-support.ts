import fs from 'fs/promises';
import path from 'path';
import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import { VALID_RELATION_TYPES, isTestFilePath, logQueryError } from './local-backend-common.js';
import type { MemberRecoverySource, RepoFreshnessSummary, RepoHandle } from './local-backend-types.js';

export interface LocalBackendAnalysisHost {
  ensureInitialized(repoId: string): Promise<void>;
  getRepoFreshnessSummary(repoRoot: string): Promise<RepoFreshnessSummary | null>;
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  humanizeSummaryLabel(label: string): string;
  isLowSignalSubsystemLabel(label: string): boolean;
  lookupNamedSymbols(
    repo: RepoHandle,
    params: { name: string; file_path?: string; include_content?: boolean },
  ): Promise<any[]>;
  getPrimaryModuleSymbols(repo: RepoHandle, filePaths: string[]): Promise<Map<string, string>>;
  getRojoProjectIndex(repo: RepoHandle): Promise<any | null>;
  getBoundaryImports(
    repo: RepoHandle,
    filePaths: string[],
  ): Promise<Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>>;
  getContainedMembers(
    repo: RepoHandle,
    symbol: { id: string; kind?: string; filePath?: string; startLine?: number; endLine?: number; description?: string },
  ): Promise<{ rows: any[]; inferred: boolean; source: MemberRecoverySource }>;
  classifyCoverageSignal(score: number): 'high' | 'medium' | 'low';
  getDetailedAffectedAreas(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
  getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
}

export class LocalBackendAnalysisSupport {
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

  async getShapeSignals(
    repo: RepoHandle,
    filePath: string | undefined,
  ): Promise<{
    file: {
      line_count: number | null;
      function_count: number;
      largest_members: Array<{ name: string; kind: string; startLine: number; endLine: number; line_count: number }>;
      average_lines_per_function: number | null;
      hotspot_share: number | null;
      concentration: 'low' | 'medium' | 'high' | 'critical';
      grounded_extraction_seams: Array<{ name: string; symbol_count: number; startLine: number; endLine: number }>;
    };
  }> {
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

  async context(repo: RepoHandle, params: {
    name?: string;
    uid?: string;
    file_path?: string;
    include_content?: boolean;
  }): Promise<any> {
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

    const categorize = (rows: any[]) => {
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
    };

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
      incoming: categorize([...incomingRows, ...incomingViaMembersRows]),
      outgoing: categorize([...outgoingRows, ...outgoingViaMembersRows]),
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

  async detectChanges(repo: RepoHandle, params: {
    scope?: string;
    base_ref?: string;
  }): Promise<any> {
    await this.host.ensureInitialized(repo.id);

    const scope = params.scope || 'unstaged';
    const { execFileSync } = await import('child_process');

    let diffArgs: string[];
    switch (scope) {
      case 'staged':
        diffArgs = ['diff', '--staged', '--name-only'];
        break;
      case 'all':
        diffArgs = ['diff', 'HEAD', '--name-only'];
        break;
      case 'compare':
        if (!params.base_ref) return { error: 'base_ref is required for "compare" scope' };
        diffArgs = ['diff', params.base_ref, '--name-only'];
        break;
      case 'unstaged':
      default:
        diffArgs = ['diff', '--name-only'];
        break;
    }

    let changedFiles: string[];
    try {
      const output = execFileSync('git', diffArgs, { cwd: repo.repoPath, encoding: 'utf-8' });
      changedFiles = output.trim().split('\n').filter(f => f.length > 0);
    } catch (err: any) {
      return { error: `Git diff failed: ${err.message}` };
    }

    if (changedFiles.length === 0) {
      return {
        summary: { changed_count: 0, affected_count: 0, risk_level: 'none', message: 'No changes detected.' },
        changed_symbols: [],
        affected_processes: [],
      };
    }

    const changedSymbols: any[] = [];
    for (const file of changedFiles) {
      const normalizedFile = file.replace(/\\/g, '/');
      try {
        const symbols = await executeParameterized(repo.id, `
          MATCH (n) WHERE n.filePath CONTAINS $filePath
          RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
          LIMIT 20
        `, { filePath: normalizedFile });
        for (const sym of symbols) {
          changedSymbols.push({
            id: sym.id || sym[0],
            name: sym.name || sym[1],
            type: sym.type || sym[2],
            filePath: sym.filePath || sym[3],
            change_type: 'Modified',
          });
        }
      } catch (e) { logQueryError('detect-changes:file-symbols', e); }
    }

    const affectedProcesses = new Map<string, any>();
    for (const sym of changedSymbols) {
      try {
        const procs = await executeParameterized(repo.id, `
          MATCH (n {id: $nodeId})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
          RETURN p.id AS pid, p.heuristicLabel AS label, p.processType AS processType, p.stepCount AS stepCount, r.step AS step
        `, { nodeId: sym.id });
        for (const proc of procs) {
          const pid = proc.pid || proc[0];
          if (!affectedProcesses.has(pid)) {
            affectedProcesses.set(pid, {
              id: pid,
              name: proc.label || proc[1],
              process_type: proc.processType || proc[2],
              step_count: proc.stepCount || proc[3],
              changed_steps: [],
            });
          }
          affectedProcesses.get(pid)!.changed_steps.push({
            symbol: sym.name,
            step: proc.step || proc[4],
          });
        }
      } catch (e) { logQueryError('detect-changes:process-lookup', e); }
    }

    const processCount = affectedProcesses.size;
    const risk = processCount === 0 ? 'low' : processCount <= 5 ? 'medium' : processCount <= 15 ? 'high' : 'critical';

    return {
      summary: {
        changed_count: changedSymbols.length,
        affected_count: processCount,
        changed_files: changedFiles.length,
        risk_level: risk,
      },
      changed_symbols: changedSymbols,
      affected_processes: Array.from(affectedProcesses.values()),
    };
  }

  async rename(repo: RepoHandle, params: {
    symbol_name?: string;
    symbol_uid?: string;
    new_name: string;
    file_path?: string;
    dry_run?: boolean;
  }): Promise<any> {
    await this.host.ensureInitialized(repo.id);

    const { new_name, file_path } = params;
    const dry_run = params.dry_run ?? true;

    if (!params.symbol_name && !params.symbol_uid) {
      return { error: 'Either symbol_name or symbol_uid is required.' };
    }

    const assertSafePath = (filePath: string): string => {
      const full = path.resolve(repo.repoPath, filePath);
      if (!full.startsWith(repo.repoPath + path.sep) && full !== repo.repoPath) {
        throw new Error(`Path traversal blocked: ${filePath}`);
      }
      return full;
    };

    const lookupResult = await this.context(repo, {
      name: params.symbol_name,
      uid: params.symbol_uid,
      file_path,
    });

    if (lookupResult.status === 'ambiguous' || lookupResult.error) {
      return lookupResult;
    }

    const sym = lookupResult.symbol;
    const oldName = sym.name;

    if (oldName === new_name) {
      return { error: 'New name is the same as the current name.' };
    }

    const changes = new Map<string, { file_path: string; edits: any[] }>();

    const addEdit = (filePath: string, line: number, oldText: string, newText: string, confidence: string) => {
      if (!changes.has(filePath)) {
        changes.set(filePath, { file_path: filePath, edits: [] });
      }
      changes.get(filePath)!.edits.push({ line, old_text: oldText, new_text: newText, confidence });
    };

    if (sym.filePath && sym.startLine) {
      try {
        const content = await fs.readFile(assertSafePath(sym.filePath), 'utf-8');
        const lines = content.split('\n');
        const lineIdx = sym.startLine - 1;
        if (lineIdx >= 0 && lineIdx < lines.length && lines[lineIdx].includes(oldName)) {
          const defRegex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          addEdit(sym.filePath, sym.startLine, lines[lineIdx].trim(), lines[lineIdx].replace(defRegex, new_name).trim(), 'graph');
        }
      } catch (e) { logQueryError('rename:read-definition', e); }
    }

    const allIncoming = [
      ...(lookupResult.incoming.calls || []),
      ...(lookupResult.incoming.imports || []),
      ...(lookupResult.incoming.extends || []),
      ...(lookupResult.incoming.implements || []),
    ];

    let graphEdits = changes.size > 0 ? 1 : 0;

    for (const ref of allIncoming) {
      if (!ref.filePath) continue;
      try {
        const content = await fs.readFile(assertSafePath(ref.filePath), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(oldName)) {
            addEdit(ref.filePath, i + 1, lines[i].trim(), lines[i].replace(new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), new_name).trim(), 'graph');
            graphEdits++;
            break;
          }
        }
      } catch (e) { logQueryError('rename:read-ref', e); }
    }

    let astSearchEdits = 0;
    const graphFiles = new Set([sym.filePath, ...allIncoming.map((r: any) => r.filePath)].filter(Boolean));

    try {
      const { execFileSync } = await import('child_process');
      const rgArgs = [
        '-l',
        '--type-add', 'code:*.{ts,tsx,js,jsx,py,go,rs,java,c,h,cpp,cc,cxx,hpp,hxx,hh,cs,php,swift}',
        '-t', 'code',
        `\\b${oldName}\\b`,
        '.',
      ];
      const output = execFileSync('rg', rgArgs, { cwd: repo.repoPath, encoding: 'utf-8', timeout: 5000 });
      const files = output.trim().split('\n').filter(f => f.length > 0);

      for (const file of files) {
        const normalizedFile = file.replace(/\\/g, '/').replace(/^\.\//, '');
        if (graphFiles.has(normalizedFile)) continue;

        try {
          const content = await fs.readFile(assertSafePath(normalizedFile), 'utf-8');
          const lines = content.split('\n');
          const regex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              regex.lastIndex = 0;
              addEdit(normalizedFile, i + 1, lines[i].trim(), lines[i].replace(regex, new_name).trim(), 'text_search');
              astSearchEdits++;
            }
          }
        } catch (e) { logQueryError('rename:text-search-read', e); }
      }
    } catch (e) { logQueryError('rename:ripgrep', e); }

    const allChanges = Array.from(changes.values());
    const totalEdits = allChanges.reduce((sum, c) => sum + c.edits.length, 0);

    if (!dry_run) {
      for (const change of allChanges) {
        try {
          const fullPath = assertSafePath(change.file_path);
          let content = await fs.readFile(fullPath, 'utf-8');
          const regex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          content = content.replace(regex, new_name);
          await fs.writeFile(fullPath, content, 'utf-8');
        } catch (e) { logQueryError('rename:apply-edit', e); }
      }
    }

    return {
      status: 'success',
      old_name: oldName,
      new_name,
      files_affected: allChanges.length,
      total_edits: totalEdits,
      graph_edits: graphEdits,
      text_search_edits: astSearchEdits,
      changes: allChanges,
      applied: !dry_run,
    };
  }

  async impact(repo: RepoHandle, params: {
    target?: string;
    uid?: string;
    file_path?: string;
    direction: 'upstream' | 'downstream';
    maxDepth?: number;
    relationTypes?: string[];
    includeTests?: boolean;
    minConfidence?: number;
  }): Promise<any> {
    await this.host.ensureInitialized(repo.id);

    const { target, direction, uid, file_path } = params;
    const maxDepth = params.maxDepth || 3;
    const rawRelTypes = params.relationTypes && params.relationTypes.length > 0
      ? params.relationTypes.filter(t => VALID_RELATION_TYPES.has(t))
      : ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
    const relationTypes = rawRelTypes.length > 0 ? rawRelTypes : ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
    const includeTests = params.includeTests ?? false;
    const minConfidence = params.minConfidence ?? 0;

    const relTypeFilter = relationTypes.map(t => `'${t}'`).join(', ');
    const confidenceFilter = minConfidence > 0 ? ` AND r.confidence >= ${minConfidence}` : '';

    if (!target && !uid) {
      return { error: 'Either "target" or "uid" parameter is required.' };
    }

    const lookupResult = await this.context(repo, {
      name: target,
      uid,
      file_path,
    });
    if (lookupResult.status === 'ambiguous' || lookupResult.error) {
      return lookupResult;
    }

    const sym = lookupResult.symbol;
    const symId = sym.uid || sym.id;
    const symType = this.host.getNodeKind({ id: symId, type: sym.kind || sym.type });
    const { rows: memberRows, inferred: inferredMembers, source: memberSource } = await this.host.getContainedMembers(repo, {
      id: symId,
      kind: symType,
      filePath: sym.filePath,
      startLine: sym.startLine,
      endLine: sym.endLine,
      description: sym.description,
    });
    const memberIds = [...new Set(memberRows.map((row: any) => row.id || row.uid || row[0]).filter(Boolean))];
    const traversalSourceIds = [symId, ...memberIds];

    const impacted: any[] = [];
    const visited = new Set<string>(traversalSourceIds);
    let frontier = traversalSourceIds;

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      const idList = frontier.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
      const query = direction === 'upstream'
        ? `MATCH (caller)-[r:CodeRelation]->(n) WHERE n.id IN [${idList}] AND r.type IN [${relTypeFilter}]${confidenceFilter} RETURN n.id AS sourceId, caller.id AS id, caller.name AS name, labels(caller)[0] AS type, caller.filePath AS filePath, r.type AS relType, r.confidence AS confidence`
        : `MATCH (n)-[r:CodeRelation]->(callee) WHERE n.id IN [${idList}] AND r.type IN [${relTypeFilter}]${confidenceFilter} RETURN n.id AS sourceId, callee.id AS id, callee.name AS name, labels(callee)[0] AS type, callee.filePath AS filePath, r.type AS relType, r.confidence AS confidence`;

      try {
        const related = await executeQuery(repo.id, query);
        for (const rel of related) {
          const relId = rel.id || rel[1];
          const relatedFilePath = rel.filePath || rel[4] || '';

          if (!includeTests && isTestFilePath(relatedFilePath)) continue;

          if (!visited.has(relId)) {
            visited.add(relId);
            nextFrontier.push(relId);
            impacted.push({
              depth,
              id: relId,
              name: rel.name || rel[2],
              type: this.host.getNodeKind({ id: relId, type: rel.type || rel[3] }),
              filePath: relatedFilePath,
              relationType: rel.relType || rel[5],
              confidence: rel.confidence || rel[6] || 1.0,
            });
          }
        }
      } catch (e) { logQueryError('impact:depth-traversal', e); }

      frontier = nextFrontier;
    }

    const grouped: Record<number, any[]> = {};
    for (const item of impacted) {
      if (!grouped[item.depth]) grouped[item.depth] = [];
      grouped[item.depth].push(item);
    }

    const directCount = (grouped[1] || []).length;
    let affectedProcesses: any[] = [];
    let affectedModules: any[] = [];
    let propagationSource: 'direct' | 'file_owner' | 'none' = 'none';

    if (impacted.length > 0) {
      const allIds = impacted.map(i => `'${i.id.replace(/'/g, "''")}'`).join(', ');
      const d1Ids = (grouped[1] || []).map((i: any) => `'${i.id.replace(/'/g, "''")}'`).join(', ');

      const [processRows, moduleRows, directModuleRows] = await Promise.all([
        executeQuery(repo.id, `
          MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
          WHERE s.id IN [${allIds}]
          RETURN p.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits, MIN(r.step) AS minStep, p.stepCount AS stepCount
          ORDER BY hits DESC
          LIMIT 20
        `).catch(() => []),
        executeQuery(repo.id, `
          MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          WHERE s.id IN [${allIds}]
          RETURN c.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits
          ORDER BY hits DESC
          LIMIT 20
        `).catch(() => []),
        d1Ids ? executeQuery(repo.id, `
          MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
          WHERE s.id IN [${d1Ids}]
          RETURN DISTINCT c.heuristicLabel AS name
        `).catch(() => []) : Promise.resolve([]),
      ]);

      affectedProcesses = processRows.map((r: any) => ({
        name: r.name || r[0],
        hits: r.hits || r[1],
        broken_at_step: r.minStep ?? r[2],
        step_count: r.stepCount ?? r[3],
      }));

      const directModuleSet = new Set(directModuleRows.map((r: any) => r.name || r[0]));
      affectedModules = moduleRows.map((r: any) => {
        const name = r.name || r[0];
        return {
          name,
          hits: r.hits || r[1],
          impact: directModuleSet.has(name) ? 'direct' : 'indirect',
        };
      });
      if (affectedProcesses.length > 0 || affectedModules.length > 0) {
        propagationSource = 'direct';
      }
    }

    const directFileImpacts = (grouped[1] || []).filter((item: any) => item.type === 'File' && item.filePath);
    const affectedAreas = await this.host.getDetailedAffectedAreas(
      repo,
      directFileImpacts.map((item: any) => item.filePath),
    );
    const shapeSignals = await this.getShapeSignals(repo, sym.filePath);
    const directFileImpactNames = [...new Set(directFileImpacts.map((item: any) => path.basename(item.filePath)))].slice(0, 4);
    if (propagationSource === 'none' && directFileImpacts.length > 0) {
      const ownerSymbols = await this.host.getOwnerSymbolsForFiles(repo, directFileImpacts.map((item: any) => item.filePath));
      if (ownerSymbols.length > 0) {
        const ownerIds = ownerSymbols.map((item: any) => `'${item.id.replace(/'/g, "''")}'`).join(', ');
        const [ownerProcessRows, ownerModuleRows] = await Promise.all([
          executeQuery(repo.id, `
            MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
            WHERE s.id IN [${ownerIds}]
            RETURN p.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits, MIN(r.step) AS minStep, p.stepCount AS stepCount
            ORDER BY hits DESC
            LIMIT 20
          `).catch(() => []),
          executeQuery(repo.id, `
            MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
            WHERE s.id IN [${ownerIds}]
            RETURN c.heuristicLabel AS name, COUNT(DISTINCT s.id) AS hits
            ORDER BY hits DESC
            LIMIT 20
          `).catch(() => []),
        ]);

        if (ownerProcessRows.length > 0 || ownerModuleRows.length > 0) {
          propagationSource = 'file_owner';
          affectedProcesses = ownerProcessRows.map((r: any) => ({
            name: r.name || r[0],
            hits: r.hits || r[1],
            broken_at_step: r.minStep ?? r[2],
            step_count: r.stepCount ?? r[3],
            source: 'file_owner',
          }));
          affectedModules = ownerModuleRows.map((r: any) => ({
            name: r.name || r[0],
            hits: r.hits || r[1],
            impact: 'via_file_owner',
          }));
        } else {
          propagationSource = 'file_owner';
          affectedModules = ownerSymbols.slice(0, 8).map((owner: any) => ({
            name: owner.name,
            filePath: owner.filePath,
            hits: owner.fanIn || 0,
            impact: 'via_file_owner',
            kind: owner.type,
          }));
        }
      }
    }

    if (
      propagationSource === 'file_owner' &&
      affectedModules.length > 0 &&
      affectedModules.every((item: any) => item.kind === 'File') &&
      affectedAreas.some((area) => area.top_owners.length > 0)
    ) {
      affectedModules = affectedAreas
        .flatMap((area) => area.top_owners.map((owner: any) => ({
          name: owner.name,
          filePath: owner.filePath,
          hits: owner.fanIn || owner.fan_in || 0,
          impact: 'via_area_owner',
          kind: owner.type,
          area: area.name,
        })))
        .filter((item, index, array) => array.findIndex((candidate) => candidate.name === item.name && candidate.filePath === item.filePath) === index)
        .slice(0, 8);
    }

    const processCount = affectedProcesses.length;
    const moduleCount = affectedModules.length;
    const incomingSignal = this.host.classifyCoverageSignal(
      directCount > 0 ? 1 : memberRows.length > 0 ? 0.5 : 0.15,
    );
    const outgoingSignal = this.host.classifyCoverageSignal(
      impacted.length >= directCount && directCount > 0 ? 0.8 : impacted.length > 0 ? 0.5 : 0.15,
    );
    const memberSignal = this.host.classifyCoverageSignal(
      memberRows.length === 0
        ? (['Class', 'Module', 'File'].includes(symType) ? 0.2 : 1)
        : memberSource === 'contains' || memberSource === 'defines'
          ? 1
          : memberSource === 'file_defines'
            ? 0.65
            : 0.5,
    );
    const propagationSignal = this.host.classifyCoverageSignal(
      affectedProcesses.length > 0 || affectedModules.length > 0
        ? propagationSource === 'direct' ? 1 : 0.65
        : affectedAreas.some((area) => area.top_owners.length > 0 || area.hot_anchors.length > 0)
          ? 0.6
          : affectedAreas.length > 0 ? 0.45 : 0.1,
    );
    const overallConfidence =
      memberSource === 'range' || memberSource === 'file_defines'
        ? 'partial'
        : propagationSignal === 'high' && memberSignal !== 'low'
          ? 'grounded'
          : memberRows.length > 0 && propagationSignal !== 'low'
            ? 'expanded'
            : memberRows.length > 0 || affectedAreas.length > 0
              ? 'partial'
              : 'grounded';

    const centralityScore = directCount >= 20 || impacted.length >= 35
      ? 3
      : directCount >= 8 || impacted.length >= 15
        ? 2
        : directCount >= 3 || impacted.length >= 5
          ? 1
          : 0;
    const couplingBreadthScore = moduleCount >= 6 || affectedAreas.length >= 5
      ? 3
      : moduleCount >= 3 || affectedAreas.length >= 3
        ? 2
        : moduleCount >= 1 || affectedAreas.length >= 1
          ? 1
          : 0;
    const lifecycleComplexityScore = processCount >= 12
      ? 3
      : processCount >= 5
        ? 2
        : processCount >= 1
          ? 1
          : 0;
    const boundaryAmbiguityScore = overallConfidence === 'grounded'
      ? 0
      : overallConfidence === 'expanded'
        ? 1
        : overallConfidence === 'partial'
          ? 2
          : 3;
    const internalConcentrationScore = ({
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    } as const)[shapeSignals.file.concentration];
    const lineCount = shapeSignals.file.line_count ?? 0;
    const functionCount = shapeSignals.file.function_count;
    const extractionSeamCount = shapeSignals.file.grounded_extraction_seams.length;
    const fileSizeScore = lineCount >= 1500
      ? 3
      : lineCount >= 700
        ? 2
        : lineCount >= 180
          ? 1
          : 0;
    const functionSurfaceScore = functionCount >= 40
      ? 3
      : functionCount >= 18
        ? 2
        : functionCount >= 8
          ? 1
          : 0;
    const extractionSeamScore = extractionSeamCount >= 4
      ? 2
      : extractionSeamCount >= 1
        ? 1
        : 0;
    const localizedConcentrationScore = lineCount >= 180 || functionCount >= 8
      ? internalConcentrationScore
      : Math.max(0, internalConcentrationScore - 2);
    const refactorPressureTotal = fileSizeScore + functionSurfaceScore + localizedConcentrationScore + extractionSeamScore;
    const refactorPressureScore = refactorPressureTotal >= 8
      ? 3
      : refactorPressureTotal >= 5
        ? 2
        : refactorPressureTotal >= 2
          ? 1
          : 0;
    const changeRiskScore = centralityScore >= 3 && couplingBreadthScore >= 2
      ? 3
      : (
        centralityScore >= 2 ||
        (couplingBreadthScore >= 2 && lifecycleComplexityScore >= 2)
      )
        ? 2
        : (
          centralityScore >= 1 ||
          couplingBreadthScore >= 1 ||
          lifecycleComplexityScore >= 1 ||
          boundaryAmbiguityScore >= 2
        )
          ? 1
          : 0;
    const changeRiskLevel = this.classifyRiskBand(changeRiskScore);
    const refactorPressureLevel = this.classifyStructuralPressureBand(refactorPressureScore);

    let risk = 'LOW';
    if ((inferredMembers || (impacted.length === 0 && ['Class', 'Module', 'File'].includes(symType))) && impacted.length === 0) {
      risk = 'UNKNOWN';
    } else if (centralityScore >= 3 && couplingBreadthScore >= 2) {
      risk = 'CRITICAL';
    } else if (
      centralityScore >= 2 ||
      (couplingBreadthScore >= 2 && lifecycleComplexityScore >= 2) ||
      internalConcentrationScore >= 3
    ) {
      risk = 'HIGH';
    } else if (
      centralityScore >= 1 ||
      couplingBreadthScore >= 1 ||
      lifecycleComplexityScore >= 1 ||
      internalConcentrationScore >= 2 ||
      boundaryAmbiguityScore >= 2
    ) {
      risk = 'MEDIUM';
    }

    return {
      target: {
        id: symId,
        name: sym.name,
        type: symType,
        filePath: sym.filePath,
        member_count: memberRows.length,
      },
      direction,
      impactedCount: impacted.length,
      risk,
      risk_dimensions: {
        centrality: this.classifyRiskBand(centralityScore),
        coupling_breadth: this.classifyRiskBand(couplingBreadthScore),
        internal_concentration: this.classifyRiskBand(internalConcentrationScore),
        lifecycle_complexity: this.classifyRiskBand(lifecycleComplexityScore),
        boundary_ambiguity: this.classifyRiskBand(boundaryAmbiguityScore),
      },
      risk_split: {
        summary_line: `change risk: ${changeRiskLevel}; local refactor pressure: ${refactorPressureLevel}`,
        change_risk: {
          level: changeRiskLevel,
          drivers: {
            centrality: this.classifyRiskBand(centralityScore),
            coupling_breadth: this.classifyRiskBand(couplingBreadthScore),
            lifecycle_complexity: this.classifyRiskBand(lifecycleComplexityScore),
            boundary_ambiguity: this.classifyRiskBand(boundaryAmbiguityScore),
          },
        },
        refactor_pressure: {
          level: refactorPressureLevel,
          drivers: {
            file_size: this.classifyStructuralPressureBand(fileSizeScore),
            function_surface: this.classifyStructuralPressureBand(functionSurfaceScore),
            local_concentration: this.classifyStructuralPressureBand(localizedConcentrationScore),
            extraction_seams: this.classifyStructuralPressureBand(extractionSeamScore),
          },
        },
      },
      shape: shapeSignals,
      coverage: {
        confidence: overallConfidence,
        note:
          propagationSource === 'file_owner'
            ? `Direct impact is landing on file-level callers (${directFileImpactNames.join(', ')}). Higher-level architectural context is being derived from grounded owners and hot anchors across affected areas (${affectedAreas.map((area) => area.name).join(', ')}), so subsystem context is stronger but still bounded by file-owner evidence rather than explicit process membership.`
            : memberSource === 'range'
              ? directCount > 0 && processCount === 0 && moduleCount === 0 && affectedAreas.length > 0
                ? `Direct container edges were not available for this symbol, so impact expansion used same-file source ranges filtered to immediate container members. Direct impact is landing in ${affectedAreas.map((area) => area.name).join(', ')}, but grounded process/module memberships are still missing there, so coverage remains partial.`
                : 'Direct container edges were not available for this symbol, so impact expansion used same-file source ranges filtered to immediate container members. Coverage is improved, but still partial.'
              : memberSource === 'file_defines'
                ? 'Direct container edges were not available for this symbol, so impact expansion used grounded file-level definitions to recover likely members. Coverage is improved, but still partial.'
                : impacted.length === 0 && (memberRows.length > 0 || ['Class', 'Module', 'File'].includes(symType))
                  ? 'No affected symbols were found through direct graph traversal. For container-style symbols, impact coverage may still be incomplete even after expanding through contained members.'
                  : directCount > 0 && processCount === 0 && moduleCount === 0 && directFileImpactNames.length > 0
                    ? `Direct impact is currently landing on file-level callers (${directFileImpactNames.join(', ')}), and the strongest affected areas are ${affectedAreas.map((area) => area.name).join(', ')}. The graph still does not attach grounded process or module memberships to those direct callers, so structural blast radius remains partial.`
                    : memberRows.length > 0
                      ? 'Impact includes relationships gathered through contained members for this symbol.'
                      : 'Impact is grounded in direct graph traversal for this symbol.',
        signals: {
          member_coverage: memberSignal,
          incoming_edges: incomingSignal,
          outgoing_edges: outgoingSignal,
          higher_level_propagation: propagationSignal,
        },
      },
      summary: {
        direct: directCount,
        processes_affected: processCount,
        modules_affected: moduleCount,
        overloaded_file_lines: shapeSignals.file.line_count,
        overloaded_file_functions: shapeSignals.file.function_count,
      },
      affected_processes: affectedProcesses,
      affected_modules: affectedModules,
      affected_areas: affectedAreas,
      byDepth: grouped,
    };
  }
}
