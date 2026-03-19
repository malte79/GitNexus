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

type ChangeTaskIntent = 'command' | 'tool' | 'test' | 'guard' | 'runtime' | 'local_backend';

export class LocalBackendChangeEvidenceSupport {
  constructor(private readonly host: LocalBackendAnalysisHost) {}

  async collectEvidence(
    repo: RepoHandle,
    params: { goal: string; task_context?: string; max_surfaces: number },
  ): Promise<ChangeEvidenceBundle> {
    await this.host.ensureInitialized(repo.id);
    const intents = this.detectTaskIntents(params.goal);
    const trackedFiles = this.listTrackedFiles(repo);

    const queryResult = await this.host.querySearch(repo, {
      query: params.goal,
      task_context: params.task_context,
      goal: params.goal,
      owners: true,
      limit: Math.max(3, Math.min(params.max_surfaces, 8)),
      max_symbols: Math.max(6, params.max_surfaces * 3),
    });

    const queryGroundedSurfaces = this.collectGroundedSurfaces(queryResult, params.max_surfaces * 2);
    const intentHintSurfaces = this.collectIntentHintSurfaces(trackedFiles, intents, params.goal, queryGroundedSurfaces);
    const groundedSurfaces = this.rankSurfaces(
      [...queryGroundedSurfaces, ...intentHintSurfaces],
      intents,
      params.goal,
    ).slice(0, params.max_surfaces);
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
    const recommendedTests = this.collectRecommendedTests(
      trackedFiles,
      groundedSurfaces,
      likelySurfaces,
      impact,
      intents,
      params.goal,
      params.max_surfaces,
    );
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
    repoFiles: string[],
    groundedSurfaces: ChangeContractSurface[],
    likelySurfaces: ChangeContractSurface[],
    impact: any,
    intents: Set<ChangeTaskIntent>,
    goal: string,
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

    for (const hintedTest of this.collectIntentHintTests(repoFiles, intents, goal)) {
      addTest(hintedTest);
    }

    return tests.slice(0, maxSurfaces);
  }

  private detectTaskIntents(goal: string): Set<ChangeTaskIntent> {
    const intents = new Set<ChangeTaskIntent>();
    const normalized = goal.toLowerCase();
    if (/\b(command|cli)\b/.test(normalized)) intents.add('command');
    if (/\b(tool|mcp|agent-facing)\b/.test(normalized)) intents.add('tool');
    if (/\b(test|tests)\b/.test(normalized)) intents.add('test');
    if (/\b(guard|structure test|monolith)\b/.test(normalized)) intents.add('guard');
    if (/\bruntime\b/.test(normalized)) intents.add('runtime');
    if (/\blocal backend\b/.test(normalized)) intents.add('local_backend');
    return intents;
  }

  private collectIntentHintSurfaces(
    repoFiles: string[],
    intents: Set<ChangeTaskIntent>,
    goal: string,
    groundedSurfaces: ChangeContractSurface[],
  ): ChangeContractSurface[] {
    const hints: ChangeContractSurface[] = [];
    const addHint = (filePath: string, reason: string) => {
      const normalized = normalizeRepoPath(filePath);
      if (!repoFiles.includes(normalized)) return;
      hints.push({
        file_path: normalized,
        reason,
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    };

    if (intents.has('command')) {
      addHint('src/cli/index.ts', 'The goal is explicitly about adding a CLI command, so the command-registration seam is likely involved.');
      addHint('src/cli/mcp-command-client.ts', 'The goal mentions routing through the MCP HTTP runtime, so the CLI MCP transport seam is likely involved.');
    }
    if (intents.has('tool')) {
      addHint('src/mcp/tools.ts', 'The goal is explicitly about adding a tool, so MCP tool registration is likely involved.');
      addHint('src/mcp/server.ts', 'The goal is explicitly about an MCP tool, so the server-side tool exposure seam is likely involved.');
      addHint('src/mcp/local/local-backend-analysis-support.ts', 'The goal mentions reusing Local Backend analysis seams, so the analysis seam is likely involved.');
    }
    if (intents.has('guard') || intents.has('test')) {
      if (intents.has('local_backend') || groundedSurfaces.some((surface) => surface.file_path.includes('src/mcp/local/'))) {
        addHint('test/unit/local-backend-structure.test.ts', 'The goal is about a Local Backend guard or test, so the structural guard test seam is likely involved.');
        addHint('src/mcp/local/local-backend-analysis-support.ts', 'The goal is about preventing Local Backend analysis regrowth, so the guarded analysis seam is likely involved.');
      }
    }
    if (intents.has('runtime') && !intents.has('command')) {
      addHint('src/server/mcp-http.ts', 'The goal mentions runtime behavior, so the MCP HTTP runtime seam is likely involved.');
    }

    return this.uniqueSurfaces(hints);
  }

  private collectIntentHintTests(
    repoFiles: string[],
    intents: Set<ChangeTaskIntent>,
    goal: string,
  ): ChangeContractTestTarget[] {
    const tests: ChangeContractTestTarget[] = [];
    const addTest = (filePath: string, reason: string) => {
      const normalized = normalizeRepoPath(filePath);
      if (!repoFiles.includes(normalized)) return;
      tests.push({
        target: normalized,
        kind: 'file',
        file_path: normalized,
        reason,
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    };

    if (intents.has('command')) {
      addTest('test/unit/cli-commands.test.ts', 'The goal is explicitly about a CLI command, so the CLI command registration test suite is likely relevant.');
    }
    if (intents.has('tool')) {
      addTest('test/unit/tools.test.ts', 'The goal is explicitly about an MCP tool, so the MCP tool contract test suite is likely relevant.');
    }
    if ((intents.has('guard') || intents.has('test')) && (intents.has('local_backend') || /\blocal backend\b/i.test(goal))) {
      addTest('test/unit/local-backend-structure.test.ts', 'The goal is a Local Backend guard or test, so the Local Backend structural guard test is likely relevant.');
    }

    return tests;
  }

  private rankSurfaces(
    surfaces: ChangeContractSurface[],
    intents: Set<ChangeTaskIntent>,
    goal: string,
  ): ChangeContractSurface[] {
    return this.uniqueSurfaces(surfaces)
      .map((surface, index) => ({
        surface,
        index,
        score: this.scoreSurface(surface, intents, goal),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.surface);
  }

  private scoreSurface(surface: ChangeContractSurface, intents: Set<ChangeTaskIntent>, goal: string): number {
    const filePath = normalizeRepoPath(surface.file_path).toLowerCase();
    const goalText = goal.toLowerCase();
    let score = 0;

    if (surface.evidence === 'grounded') score += 50;
    if (surface.source === 'intent_hint') score += 25;
    if (surface.symbol_uid) score += 5;
    if (surface.symbol_name) score += 5;

    if (intents.has('command')) {
      if (filePath === 'src/cli/index.ts') score += 120;
      if (filePath === 'src/cli/mcp-command-client.ts') score += 90;
      if (filePath.startsWith('src/cli/')) score += 35;
      if (filePath.includes('local-backend-search-') || filePath.includes('summary-presentation') || filePath.includes('runtime-support')) score -= 35;
    }

    if (intents.has('tool')) {
      if (filePath === 'src/mcp/tools.ts') score += 120;
      if (filePath === 'src/mcp/server.ts') score += 110;
      if (filePath === 'src/mcp/local/local-backend-analysis-support.ts') score += 100;
      if (filePath.startsWith('src/mcp/')) score += 30;
      if (filePath.includes('search-lookup') || filePath.includes('search-ranking') || filePath.includes('summary-presentation')) score -= 40;
      if (filePath.startsWith('src/core/')) score -= 30;
    }

    if (intents.has('guard') || intents.has('test')) {
      if (filePath === 'test/unit/local-backend-structure.test.ts') score += 130;
      if (isTestLikePath(filePath)) score += 70;
      if (filePath === 'src/mcp/local/local-backend-analysis-support.ts') score += 95;
      if (filePath.includes('search-lookup') || filePath.includes('search-ranking')) score -= 30;
    }

    if (intents.has('local_backend') && filePath.includes('local-backend')) score += 10;
    if (goalText.includes('analysis') && filePath.includes('analysis-support')) score += 30;
    if (goalText.includes('runtime') && (filePath.includes('mcp-command-client') || filePath.includes('mcp-http'))) score += 20;

    return score;
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
