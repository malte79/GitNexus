import path from 'path';
import { generateId } from '../../lib/utils.js';
import type { RepoHandle } from './local-backend-types.js';

export interface LocalBackendSummaryPresentationHost {
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  isOwnerLikeSymbolKind(resultType: string): boolean;
  isLowSignalSummarySymbol(name: string): boolean;
  getOwnerSymbolPriority(kind: string): number;
}

export class LocalBackendSummaryPresentationSupport {
  constructor(private readonly host: LocalBackendSummaryPresentationHost) {}

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

  private toRepresentativeOwnerCandidate(entry: any): any | null {
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
    const candidateSubsystems = [...preferredSubsystems, ...fallbackSubsystems]
      .slice(0, Math.max(limit * 4, 20));

    const subsystems = candidateSubsystems.map((subsystem: any) => {
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

      const representativePenalty = (labels: string[], role: 'owner' | 'hotspot'): number =>
        labels.reduce((sum, label) => sum + this.getGenericRepresentativePenalty(label, role), 0);
      const subsystemQualityScore =
        Math.min((subsystem.production_files || 0) / 10, 4) +
        Math.min(((subsystem.fan_in_pressure || 0) + (subsystem.fan_out_pressure || 0)) / 200, 6) +
        (topOwners.length * 4) +
        (topHotspots.length * 3.5) +
        ((subsystem.hot_processes || []).length > 0 ? 2.5 : 0) -
        representativePenalty(topOwners, 'owner') -
        representativePenalty(topHotspots, 'hotspot') -
        (this.isLowSignalSubsystemLabel(subsystem.source_label || subsystem.name) ? 2 : 0) -
        (this.isBroadSubsystemLabel(subsystem.source_label || subsystem.name) ? 5 : 0);

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
        _quality_score: subsystemQualityScore,
        _symbol_count: subsystem.symbol_count || 0,
      };
    })
      .sort((a: any, b: any) =>
        b._quality_score - a._quality_score ||
        b._symbol_count - a._symbol_count ||
        (b.pressure?.fan_in || 0) - (a.pressure?.fan_in || 0) ||
        a.name.localeCompare(b.name),
      )
      .slice(0, Math.max(1, limit))
      .map(({ _quality_score: _qs, _symbol_count: _sc, ...subsystem }: any) => subsystem);

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
}
