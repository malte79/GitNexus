import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendAnalysisHost } from './local-backend-analysis-types.js';
import {
  type ChangeContractSurface,
  type ChangeContractTestTarget,
  type EvidenceBucket,
  createPathStem,
  createSurfaceKey,
  isTestLikePath,
  normalizeRepoPath,
} from './local-backend-change-contract-types.js';

export interface ChangeEvidenceBundle {
  groundedSurfaces: ChangeContractSurface[];
  likelySurfaces: ChangeContractSurface[];
  recommendedTests: ChangeContractTestTarget[];
  supportingProcesses: Array<{ name: string; hits?: number; evidence: EvidenceBucket }>;
  affectedModules: Array<{ name: string; impact?: string; hits?: number; evidence: EvidenceBucket }>;
  riskNotes: Array<{ level: 'low' | 'medium' | 'high' | 'critical' | 'unknown'; summary: string; reason: string; source: 'impact'; evidence: EvidenceBucket }>;
  unknowns: string[];
  primaryAnchor: ChangeContractSurface | null;
}

export class LocalBackendChangeEvidenceSupport {
  constructor(private readonly host: LocalBackendAnalysisHost) {}

  async collectEvidence(
    repo: RepoHandle,
    params: { goal: string; task_context?: string; max_surfaces: number },
  ): Promise<ChangeEvidenceBundle> {
    await this.host.ensureInitialized(repo.id);

    const queryResult = await this.host.querySearch(repo, {
      query: params.goal,
      task_context: params.task_context,
      goal: params.goal,
      owners: true,
      limit: Math.max(3, Math.min(params.max_surfaces, 8)),
      max_symbols: Math.max(6, params.max_surfaces * 3),
    });

    const groundedSurfaces = this.collectGroundedSurfaces(queryResult, params.max_surfaces);
    const primaryAnchor = groundedSurfaces.find((surface) => surface.symbol_name || surface.symbol_uid) || groundedSurfaces[0] || null;

    if (!primaryAnchor) {
      return {
        groundedSurfaces: [],
        likelySurfaces: [],
        recommendedTests: [],
        supportingProcesses: [],
        affectedModules: [],
        riskNotes: [{
          level: 'unknown',
          summary: 'No grounded anchor was recovered for this goal.',
          reason: 'The current graph and search surface did not recover a trustworthy primary symbol or file.',
          source: 'impact',
          evidence: 'hypothesis',
        }],
        unknowns: [
          'No grounded primary edit surface was recovered from the current search graph.',
          'Use query, context, or summary manually before trusting a change contract for this goal.',
        ],
        primaryAnchor: null,
      };
    }

    const impact = await this.host.analyzeImpact(repo, {
      ...(primaryAnchor.symbol_name ? { target: primaryAnchor.symbol_name } : {}),
      ...(primaryAnchor.symbol_uid ? { uid: primaryAnchor.symbol_uid } : {}),
      ...(primaryAnchor.file_path ? { file_path: primaryAnchor.file_path } : {}),
      direction: 'upstream',
      maxDepth: 2,
      includeTests: true,
    });

    const likelySurfaces = this.collectLikelySurfaces(impact, groundedSurfaces, params.max_surfaces);
    const recommendedTests = this.collectRecommendedTests(repo, groundedSurfaces, likelySurfaces, impact, params.max_surfaces);
    const supportingProcesses = Array.isArray(impact?.affected_processes)
      ? impact.affected_processes.slice(0, 6).map((process: any) => ({
          name: process.name,
          hits: process.hits,
          evidence: 'grounded' as const,
        }))
      : [];
    const affectedModules = Array.isArray(impact?.affected_modules)
      ? impact.affected_modules.slice(0, 6).map((module: any) => ({
          name: module.name,
          impact: module.impact,
          hits: module.hits,
          evidence: module.impact === 'direct' ? 'grounded' as const : 'strong_inference' as const,
        }))
      : [];
    const riskNotes = this.collectRiskNotes(primaryAnchor, impact);
    const unknowns = this.collectUnknowns(queryResult, impact, recommendedTests);

    return {
      groundedSurfaces,
      likelySurfaces,
      recommendedTests,
      supportingProcesses,
      affectedModules,
      riskNotes,
      unknowns,
      primaryAnchor,
    };
  }

  private collectGroundedSurfaces(queryResult: any, maxSurfaces: number): ChangeContractSurface[] {
    const surfaces: ChangeContractSurface[] = [];
    const addSurface = (surface: ChangeContractSurface) => {
      if (!surface.file_path) return;
      surfaces.push({
        ...surface,
        file_path: normalizeRepoPath(surface.file_path),
      });
    };

    for (const symbol of queryResult?.process_symbols || []) {
      addSurface({
        file_path: symbol.filePath,
        symbol_name: symbol.name,
        symbol_uid: symbol.id,
        kind: symbol.type,
        module: symbol.module,
        process: symbol.process_id,
        reason: 'Direct query match surfaced this symbol as a central implementation anchor for the requested goal.',
        source: 'query',
        evidence: 'grounded',
      });
    }

    for (const definition of queryResult?.definitions || []) {
      addSurface({
        file_path: definition.filePath,
        symbol_name: definition.name,
        kind: definition.type,
        module: definition.module,
        reason: 'Direct query match surfaced this definition as a likely owner or entrypoint for the requested goal.',
        source: 'query',
        evidence: 'grounded',
      });
    }

    return this.uniqueSurfaces(surfaces).slice(0, maxSurfaces);
  }

  private collectLikelySurfaces(
    impact: any,
    groundedSurfaces: ChangeContractSurface[],
    maxSurfaces: number,
  ): ChangeContractSurface[] {
    const groundedKeys = new Set(groundedSurfaces.map((surface) => createSurfaceKey(surface)));
    const surfaces: ChangeContractSurface[] = [];

    for (const depthKey of Object.keys(impact?.byDepth || {})) {
      const depth = Number.parseInt(depthKey, 10);
      const bucket: EvidenceBucket = depth <= 1 ? 'grounded' : 'strong_inference';

      for (const item of impact?.byDepth?.[depthKey] || []) {
        if (!item?.filePath) continue;
        const surface: ChangeContractSurface = {
          file_path: normalizeRepoPath(item.filePath),
          symbol_name: item.name,
          symbol_uid: item.id,
          kind: item.type,
          reason:
            depth <= 1
              ? `Direct ${String(item.relationType || 'graph').toLowerCase()} edge from the primary anchor reaches this surface.`
              : `A short graph propagation path from the primary anchor reaches this surface within depth ${depth}.`,
          source: 'impact',
          evidence: bucket,
          depth,
        };
        if (!groundedKeys.has(createSurfaceKey(surface))) {
          surfaces.push(surface);
        }
      }
    }

    return this.uniqueSurfaces(surfaces).slice(0, maxSurfaces);
  }

  private collectRecommendedTests(
    repo: RepoHandle,
    groundedSurfaces: ChangeContractSurface[],
    likelySurfaces: ChangeContractSurface[],
    impact: any,
    maxSurfaces: number,
  ): ChangeContractTestTarget[] {
    const tests: ChangeContractTestTarget[] = [];
    const seen = new Set<string>();
    const addTest = (candidate: ChangeContractTestTarget) => {
      const key = `${candidate.kind}::${candidate.file_path || candidate.target}`;
      if (seen.has(key)) return;
      seen.add(key);
      tests.push(candidate);
    };

    for (const depthKey of Object.keys(impact?.byDepth || {})) {
      for (const item of impact?.byDepth?.[depthKey] || []) {
        if (!item?.filePath || !isTestLikePath(item.filePath)) continue;
        addTest({
          target: normalizeRepoPath(item.filePath),
          kind: 'file',
          file_path: normalizeRepoPath(item.filePath),
          reason: 'Direct graph impact reaches this test file from the primary anchor.',
          source: 'impact',
          evidence: 'grounded',
        });
      }
    }

    const repoFiles = this.listTrackedFiles(repo);
    const implementationFiles = [...groundedSurfaces, ...likelySurfaces].map((surface) => surface.file_path);
    const implementationStems = new Set(implementationFiles.map((filePath) => createPathStem(filePath)));

    for (const filePath of repoFiles) {
      if (!isTestLikePath(filePath)) continue;
      const normalized = normalizeRepoPath(filePath);
      const stem = createPathStem(normalized);
      const sameStem = implementationStems.has(stem);
      if (!sameStem) continue;
      addTest({
        target: normalized,
        kind: 'file',
        file_path: normalized,
        reason: 'A tracked test file shares the same implementation stem as one of the recovered edit surfaces.',
        source: 'adjacent_test',
        evidence: 'strong_inference',
      });
    }

    const impactedProcesses = Array.isArray(impact?.affected_processes) ? impact.affected_processes.slice(0, 4) : [];
    for (const process of impactedProcesses) {
      addTest({
        target: process.name,
        kind: 'process',
        reason: 'This process is already touched by the primary anchor and should be exercised during verification.',
        source: 'impact_process',
        evidence: 'strong_inference',
      });
    }

    return tests.slice(0, maxSurfaces);
  }

  private collectRiskNotes(
    primaryAnchor: ChangeContractSurface,
    impact: any,
  ): Array<{ level: 'low' | 'medium' | 'high' | 'critical' | 'unknown'; summary: string; reason: string; source: 'impact'; evidence: EvidenceBucket }> {
    const notes: Array<{ level: 'low' | 'medium' | 'high' | 'critical' | 'unknown'; summary: string; reason: string; source: 'impact'; evidence: EvidenceBucket }> = [];

    if (impact?.risk_split?.summary_line) {
      notes.push({
        level: this.normalizeRiskLevel(impact.risk),
        summary: String(impact.risk_split.summary_line),
        reason: `Impact analysis for ${primaryAnchor.symbol_name || path.basename(primaryAnchor.file_path)} produced a direct risk split from current graph evidence.`,
        source: 'impact',
        evidence: impact?.coverage?.confidence === 'grounded' ? 'grounded' : 'strong_inference',
      });
    }

    if (impact?.coverage?.note) {
      notes.push({
        level: impact?.coverage?.confidence === 'partial' ? 'medium' : 'low',
        summary: String(impact.coverage.note),
        reason: 'The impact engine reported bounded coverage and propagation limits for this anchor.',
        source: 'impact',
        evidence: 'strong_inference',
      });
    }

    if ((impact?.affected_processes?.length || 0) === 0 && (impact?.affected_modules?.length || 0) === 0) {
      notes.push({
        level: 'unknown',
        summary: 'Higher-level process or module propagation was not strongly grounded for the current anchor.',
        reason: 'This contract can still identify likely edit surfaces, but downstream architectural reach remains bounded.',
        source: 'impact',
        evidence: 'hypothesis',
      });
    }

    return notes;
  }

  private collectUnknowns(queryResult: any, impact: any, recommendedTests: ChangeContractTestTarget[]): string[] {
    const unknowns: string[] = [];

    if ((queryResult?.processes?.length || 0) === 0) {
      unknowns.push('No grounded process ranking was recovered for this goal; process coverage may be sparse.');
    }
    if (impact?.coverage?.confidence && impact.coverage.confidence !== 'grounded') {
      unknowns.push(`Impact coverage is ${impact.coverage.confidence}, so some dependent surfaces may still be missing.`);
    }
    if (recommendedTests.length === 0) {
      unknowns.push('No grounded or stem-matched test target was recovered from the current repo state.');
    }

    return unknowns;
  }

  private listTrackedFiles(repo: RepoHandle): string[] {
    try {
      const output = execFileSync('git', ['ls-files'], {
        cwd: repo.repoPath,
        encoding: 'utf-8',
      });
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => normalizeRepoPath(line));
    } catch {
      return [];
    }
  }

  private normalizeRiskLevel(risk: unknown): 'low' | 'medium' | 'high' | 'critical' | 'unknown' {
    const normalized = String(risk || '').toLowerCase();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'high') return 'high';
    if (normalized === 'medium') return 'medium';
    if (normalized === 'low') return 'low';
    return 'unknown';
  }

  private uniqueSurfaces(surfaces: ChangeContractSurface[]): ChangeContractSurface[] {
    const seen = new Set<string>();
    const unique: ChangeContractSurface[] = [];
    for (const surface of surfaces) {
      const key = createSurfaceKey(surface);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(surface);
    }
    return unique;
  }
}
