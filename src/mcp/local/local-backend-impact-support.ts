import path from 'path';
import { executeQuery } from '../core/kuzu-adapter.js';
import { VALID_RELATION_TYPES, isTestFilePath } from './local-backend-common.js';
import type { RepoHandle } from './local-backend-types.js';
import type {
  LocalBackendAnalysisHost,
  LocalBackendContextParams,
  LocalBackendContextResolver,
} from './local-backend-analysis-types.js';
import { LocalBackendShapeSupport } from './local-backend-shape-support.js';

export class LocalBackendImpactSupport {
  constructor(
    private readonly host: LocalBackendAnalysisHost,
    private readonly shapeSupport: LocalBackendShapeSupport,
    private readonly resolveContext: LocalBackendContextResolver,
  ) {}

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

    const lookupResult = await this.resolveContext(repo, {
      name: target,
      uid,
      file_path,
    } satisfies LocalBackendContextParams);
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
      } catch {
        // traversal failure leaves the current frontier empty
      }

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
    const shapeSignals = await this.shapeSupport.getShapeSignals(repo, sym.filePath);
    const hotspotNames = shapeSignals.file.largest_members.slice(0, 3).map((member) => member.name).filter(Boolean);
    const concentratedHotspotNote = hotspotNames.length > 0 && ['high', 'critical'].includes(shapeSignals.file.concentration)
      ? ` Local implementation pressure is concentrated in ${hotspotNames.join(', ')} within ${path.basename(sym.filePath || '') || 'the current file'}.`
      : '';
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
    const changeRiskLevel = this.shapeSupport.classifyRiskBand(changeRiskScore);
    const refactorPressureLevel = this.shapeSupport.classifyStructuralPressureBand(refactorPressureScore);

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
        centrality: this.shapeSupport.classifyRiskBand(centralityScore),
        coupling_breadth: this.shapeSupport.classifyRiskBand(couplingBreadthScore),
        internal_concentration: this.shapeSupport.classifyRiskBand(internalConcentrationScore),
        lifecycle_complexity: this.shapeSupport.classifyRiskBand(lifecycleComplexityScore),
        boundary_ambiguity: this.shapeSupport.classifyRiskBand(boundaryAmbiguityScore),
      },
      risk_split: {
        summary_line: `change risk: ${changeRiskLevel}; local refactor pressure: ${refactorPressureLevel}`,
        change_risk: {
          level: changeRiskLevel,
          drivers: {
            centrality: this.shapeSupport.classifyRiskBand(centralityScore),
            coupling_breadth: this.shapeSupport.classifyRiskBand(couplingBreadthScore),
            lifecycle_complexity: this.shapeSupport.classifyRiskBand(lifecycleComplexityScore),
            boundary_ambiguity: this.shapeSupport.classifyRiskBand(boundaryAmbiguityScore),
          },
        },
        refactor_pressure: {
          level: refactorPressureLevel,
          drivers: {
            file_size: this.shapeSupport.classifyStructuralPressureBand(fileSizeScore),
            function_surface: this.shapeSupport.classifyStructuralPressureBand(functionSurfaceScore),
            local_concentration: this.shapeSupport.classifyStructuralPressureBand(localizedConcentrationScore),
            extraction_seams: this.shapeSupport.classifyStructuralPressureBand(extractionSeamScore),
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
                  ? `No affected symbols were found through direct graph traversal. For container-style symbols, impact coverage may still be incomplete even after expanding through contained members.${concentratedHotspotNote}`
                  : directCount > 0 && processCount === 0 && moduleCount === 0 && directFileImpactNames.length > 0
                    ? `Direct impact is currently landing on file-level callers (${directFileImpactNames.join(', ')}), and the strongest affected areas are ${affectedAreas.map((area) => area.name).join(', ')}. The graph still does not attach grounded process or module memberships to those direct callers, so structural blast radius remains partial.`
                    : memberRows.length > 0
                      ? `Impact includes relationships gathered through contained members for this symbol.${concentratedHotspotNote}`
                      : `Impact is grounded in direct graph traversal for this symbol.${concentratedHotspotNote}`,
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
