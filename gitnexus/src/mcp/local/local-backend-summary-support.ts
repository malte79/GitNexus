import path from 'path';
import { executeParameterized, executeQuery } from '../core/kuzu-adapter.js';
import { generateId } from '../../lib/utils.js';
import { isTestFilePath } from './local-backend-common.js';
import type { RepoFreshnessSummary, RepoHandle } from './local-backend-types.js';

export interface LocalBackendSummaryHost {
  ensureInitialized(repoId: string): Promise<void>;
  refreshRepoHandle(repoRoot: string): Promise<void>;
  getRepoFreshnessSummary(repoRoot: string): Promise<RepoFreshnessSummary | null>;
  getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  isOwnerLikeSymbolKind(resultType: string): boolean;
  isPrimaryOwnerKind(resultType: string): boolean;
  isLikelyProductionFile(filePath: string): boolean;
  isLowSignalSummarySymbol(name: string): boolean;
  getOwnerSymbolPriority(kind: string): number;
  rankOwnerCandidates<T extends { type: string; fanIn?: number; fan_in?: number; name: string; filePath?: string }>(owners: T[]): T[];
}

export class LocalBackendSummarySupport {
  constructor(private readonly host: LocalBackendSummaryHost) {}

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
      .map(([label, g]) => ({
        id: g.largest.id,
        label,
        heuristicLabel: label,
        symbolCount: g.totalSymbols,
        cohesion: g.totalSymbols > 0 ? g.weightedCohesion / g.totalSymbols : 0,
        subCommunities: g.ids.length,
      }))
      .filter((c) => c.symbolCount >= 5)
      .sort((a, b) => b.symbolCount - a.symbolCount);
  }

  humanizeSummaryLabel(label: string): string {
    return label
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  isLowSignalSubsystemLabel(label: string): boolean {
    const normalized = this.humanizeSummaryLabel(label).toLowerCase();
    if (!normalized) {
      return true;
    }
    if (normalized.includes('→')) {
      return true;
    }
    return new Set([
      'adapter',
      'adapters',
      'component',
      'components',
      'log',
      'logging',
      'runtime',
      'system',
      'systems',
      'tool',
      'tools',
      'unit',
      'scenarios',
    ]).has(normalized);
  }

  isBroadSubsystemLabel(label: string): boolean {
    const normalized = this.humanizeSummaryLabel(label).toLowerCase();
    return new Set([
      'app',
      'client',
      'common',
      'core',
      'game',
      'server',
      'shared',
      'world',
    ]).has(normalized);
  }

  private normalizeSearchText(value: string): string {
    return value
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_./-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  normalizeSubsystemPhraseSegment(segment: string): string {
    const humanized = this.humanizeSummaryLabel(segment);
    return humanized
      .replace(/\b(Adapters|Components|Modules|Systems|Tools)\b$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getPathSummaryPhrase(filePath: string): string | null {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    const ignoredSegments = new Set([
      'src',
      'typed',
      'app',
      'lib',
      'pkg',
      'internal',
      'server',
      'client',
      'shared',
      'replicatedstorage',
      'serverscriptservice',
      'starterplayerscripts',
      'starterplayer',
    ]);
    const directorySegments = segments.slice(0, -1).filter((segment) => !ignoredSegments.has(segment.toLowerCase()));
    const tail = directorySegments.slice(-2);
    if (tail.length === 0) {
      const basename = path.basename(normalized, path.extname(normalized));
      return basename ? this.humanizeSummaryLabel(basename) : null;
    }
    const normalizedTail = tail
      .map((segment) => this.normalizeSubsystemPhraseSegment(segment))
      .filter(Boolean);
    if (normalizedTail.length === 2 && this.isBroadSubsystemLabel(normalizedTail[0]) && !this.isLowSignalSubsystemLabel(normalizedTail[1])) {
      return normalizedTail[1];
    }
    return normalizedTail.join(' ');
  }

  getSummaryDisplayLabel(entry: any): string | null {
    if (!entry) return null;
    const kind = this.host.getNodeKind({ id: entry.id, type: entry.type });
    const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
    const filePath = typeof entry.filePath === 'string' ? entry.filePath : '';
    const fileStem = filePath
      ? this.humanizeSummaryLabel(path.basename(filePath, path.extname(filePath)))
      : '';
    if (kind === 'File' && fileStem) {
      return fileStem;
    }
    if (this.host.isOwnerLikeSymbolKind(kind) && rawName) {
      return this.humanizeSummaryLabel(rawName);
    }
    if (fileStem) {
      return fileStem;
    }
    if (!rawName) {
      return null;
    }
    if (kind === 'Method' || kind === 'Function' || this.host.isLowSignalSummarySymbol(rawName)) {
      return fileStem || this.humanizeSummaryLabel(rawName);
    }
    return this.humanizeSummaryLabel(rawName);
  }

  getSummarySubsystemTokens(subsystemName: string): Set<string> {
    const rawSubsystemTokens = this.normalizeSearchText(subsystemName)
      .split(' ')
      .filter(Boolean);
    const subsystemTokens = new Set(
      rawSubsystemTokens.filter((token) => token.length >= 3),
    );
    if (subsystemTokens.size === 0) {
      for (const token of rawSubsystemTokens) {
        subsystemTokens.add(token);
      }
    }
    return subsystemTokens;
  }

  signalAlignsToSubsystem(subsystemName: string, entry: any): boolean {
    if (!entry) return false;
    const subsystemTokens = this.getSummarySubsystemTokens(subsystemName);
    if (subsystemTokens.size === 0) {
      return false;
    }
    const candidatePhrases = [
      typeof entry.name === 'string' ? entry.name : '',
      typeof entry.filePath === 'string' ? this.getPathSummaryPhrase(entry.filePath) || '' : '',
      typeof entry.filePath === 'string' ? path.basename(entry.filePath, path.extname(entry.filePath)) : '',
    ];
    return candidatePhrases.some((phrase) =>
      this.normalizeSearchText(phrase)
        .split(' ')
        .filter((token) => token.length >= 3 || subsystemTokens.has(token))
        .some((token) => subsystemTokens.has(token)),
    );
  }

  getArchitecturalRepresentativeBoost(label: string, entry: any, role: 'owner' | 'hotspot'): number {
    const normalizedLabel = this.normalizeSearchText(label);
    const filePath = typeof entry?.filePath === 'string' ? entry.filePath : '';
    const architecturalRole = /\b(service|controller|orchestrator|runtime|manager|facade|registry|coordinator|compiler|validator|router|bootstrap)\b/i;
    let boost = 0;
    if (architecturalRole.test(label) || architecturalRole.test(filePath)) {
      boost += role === 'owner' ? 4 : 3;
    }
    if (/\b(runtime|service)\b/i.test(normalizedLabel) && role === 'owner') {
      boost += 1;
    }
    if (/\badapter\b/i.test(label)) {
      boost -= role === 'owner' ? 2.5 : 1.5;
    }
    return boost;
  }

  getGenericRepresentativePenalty(label: string, role: 'owner' | 'hotspot'): number {
    const normalized = this.normalizeSearchText(label).trim();
    if (!normalized) {
      return 10;
    }
    const genericNames = new Set([
      'base',
      'common',
      'config',
      'constant',
      'constants',
      'data',
      'helper',
      'helpers',
      'math',
      'model',
      'state',
      'types',
      'util',
      'utils',
    ]);
    let penalty = 0;
    if (genericNames.has(normalized)) {
      penalty += role === 'owner' ? 5 : 6;
    }
    if (normalized.includes('→')) {
      penalty += 8;
    }
    const words = normalized.split(' ').filter(Boolean);
    if (words.length === 1 && !/(service|controller|orchestrator|runtime|manager|facade|registry|coordinator|compiler|validator|router|bootstrap)$/i.test(normalized)) {
      penalty += role === 'owner' ? 2 : 2.5;
    }
    if (/(adapter|helper|helpers|util|utils)$/i.test(normalized)) {
      penalty += 1.5;
    }
    return penalty;
  }

  toRepresentativeOwnerCandidate(entry: any): any | null {
    if (!entry) {
      return null;
    }
    const kind = this.host.getNodeKind({ id: entry.id, type: entry.type });
    if (this.host.isOwnerLikeSymbolKind(kind)) {
      return entry;
    }
    const filePath = typeof entry.filePath === 'string' ? entry.filePath : '';
    if (!filePath) {
      return null;
    }
    return {
      id: generateId('File', filePath),
      name: path.basename(filePath),
      type: 'File',
      filePath,
      fan_in: entry.fan_in ?? entry.fanIn ?? 0,
      fanIn: entry.fanIn ?? entry.fan_in ?? 0,
    };
  }

  scoreSummaryRepresentativeEntry(
    subsystemName: string,
    entry: any,
    role: 'owner' | 'hotspot',
  ): number {
    const label = this.getSummaryDisplayLabel(entry);
    if (!label) {
      return Number.NEGATIVE_INFINITY;
    }
    const normalizedLabel = this.normalizeSearchText(label);
    const kind = this.host.getNodeKind({ id: entry.id, type: entry.type });
    const fanIn = entry.fan_in ?? entry.fanIn ?? 0;
    const aligned = this.signalAlignsToSubsystem(subsystemName, entry);
    const labelTokens = this.normalizeSearchText(label).split(' ').filter(Boolean);
    const subsystemTokens = this.getSummarySubsystemTokens(subsystemName);
    const sharedTokens = labelTokens.filter((token) => subsystemTokens.has(token)).length;
    const architecturalBoost = this.getArchitecturalRepresentativeBoost(label, entry, role);
    const genericRepresentativeTokens = new Set([
      'base',
      'binding',
      'bindings',
      'common',
      'config',
      'configs',
      'constant',
      'constants',
      'contract',
      'contracts',
      'data',
      'helper',
      'helpers',
      'main',
      'model',
      'runtime',
      'state',
      'types',
      'util',
      'utils',
    ]);
    const allGenericTokens = labelTokens.length > 0 &&
      labelTokens.every((token) => genericRepresentativeTokens.has(token));

    let score = 0;
    score += this.host.getOwnerSymbolPriority(kind);
    score += Math.min(fanIn / 20, role === 'owner' ? 3 : 2);
    if (aligned) {
      score += role === 'owner' ? 4 : 3.5;
    }
    if (sharedTokens > 0) {
      score += Math.min(sharedTokens, 2);
    }
    if (kind === 'File') {
      score -= role === 'owner' ? 2.5 : 1.5;
    }
    if (role === 'owner' && sharedTokens === 0 && architecturalBoost <= 0) {
      score -= 3.5;
    }
    if (role === 'owner' && sharedTokens === 0 && /\b(main|runtime|contract|contracts|binding|bindings)\b/.test(normalizedLabel)) {
      score -= 5;
    }
    if (sharedTokens === 0 && allGenericTokens) {
      score -= role === 'owner' ? 5 : 7;
    }
    if (role === 'hotspot' && sharedTokens === 0 && /\b(main|runtime|contract|contracts|common|state)\b/.test(normalizedLabel)) {
      score -= 4;
    }
    score += architecturalBoost;
    score -= this.getGenericRepresentativePenalty(label, role);
    return score;
  }

  selectSummaryRepresentativeLabels(
    subsystemName: string,
    entries: any[],
    role: 'owner' | 'hotspot',
    limit: number,
    allowOwnerFallback = true,
  ): string[] {
    const scored = [...entries]
      .map((entry) => ({
        label: this.getSummaryDisplayLabel(entry),
        score: this.scoreSummaryRepresentativeEntry(subsystemName, entry, role),
        fanIn: entry?.fan_in ?? entry?.fanIn ?? 0,
        aligned: this.signalAlignsToSubsystem(subsystemName, entry),
        sharedTokens: this.getSummaryDisplayLabel(entry)
          ? this.normalizeSearchText(this.getSummaryDisplayLabel(entry) as string)
              .split(' ')
              .filter(Boolean)
              .filter((token) => this.getSummarySubsystemTokens(subsystemName).has(token)).length
          : 0,
        architecturalBoost: this.getSummaryDisplayLabel(entry)
          ? this.getArchitecturalRepresentativeBoost(this.getSummaryDisplayLabel(entry) as string, entry, role)
          : 0,
      }))
      .filter((entry) => entry.label)
      .sort((a, b) => b.score - a.score || b.fanIn - a.fanIn || a.label!.localeCompare(b.label!));

    const preferredThreshold = role === 'owner' ? 6.5 : 0;
    const preferred = scored.filter((entry) => entry.score >= preferredThreshold);
    if (role === 'owner' && preferred.length === 0) {
      if (!allowOwnerFallback) {
        return [];
      }
      const alignedFallback = scored.filter((entry) => entry.aligned || entry.sharedTokens > 0);
      if (alignedFallback.length > 0) {
        return alignedFallback
          .map((entry) => entry.label as string)
          .filter((label, index, labels) => labels.indexOf(label) === index)
          .slice(0, limit);
      }
      const architecturalFallback = scored.filter((entry) => entry.architecturalBoost > 0 && entry.score > 0);
      if (architecturalFallback.length > 0) {
        return architecturalFallback
          .map((entry) => entry.label as string)
          .filter((label, index, labels) => labels.indexOf(label) === index)
          .slice(0, limit);
      }
      return [];
    }
    const source = preferred.length > 0 ? preferred : scored;
    return source
      .map((entry) => entry.label as string)
      .filter((label, index, labels) => labels.indexOf(label) === index)
      .slice(0, limit);
  }

  deriveSubsystemLabel(
    rawLabel: string,
    filePaths: string[],
    topOwners: Array<{ filePath?: string; fan_in?: number; fanIn?: number }>,
    hotAnchors: Array<{ filePath?: string; fan_in?: number; fanIn?: number }>,
  ): string {
    const humanizedRaw = this.humanizeSummaryLabel(rawLabel);
    if (!this.isLowSignalSubsystemLabel(rawLabel) && !this.isBroadSubsystemLabel(rawLabel)) {
      return humanizedRaw || rawLabel;
    }

    const candidateScores = new Map<string, number>();
    const addCandidate = (phrase: string | null | undefined, weight: number) => {
      if (!phrase) return;
      const normalized = this.humanizeSummaryLabel(phrase);
      if (!normalized || this.isLowSignalSubsystemLabel(normalized)) {
        return;
      }
      candidateScores.set(normalized, (candidateScores.get(normalized) || 0) + weight);
    };

    for (const owner of topOwners) {
      addCandidate(owner.filePath ? this.getPathSummaryPhrase(owner.filePath) : null, owner.fan_in || owner.fanIn || 4);
    }
    for (const anchor of hotAnchors) {
      addCandidate(anchor.filePath ? this.getPathSummaryPhrase(anchor.filePath) : null, anchor.fan_in || anchor.fanIn || 3);
    }
    for (const filePath of filePaths.slice(0, 12)) {
      addCandidate(this.getPathSummaryPhrase(filePath), 1);
    }

    const bestCandidate = [...candidateScores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (bestCandidate && (this.isLowSignalSubsystemLabel(rawLabel) || this.isBroadSubsystemLabel(rawLabel))) {
      return bestCandidate;
    }
    return bestCandidate || humanizedRaw || rawLabel;
  }

  buildConciseSubsystemSummary(
    repo: RepoHandle,
    result: any,
    limit: number,
  ): any {
    const toTitleWords = (value: string): string => value
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    const toSubsystemDisplayName = (value: string): string => {
      const normalized = this.normalizeSubsystemPhraseSegment(value);
      const display = this.humanizeSummaryLabel(normalized || value);
      return toTitleWords(display);
    };
    const rankableSubsystems = (result.subsystems || []).filter((subsystem: any) => typeof subsystem?.name === 'string' && subsystem.name.trim());
    const seenSubsystemNames = new Set<string>();
    const uniqueSubsystems = rankableSubsystems.filter((subsystem: any) => {
      const key = toSubsystemDisplayName(subsystem.name).toLowerCase();
      if (seenSubsystemNames.has(key)) {
        return false;
      }
      seenSubsystemNames.add(key);
      return true;
    });
    const preferredSubsystems = uniqueSubsystems.filter((subsystem: any) =>
      !this.isLowSignalSubsystemLabel(subsystem.name) && !this.isBroadSubsystemLabel(subsystem.name),
    );
    const fallbackSubsystems = uniqueSubsystems.filter((subsystem: any) =>
      this.isLowSignalSubsystemLabel(subsystem.name) || this.isBroadSubsystemLabel(subsystem.name),
    );
    const selectedSubsystems = [...preferredSubsystems, ...fallbackSubsystems].slice(0, Math.max(1, limit));

    const subsystems = selectedSubsystems.map((subsystem: any) => {
      let topOwners = this.selectSummaryRepresentativeLabels(
        subsystem.name,
        subsystem.top_owners || [],
        'owner',
        2,
        false,
      ).map((label) => toTitleWords(label));
      if (topOwners.length === 0) {
        topOwners = this.selectSummaryRepresentativeLabels(
          subsystem.name,
          (subsystem.hot_anchors || [])
            .map((entry: any) => this.toRepresentativeOwnerCandidate(entry))
            .filter(Boolean),
          'owner',
          2,
          true,
        ).map((label) => toTitleWords(label));
      }
      const hotspotCandidates = this.selectSummaryRepresentativeLabels(
        subsystem.name,
        (subsystem.hot_anchors || []).filter((anchor: any) => this.signalAlignsToSubsystem(subsystem.name, anchor)),
        'hotspot',
        6,
      ).map((label) => toTitleWords(label));
      const topHotspots = hotspotCandidates
        .filter((label) => !topOwners.includes(label))
        .slice(0, 2);

      return {
        name: toSubsystemDisplayName(subsystem.name),
        production_files: subsystem.production_files,
        test_files: subsystem.test_files,
        top_owners: topOwners,
        top_hotspots: topHotspots,
        top_lifecycle_chokepoints: (subsystem.hot_processes || []).slice(0, 1).map((process: any) => process.name),
        pressure: {
          fan_in: subsystem.fan_in_pressure,
          fan_out: subsystem.fan_out_pressure,
        },
      };
    });

    const topHotspots = subsystems
      .flatMap((subsystem: any) => subsystem.top_hotspots.map((anchor: any) => ({ name: anchor, subsystem: subsystem.name })))
      .filter((anchor: any, index: number, array: any[]) =>
        array.findIndex((candidate) => candidate.name === anchor.name && candidate.subsystem === anchor.subsystem) === index,
      )
      .slice(0, 2);

    const lifecycleChokepoints = subsystems
      .flatMap((subsystem: any) =>
        subsystem.top_lifecycle_chokepoints.map((process: any) => ({
          name: process,
          subsystem: subsystem.name,
        })),
      )
      .filter((process: any, index: number, array: any[]) =>
        array.findIndex((candidate) => candidate.name === process.name && candidate.subsystem === process.subsystem) === index,
      )
      .slice(0, 2);

    return {
      repo: result.repo,
      stats: repo.stats,
      indexedAt: result.indexedAt,
      lastCommit: result.lastCommit,
      freshness: result.freshness ? {
        state: result.freshness.state,
        indexed_commit: result.freshness.indexed_commit,
        current_commit: result.freshness.current_commit,
      } : null,
      production_vs_test: result.production_vs_test,
      top_hotspots: topHotspots,
      top_lifecycle_chokepoints: lifecycleChokepoints,
      subsystems,
    };
  }

  async getSubsystemSummary(repo: RepoHandle, limit: number): Promise<any[]> {
    const rawLimit = Math.max(limit * 5, 100);
    const clusters = await executeQuery(repo.id, `
      MATCH (c:Community)
      RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
      ORDER BY c.symbolCount DESC, c.heuristicLabel ASC
      LIMIT ${rawLimit}
    `);
    const aggregated = this.aggregateClusters(clusters.map((c: any) => ({
      id: c.id || c[0],
      label: c.label || c[1],
      heuristicLabel: c.heuristicLabel || c[2],
      cohesion: c.cohesion || c[3],
      symbolCount: c.symbolCount || c[4],
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
      const displayLabel = this.deriveSubsystemLabel(label, filePaths, topOwners, hotAnchors);

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
      const testFiles = filePaths.filter((filePath: string) => isTestFilePath(filePath));
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
        const rawLimit = Math.max(limit * 5, 200);
        const clusters = await executeQuery(repo.id, `
          MATCH (c:Community)
          RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
          ORDER BY c.symbolCount DESC
          LIMIT ${rawLimit}
        `);
        const rawClusters = clusters.map((c: any) => ({
          id: c.id || c[0],
          label: c.label || c[1],
          heuristicLabel: c.heuristicLabel || c[2],
          cohesion: c.cohesion || c[3],
          symbolCount: c.symbolCount || c[4],
        }));
        result.clusters = this.aggregateClusters(rawClusters).slice(0, limit);
        result.coverage.sections.clusters = 'grounded';
      } catch (error: any) {
        result.clusters = null;
        result.coverage.sections.clusters = 'partial';
        result.coverage.notes.push(`clusters unavailable: ${error?.message || 'query failed'}`);
      }
    }

    if (params.showProcesses !== false) {
      try {
        const processes = await executeQuery(repo.id, `
          MATCH (p:Process)
          RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
          ORDER BY p.stepCount DESC
          LIMIT ${limit}
        `);
        result.processes = processes.map((p: any) => ({
          id: p.id || p[0],
          label: p.label || p[1],
          heuristicLabel: p.heuristicLabel || p[2],
          processType: p.processType || p[3],
          stepCount: p.stepCount || p[4],
        }));
        result.coverage.sections.processes = 'grounded';
      } catch (error: any) {
        result.processes = null;
        result.coverage.sections.processes = 'partial';
        result.coverage.notes.push(`processes unavailable: ${error?.message || 'query failed'}`);
      }
    }

    if (params.showSubsystems === true) {
      try {
        result.subsystems = await this.getSubsystemSummary(activeRepo, limit);
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
      return this.buildConciseSubsystemSummary(activeRepo, result, conciseLimit);
    }

    return result;
  }

  async queryClusters(repo: RepoHandle, limit = 100): Promise<{ clusters: any[] }> {
    await this.host.ensureInitialized(repo.id);

    try {
      const rawLimit = Math.max(limit * 5, 200);
      const clusters = await executeQuery(repo.id, `
        MATCH (c:Community)
        RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
        ORDER BY c.symbolCount DESC
        LIMIT ${rawLimit}
      `);
      const rawClusters = clusters.map((c: any) => ({
        id: c.id || c[0],
        label: c.label || c[1],
        heuristicLabel: c.heuristicLabel || c[2],
        cohesion: c.cohesion || c[3],
        symbolCount: c.symbolCount || c[4],
      }));
      return { clusters: this.aggregateClusters(rawClusters).slice(0, limit) };
    } catch {
      return { clusters: [] };
    }
  }

  async queryProcesses(repo: RepoHandle, limit = 50): Promise<{ processes: any[] }> {
    await this.host.ensureInitialized(repo.id);

    try {
      const processes = await executeQuery(repo.id, `
        MATCH (p:Process)
        RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
        ORDER BY p.stepCount DESC
        LIMIT ${limit}
      `);
      return {
        processes: processes.map((p: any) => ({
          id: p.id || p[0],
          label: p.label || p[1],
          heuristicLabel: p.heuristicLabel || p[2],
          processType: p.processType || p[3],
          stepCount: p.stepCount || p[4],
        })),
      };
    } catch {
      return { processes: [] };
    }
  }

  async queryClusterDetail(repo: RepoHandle, name: string): Promise<any> {
    await this.host.ensureInitialized(repo.id);

    const clusters = await executeParameterized(repo.id, `
      MATCH (c:Community)
      WHERE c.label = $clusterName OR c.heuristicLabel = $clusterName
      RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
    `, { clusterName: name });
    if (clusters.length === 0) return { error: `Cluster '${name}' not found` };

    const rawClusters = clusters.map((c: any) => ({
      id: c.id || c[0],
      label: c.label || c[1],
      heuristicLabel: c.heuristicLabel || c[2],
      cohesion: c.cohesion || c[3],
      symbolCount: c.symbolCount || c[4],
    }));

    let totalSymbols = 0;
    let weightedCohesion = 0;
    for (const c of rawClusters) {
      const s = c.symbolCount || 0;
      totalSymbols += s;
      weightedCohesion += (c.cohesion || 0) * s;
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
      members: members.map((m: any) => ({
        name: m.name || m[0],
        type: m.type || m[1],
        filePath: m.filePath || m[2],
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

    const proc = processes[0];
    const procId = proc.id || proc[0];
    const steps = await executeParameterized(repo.id, `
      MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p {id: $procId})
      RETURN n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, r.step AS step
      ORDER BY r.step
    `, { procId });

    return {
      process: {
        id: procId,
        label: proc.label || proc[1],
        heuristicLabel: proc.heuristicLabel || proc[2],
        processType: proc.processType || proc[3],
        stepCount: proc.stepCount || proc[4],
      },
      steps: steps.map((s: any) => ({
        step: s.step || s[3],
        name: s.name || s[0],
        type: s.type || s[1],
        filePath: s.filePath || s[2],
      })),
    };
  }
}
