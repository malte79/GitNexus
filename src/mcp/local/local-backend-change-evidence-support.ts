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

type ChangeTaskIntent =
  | 'planning'
  | 'command'
  | 'tool'
  | 'test'
  | 'guard'
  | 'runtime'
  | 'local_backend'
  | 'qa'
  | 'security'
  | 'rename'
  | 'trustworthiness'
  | 'flattening'
  | 'repo_matching'
  | 'ranking'
  | 'graph_recovery'
  | 'ingestion'
  | 'call_resolution';

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

    const concentratedCompanions = await this.collectConcentratedLikelyCompanions(
      repo,
      trackedFiles,
      primaryAnchor,
      groundedSurfaces,
      impact,
      params.goal,
      params.max_surfaces,
    );
    const likelySurfaces = this.uniqueSurfaces([
      ...this.collectLikelySurfaces(impact, groundedSurfaces, params.max_surfaces),
      ...concentratedCompanions,
    ]).slice(0, params.max_surfaces);
    const recommendedTests = this.collectRecommendedTests(
      trackedFiles,
      primaryAnchor,
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
    primaryAnchor: ChangeContractSurface,
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

    for (const hintedTest of this.collectIntentHintTests(repoFiles, intents, goal)) {
      addTest(hintedTest);
    }

    for (const companionTest of this.collectConcentratedCompanionTests(
      repoFiles,
      primaryAnchor,
      impact,
      goal,
      groundedSurfaces,
      likelySurfaces,
    )) {
      addTest(companionTest);
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

    return tests.slice(0, maxSurfaces);
  }

  private async collectConcentratedLikelyCompanions(
    repo: RepoHandle,
    repoFiles: string[],
    primaryAnchor: ChangeContractSurface,
    groundedSurfaces: ChangeContractSurface[],
    impact: any,
    goal: string,
    maxSurfaces: number,
  ): Promise<ChangeContractSurface[]> {
    if (!this.shouldRecoverConcentratedCompanions(impact)) {
      return [];
    }

    const familyTerms = this.getCompanionFamilyTerms(primaryAnchor, goal);
    const anchorPath = normalizeRepoPath(primaryAnchor.file_path);
    const anchorDir = path.posix.dirname(anchorPath);
    const anchorParentDir = path.posix.dirname(anchorDir);
    const existing = new Set(groundedSurfaces.map((surface) => createSurfaceKey(surface)));
    const nearbyCompanions: Array<{ surface: ChangeContractSurface; score: number }> = [];
    const hotspotCompanions: Array<{ surface: ChangeContractSurface; score: number }> = [];
    const addCompanion = (
      surface: ChangeContractSurface,
      score: number,
      bucket: 'nearby' | 'hotspot' = 'nearby',
    ) => {
      const normalizedSurface = {
        ...surface,
        file_path: normalizeRepoPath(surface.file_path),
      };
      const key = createSurfaceKey(normalizedSurface);
      if (existing.has(key)) return;
      existing.add(key);
      (bucket === 'hotspot' ? hotspotCompanions : nearbyCompanions).push({ surface: normalizedSurface, score });
    };

    for (const filePath of repoFiles) {
      const normalized = normalizeRepoPath(filePath);
      if (
        normalized === anchorPath ||
        this.isDocLikePath(normalized) ||
        isTestLikePath(normalized)
      ) {
        continue;
      }
      const score = this.scoreConcentratedCompanionPath(
        normalized,
        anchorPath,
        anchorDir,
        anchorParentDir,
        familyTerms,
      );
      if (score < 70) continue;

      addCompanion({
        file_path: normalized,
        reason: this.describeConcentratedCompanionReason(normalized, anchorPath),
        source: 'owner_overlap',
        evidence: 'strong_inference',
      }, score);
    }

    for (const hotspot of impact?.shape?.file?.largest_members?.slice(0, 2) || []) {
      if (!hotspot?.name) continue;
      addCompanion({
        file_path: anchorPath,
        symbol_name: hotspot.name,
        kind: hotspot.kind,
        reason: `Shape analysis shows ${hotspot.name} as a concentrated same-file hotspot within the primary owner.`,
        source: 'impact',
        evidence: 'grounded',
      }, 140 + (hotspot.line_count || 0), 'hotspot');
    }

    const docCompanions = await this.collectConcentratedDocCompanions(
      repo,
      repoFiles,
      primaryAnchor,
      groundedSurfaces,
      goal,
      familyTerms,
      maxSurfaces,
    );

    const rankedNearby = nearbyCompanions
      .sort((left, right) => right.score - left.score || left.surface.file_path.localeCompare(right.surface.file_path))
      .map((entry) => entry.surface);
    const rankedHotspots = hotspotCompanions
      .sort((left, right) => right.score - left.score || left.surface.file_path.localeCompare(right.surface.file_path))
      .map((entry) => entry.surface)
      .slice(0, 1);

    return this.uniqueSurfaces([
      ...docCompanions,
      ...rankedHotspots,
      ...rankedNearby,
    ])
      .slice(0, maxSurfaces);
  }

  private collectConcentratedCompanionTests(
    repoFiles: string[],
    primaryAnchor: ChangeContractSurface,
    impact: any,
    goal: string,
    groundedSurfaces: ChangeContractSurface[],
    likelySurfaces: ChangeContractSurface[],
  ): ChangeContractTestTarget[] {
    if (!this.shouldRecoverConcentratedCompanions(impact)) {
      return [];
    }

    const familyTerms = this.getCompanionFamilyTerms(primaryAnchor, goal);
    const knownPaths = new Set(
      [...groundedSurfaces, ...likelySurfaces].map((surface) => normalizeRepoPath(surface.file_path)),
    );
    return repoFiles
      .filter((filePath) => isTestLikePath(filePath))
      .map((filePath) => {
        const normalized = normalizeRepoPath(filePath);
        let score = this.countFileTermOverlap(normalized, familyTerms) * 18;
        if (/\b(spec|test|testing)\b/i.test(this.tokenizeGoalValue(normalized).join(' '))) {
          score += 12;
        }
        if ([...knownPaths].some((knownPath) => this.countSharedFamilyTerms(normalized, knownPath) >= 2)) {
          score += 10;
        }
        return { normalized, score };
      })
      .filter((candidate) => candidate.score >= 40)
      .sort((left, right) => right.score - left.score || left.normalized.localeCompare(right.normalized))
      .slice(0, 3)
      .map((candidate) => ({
        target: candidate.normalized,
        kind: 'file' as const,
        file_path: candidate.normalized,
        reason: 'This tracked spec or test file shares the same concentrated subsystem terms as the primary owner.',
        source: 'owner_overlap' as const,
        evidence: 'strong_inference' as const,
      }));
  }

  private detectTaskIntents(goal: string): Set<ChangeTaskIntent> {
    const intents = new Set<ChangeTaskIntent>();
    const normalized = goal.toLowerCase();
    if (/\b(command|cli)\b/.test(normalized)) intents.add('command');
    if (/\b(tool|agent-facing)\b/.test(normalized)) intents.add('tool');
    if (/\b(test|tests)\b/.test(normalized)) intents.add('test');
    if (/\b(guard|structure test|monolith)\b/.test(normalized)) intents.add('guard');
    if (/\bruntime\b/.test(normalized)) intents.add('runtime');
    if (/\blocal backend\b/.test(normalized)) intents.add('local_backend');
    if (/\b(plan|planning|split|reduce|refactor|authority concentration|truth-family concentration)\b/.test(normalized)) intents.add('planning');
    if (/\b(regression|tested|test needed|test needs|highest-value regression checks)\b/.test(normalized)) intents.add('qa');
    if (/\b(security|security-sensitive|boundary|boundaries)\b/.test(normalized)) intents.add('security');
    if (/\b(rename|identity rename|state-dir|coordinated rename)\b/.test(normalized)) intents.add('rename');
    if (/\b(trustworthy|trustworthiness|overclaim certainty|overconfidence|contract defects)\b/.test(normalized)) intents.add('trustworthiness');
    if (/\b(flattening|nested package paths|root dist path|package paths)\b/.test(normalized)) intents.add('flattening');
    if (/\brepo matching\b/.test(normalized)) intents.add('repo_matching');
    if (/\branking\b/.test(normalized)) intents.add('ranking');
    if (/\bgraph recovery\b/.test(normalized)) intents.add('graph_recovery');
    if (/\bingestion\b/.test(normalized)) intents.add('ingestion');
    if (/\bcall resolution\b/.test(normalized)) intents.add('call_resolution');
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
    if (intents.has('planning') && intents.has('local_backend') && intents.has('ranking')) {
      addHint('src/mcp/local/local-backend-search-ranking-support.ts', 'The goal is about Local Backend ranking authority, so the ranking seam is likely involved.');
    }
    if (intents.has('planning') && intents.has('local_backend') && intents.has('graph_recovery')) {
      addHint('src/mcp/local/local-backend-graph-support.ts', 'The goal is about Local Backend graph recovery, so the graph seam is likely involved.');
    }
    if (intents.has('planning') && intents.has('ingestion') && intents.has('call_resolution')) {
      addHint('src/core/ingestion/call-processor.ts', 'The goal is about call resolution in ingestion, so the call-processing seam is likely involved.');
      addHint('src/core/ingestion/symbol-table.ts', 'The goal is about call-resolution truth concentration, so same-file symbol ownership is likely involved.');
    }
    if (intents.has('qa') && intents.has('rename')) {
      addHint('src/storage/repo-manager.ts', 'The goal is about regression checks for rename and state-dir work, so repo state ownership is likely involved.');
      addHint('src/server/service-runtime.ts', 'The goal is about runtime identity rename work, so the runtime service seam is likely involved.');
    }
    if (intents.has('qa') && intents.has('trustworthiness')) {
      addHint('test/unit/tools.test.ts', 'The goal is about plan-change and verify-change regression tests, so the MCP tool contract tests are likely involved.');
      addHint('test/unit/cli-commands.test.ts', 'The goal is about plan-change and verify-change regression tests, so the CLI command contract tests are likely involved.');
      addHint('test/unit/local-backend-structure.test.ts', 'The goal is about keeping the planner trustworthy, so the Local Backend structural guard test is likely involved.');
    }
    if (intents.has('flattening')) {
      addHint('scripts/run-integration-tests.sh', 'The goal is about proving old nested package paths are gone, so the integration wrapper script is likely involved.');
      addHint('src/server/service-runtime.ts', 'The goal is about stale nested-package launch paths, so the runtime launcher seam is likely involved.');
      addHint('README.md', 'The goal is about old nested package paths lingering, so public install and build docs are likely involved.');
    }
    if (intents.has('security') && (intents.has('runtime') || intents.has('repo_matching') || /\bover http startup\b/i.test(goal))) {
      addHint('src/cli/mcp-command-client.ts', 'The goal is about repo-local MCP startup and repo matching, so the CLI-to-runtime boundary is likely involved.');
      addHint('src/server/service-runtime.ts', 'The goal is about repo-local MCP startup and repo matching, so the runtime service boundary is likely involved.');
      addHint('src/storage/repo-manager.ts', 'The goal is about repo matching and storage identity, so repo-state ownership is likely involved.');
    }
    if (intents.has('trustworthiness')) {
      addHint('src/mcp/local/local-backend-change-contract-support.ts', 'The goal is about planner truthfulness, so the contract assembly seam is likely involved.');
      addHint('src/mcp/local/local-backend-verify-change-support.ts', 'The goal is about planner truthfulness, so verification mismatch handling is likely involved.');
      addHint('docs/cli/commands.md', 'The goal is about overclaim certainty, so the documented user-facing confidence contract is likely involved.');
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
      tests.push({
        target: 'npm test',
        kind: 'command',
        reason: 'The goal is explicitly about a CLI command, so the unit suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }
    if (intents.has('tool')) {
      addTest('test/unit/tools.test.ts', 'The goal is explicitly about an MCP tool, so the MCP tool contract test suite is likely relevant.');
      tests.push({
        target: 'npm test',
        kind: 'command',
        reason: 'The goal is explicitly about an MCP tool, so the unit suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
      tests.push({
        target: 'npm run test:integration',
        kind: 'command',
        reason: 'The goal is explicitly about an MCP tool, so integration coverage should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }
    if ((intents.has('guard') || intents.has('test')) && (intents.has('local_backend') || /\blocal backend\b/i.test(goal))) {
      addTest('test/unit/local-backend-structure.test.ts', 'The goal is a Local Backend guard or test, so the Local Backend structural guard test is likely relevant.');
      tests.push({
        target: 'npm test',
        kind: 'command',
        reason: 'The goal is a Local Backend structural guard, so the unit suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }
    if (intents.has('planning')) {
      tests.push({
        target: 'npm test',
        kind: 'command',
        reason: 'The goal is a planning/refactor surface, so the unit suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
      if (intents.has('runtime') || intents.has('rename') || intents.has('ingestion') || intents.has('call_resolution')) {
        tests.push({
          target: 'npm run test:integration',
          kind: 'command',
          reason: 'The goal touches shared runtime or ingestion behavior, so integration coverage should be exercised explicitly.',
          source: 'intent_hint',
          evidence: 'strong_inference',
        });
      }
    }
    if (intents.has('qa') && intents.has('trustworthiness')) {
      addTest('test/unit/tools.test.ts', 'The goal is about planner regression tests, so the MCP tool contract tests are likely relevant.');
      addTest('test/unit/cli-commands.test.ts', 'The goal is about planner regression tests, so the CLI command contract tests are likely relevant.');
    }
    if (intents.has('flattening')) {
      tests.push({
        target: 'npm run test:integration',
        kind: 'command',
        reason: 'The goal is about stale nested package paths, so the integration wrapper command should be exercised.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
      tests.push({
        target: 'npm run build',
        kind: 'command',
        reason: 'The goal is about stale nested package paths, so the root build command should be exercised.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }
    if (intents.has('qa') && intents.has('rename')) {
      tests.push({
        target: 'npm test',
        kind: 'command',
        reason: 'The goal is about coordinated rename regression checks, so the unit suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
      tests.push({
        target: 'gnexus manage status',
        kind: 'command',
        reason: 'The goal is about runtime identity rename checks, so repo status should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
      tests.push({
        target: 'npm run test:integration',
        kind: 'command',
        reason: 'The goal is about runtime identity rename checks, so integration coverage should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }
    if (intents.has('trustworthiness')) {
      tests.push({
        target: 'npm test',
        kind: 'command',
        reason: 'The goal is about planner truthfulness, so the unit test suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
      tests.push({
        target: 'node scripts/run-change-contract-benchmark.ts --fixtures test/fixtures/change-contract-benchmark',
        kind: 'command',
        reason: 'The goal is about planner overconfidence, so the benchmark trustworthiness harness is likely relevant.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }
    if (intents.has('security') && (intents.has('runtime') || intents.has('repo_matching') || /\bover http startup\b/i.test(goal))) {
      tests.push({
        target: 'npm run test:integration',
        kind: 'command',
        reason: 'The goal is about runtime security boundaries, so the integration suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
      tests.push({
        target: 'gnexus manage status',
        kind: 'command',
        reason: 'The goal is about repo-local runtime trust boundaries, so runtime status should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }
    if (intents.has('security') && intents.has('rename')) {
      tests.push({
        target: 'npm test',
        kind: 'command',
        reason: 'The goal is about a security-sensitive rename surface, so the unit suite should be exercised explicitly.',
        source: 'intent_hint',
        evidence: 'strong_inference',
      });
    }

    return tests;
  }

  private rankSurfaces(
    surfaces: ChangeContractSurface[],
    intents: Set<ChangeTaskIntent>,
    goal: string,
  ): ChangeContractSurface[] {
    const broadGoalTerms = this.getBroadGoalTerms(goal);
    return this.uniqueSurfaces(surfaces)
      .map((surface, index) => ({
        surface,
        index,
        score: this.scoreSurface(surface, intents, goal, broadGoalTerms),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.surface);
  }

  private scoreSurface(
    surface: ChangeContractSurface,
    intents: Set<ChangeTaskIntent>,
    goal: string,
    broadGoalTerms: string[],
  ): number {
    const filePath = normalizeRepoPath(surface.file_path).toLowerCase();
    const goalText = goal.toLowerCase();
    let score = 0;

    if (surface.evidence === 'grounded') score += 50;
    if (surface.source === 'intent_hint') score += 25;
    if (surface.symbol_uid) score += 5;
    if (surface.symbol_name) score += 5;

    const broadMatch = this.computeBroadGoalMatch(surface, broadGoalTerms);
    score += broadMatch.matchWeight * 10;
    score += broadMatch.sourceAgreement * 4;
    if (broadGoalTerms.length >= 2 && this.isOwnerLikeSurface(surface.kind) && broadMatch.matchCount >= 1) {
      score += 26;
    }
    if (broadGoalTerms.length >= 2 && this.isOwnerLikeSurface(surface.kind) && broadMatch.matchCount >= 2) {
      score += 24 + ((broadMatch.matchCount - 2) * 6);
    }
    if (broadGoalTerms.length >= 2 && this.isFunctionLikeSurface(surface.kind)) {
      score -= 8;
    }
    if (broadGoalTerms.length >= 2 && this.isFunctionLikeSurface(surface.kind) && broadMatch.matchCount <= 1) {
      score -= 20;
    }
    if (broadGoalTerms.length >= 2 && this.isFunctionLikeSurface(surface.kind) && broadMatch.matchCount === 0) {
      score -= 15;
    }
    if (
      broadGoalTerms.length >= 2 &&
      /(^|\/)(playtest|scenario|scenarios|sandbox|examples?)(\/|$)/i.test(filePath) &&
      !this.goalExplicitlyTargetsAncillarySurface(goal)
    ) {
      score -= 48;
    }

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
    if (intents.has('qa') && intents.has('rename')) {
      if (filePath === 'src/storage/repo-manager.ts') score += 140;
      if (filePath === 'src/server/service-runtime.ts') score += 130;
      if (filePath === 'src/cli/index.ts') score += 110;
    }
    if (intents.has('qa') && intents.has('trustworthiness')) {
      if (filePath === 'test/unit/tools.test.ts') score += 150;
      if (filePath === 'test/unit/cli-commands.test.ts') score += 145;
      if (filePath === 'test/unit/local-backend-structure.test.ts') score += 140;
      if (filePath.includes('repo-manager') || filePath.startsWith('src/storage/')) score -= 40;
    }
    if (intents.has('flattening')) {
      if (filePath === 'scripts/run-integration-tests.sh') score += 170;
      if (filePath === 'src/server/service-runtime.ts') score += 150;
      if (filePath === 'readme.md') score += 145;
      if (filePath.startsWith('src/core/ingestion/')) score -= 70;
      if (filePath.startsWith('src/mcp/local/')) score -= 30;
    }
    if (intents.has('security') && (intents.has('runtime') || intents.has('repo_matching') || /\bover http startup\b/.test(goalText))) {
      if (filePath === 'src/cli/mcp-command-client.ts') score += 165;
      if (filePath === 'src/server/service-runtime.ts') score += 160;
      if (filePath === 'src/storage/repo-manager.ts') score += 155;
      if (filePath === 'src/mcp/tools.ts' || filePath === 'src/mcp/server.ts') score -= 60;
      if (filePath.includes('local-backend-graph-support') || filePath.includes('search-query-support')) score -= 80;
    }
    if (intents.has('trustworthiness')) {
      if (filePath === 'src/mcp/local/local-backend-change-contract-support.ts') score += 175;
      if (filePath === 'src/mcp/local/local-backend-verify-change-support.ts') score += 165;
      if (filePath === 'docs/cli/commands.md') score += 255;
      if (filePath.includes('summary-presentation') || filePath.includes('graph-support')) score -= 60;
    }
    if (intents.has('planning') && intents.has('local_backend') && intents.has('ranking')) {
      if (filePath === 'src/mcp/local/local-backend-search-ranking-support.ts') score += 160;
      if (filePath === 'src/mcp/local/local-backend-search-query-support.ts') score -= 40;
    }
    if (intents.has('planning') && intents.has('local_backend') && intents.has('graph_recovery')) {
      if (filePath === 'src/mcp/local/local-backend-graph-support.ts') score += 170;
      if (filePath.includes('summary-presentation') || filePath.includes('runtime-support')) score -= 50;
    }
    if (intents.has('planning') && intents.has('ingestion') && intents.has('call_resolution')) {
      if (filePath === 'src/core/ingestion/call-processor.ts') score += 160;
      if (filePath === 'src/core/ingestion/symbol-table.ts') score += 155;
      if (filePath === 'src/core/ingestion/pipeline-support.ts' || filePath === 'src/core/ingestion/parsing-processor.ts') score -= 30;
    }

    return score;
  }

  private getBroadGoalTerms(goal: string): string[] {
    const stopwords = new Set([
      'a', 'all', 'allowing', 'along', 'always', 'and', 'at', 'away', 'back', 'be', 'default', 'end', 'for', 'forth',
      'from', 'in', 'into', 'its', 'make', 'of', 'on', 'or', 'own', 'pause', 'preserving', 'the', 'their', 'times',
      'to', 'top', 'up', 'with',
    ]);
    const sourceTerms = this.tokenizeGoalValue(goal)
      .filter(Boolean)
      .flatMap((term) => this.getGoalTokenVariants(term))
      .filter((term) => term.length >= 4 && !stopwords.has(term));
    return [...new Set(sourceTerms)];
  }

  private getGoalTokenVariants(term: string): string[] {
    const normalized = term.trim().toLowerCase();
    if (!normalized) return [];
    const variants = new Set<string>([normalized]);
    if (normalized.endsWith('ies') && normalized.length > 4) {
      variants.add(`${normalized.slice(0, -3)}y`);
    }
    if (normalized.endsWith('es') && normalized.length > 4) {
      variants.add(normalized.slice(0, -2));
    }
    if (normalized.endsWith('s') && normalized.length > 3) {
      variants.add(normalized.slice(0, -1));
    }
    return [...variants].filter(Boolean);
  }

  private computeBroadGoalMatch(
    surface: ChangeContractSurface,
    broadGoalTerms: string[],
  ): { matchCount: number; matchWeight: number; sourceAgreement: number } {
    if (broadGoalTerms.length === 0) {
      return { matchCount: 0, matchWeight: 0, sourceAgreement: 0 };
    }

    const tokenSources = [
      surface.symbol_name || '',
      surface.kind || '',
      surface.module || '',
      normalizeRepoPath(surface.file_path),
    ]
      .filter(Boolean)
      .map((value) => new Set(
        this.tokenizeGoalValue(value)
          .filter(Boolean)
          .flatMap((token) => this.getGoalTokenVariants(token)),
      ));

    let matchCount = 0;
    let sourceAgreement = 0;
    for (const term of broadGoalTerms) {
      const matches = tokenSources.filter((tokens) => tokens.has(term)).length;
      if (matches > 0) {
        matchCount += 1;
        sourceAgreement += Math.max(0, matches - 1);
      }
    }

    return {
      matchCount,
      matchWeight: matchCount,
      sourceAgreement,
    };
  }

  private isOwnerLikeSurface(kind?: string): boolean {
    return kind === 'Module' || kind === 'Class' || kind === 'File';
  }

  private isFunctionLikeSurface(kind?: string): boolean {
    return kind === 'Method' || kind === 'Function';
  }

  private tokenizeGoalValue(value: string): string[] {
    return value
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[_./-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  private goalExplicitlyTargetsAncillarySurface(goal: string): boolean {
    return this.tokenizeGoalValue(goal).some((token) => (
      token === 'playtest' ||
      token === 'scenario' ||
      token === 'scenarios' ||
      token === 'sandbox' ||
      token === 'example' ||
      token === 'examples'
    ));
  }

  private isConcentratedOwnerImpact(impact: any): boolean {
    const concentration = String(impact?.shape?.file?.concentration || impact?.risk_dimensions?.internal_concentration || '').toLowerCase();
    return concentration === 'high' || concentration === 'critical';
  }

  private shouldRecoverConcentratedCompanions(impact: any): boolean {
    if (!this.isConcentratedOwnerImpact(impact)) {
      return false;
    }

    const impactedCount = typeof impact?.impactedCount === 'number'
      ? impact.impactedCount
      : this.countImpactedSymbols(impact?.byDepth);
    if (impactedCount === 0) {
      return true;
    }

    const propagationSignal = String(impact?.coverage?.signals?.higher_level_propagation || '').toLowerCase();
    const confidence = String(impact?.coverage?.confidence || '').toLowerCase();
    return propagationSignal === 'low' || (propagationSignal === 'medium' && confidence === 'partial');
  }

  private countImpactedSymbols(byDepth: unknown): number {
    if (!byDepth || typeof byDepth !== 'object') {
      return 0;
    }

    return Object.values(byDepth as Record<string, unknown>)
      .reduce<number>((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0);
  }

  private getCompanionFamilyTerms(primaryAnchor: ChangeContractSurface, goal: string): string[] {
    const generic = new Set([
      'client',
      'clients',
      'code',
      'common',
      'component',
      'components',
      'controller',
      'controllers',
      'docs',
      'doc',
      'file',
      'files',
      'game',
      'module',
      'modules',
      'process',
      'server',
      'service',
      'services',
      'shared',
      'spec',
      'src',
      'system',
      'systems',
      'test',
      'tests',
      'unit',
    ]);
    const combined = [
      ...this.getBroadGoalTerms(goal),
      ...this.tokenizeGoalValue(primaryAnchor.symbol_name || ''),
      ...this.tokenizeGoalValue(primaryAnchor.file_path),
    ]
      .filter((term) => term.length >= 4 && !generic.has(term))
      .flatMap((term) => this.getGoalTokenVariants(term));
    return [...new Set(combined)];
  }

  private scoreConcentratedCompanionPath(
    filePath: string,
    anchorPath: string,
    anchorDir: string,
    anchorParentDir: string,
    familyTerms: string[],
  ): number {
    let score = this.countFileTermOverlap(filePath, familyTerms) * 16;
    const fileTokens = new Set(this.tokenizeGoalValue(filePath));
    const candidateDir = path.posix.dirname(filePath);
    if (candidateDir === anchorDir) {
      score += 24;
    } else if (candidateDir.startsWith(`${anchorDir}/`) || anchorDir.startsWith(`${candidateDir}/`)) {
      score += 16;
    } else if (
      candidateDir === anchorParentDir ||
      candidateDir.startsWith(`${anchorParentDir}/`) ||
      anchorParentDir.startsWith(`${candidateDir}/`)
    ) {
      score += 10;
    }
    if (path.extname(filePath) === path.extname(anchorPath)) {
      score += 6;
    }
    if (['state', 'snapshot', 'debug', 'proof', 'profile'].some((token) => fileTokens.has(token))) {
      score += 90;
    }
    if (['runtime', 'controller', 'command', 'discovery', 'adapter', 'service'].some((token) => fileTokens.has(token))) {
      score += 8;
    }
    return score;
  }

  private describeConcentratedCompanionReason(filePath: string, anchorPath: string): string {
    if (/(^|\/|_)(state|snapshot)(\/|_|\.|$)/i.test(filePath)) {
      return 'This nearby state or snapshot surface likely carries proof or debug state for the concentrated primary owner.';
    }
    if (path.posix.dirname(filePath) === path.posix.dirname(anchorPath)) {
      return 'This nearby owner sits beside the concentrated primary file and is a likely companion seam for bounded implementation work.';
    }
    return 'This nearby owner shares the same concentrated subsystem family as the primary anchor and is a plausible companion seam.';
  }

  private async collectConcentratedDocCompanions(
    repo: RepoHandle,
    repoFiles: string[],
    primaryAnchor: ChangeContractSurface,
    groundedSurfaces: ChangeContractSurface[],
    goal: string,
    familyTerms: string[],
    maxSurfaces: number,
  ): Promise<ChangeContractSurface[]> {
    const scored = new Map<string, { surface: ChangeContractSurface; score: number }>();
    const addDoc = (surface: ChangeContractSurface, score: number) => {
      const normalized = normalizeRepoPath(surface.file_path);
      const existing = scored.get(normalized);
      if (!existing || existing.score < score) {
        scored.set(normalized, {
          surface: {
            ...surface,
            file_path: normalized,
            reason: 'A documentation surface overlaps the concentrated owner and goal terms.',
            source: surface.source,
            evidence: surface.evidence,
          },
          score,
        });
      }
    };

    try {
      const queryResult = await this.host.querySearch(repo, {
        query: `${goal} ${primaryAnchor.symbol_name || createPathStem(primaryAnchor.file_path)}`.trim(),
        goal,
        owners: true,
        include_content: true,
        limit: Math.max(4, Math.min(maxSurfaces, 6)),
        max_symbols: Math.max(6, maxSurfaces * 2),
      });
      for (const surface of this.collectGroundedSurfaces(queryResult, maxSurfaces * 2)
        .filter((surface) => this.isDocLikePath(surface.file_path))
      ) {
        addDoc({
          ...surface,
          reason: 'A content-grounded documentation match overlaps the concentrated owner and goal terms.',
          source: 'query',
          evidence: 'grounded',
        }, 220 + (this.countFileTermOverlap(surface.file_path, familyTerms) * 12));
      }
    } catch {
      // fall through to tracked-doc scan
    }

    const docCandidates = repoFiles.filter((filePath) => this.isDocLikePath(filePath));
    const hasConcentratedTests = repoFiles.some((filePath) => (
      isTestLikePath(filePath) && this.countFileTermOverlap(filePath, familyTerms) >= 1
    ));
    for (const filePath of docCandidates) {
      const pathHits = this.countFileTermOverlap(filePath, familyTerms);
      const score =
        (pathHits * 8) +
        this.getDocRoleBoost(filePath, hasConcentratedTests) -
        this.getGenericDocPenalty(filePath);
      if (score < 32) continue;
      addDoc({
        file_path: filePath,
        reason: 'A tracked documentation file aligns with the concentrated owner family and likely lockstep review surfaces.',
        source: 'owner_overlap',
        evidence: 'strong_inference',
      }, 120 + score);
    }

    const ranked = [...scored.values()]
      .sort((left, right) => right.score - left.score || left.surface.file_path.localeCompare(right.surface.file_path));
    const selected: ChangeContractSurface[] = [];
    const takeFirst = (predicate: (surface: ChangeContractSurface) => boolean) => {
      const entry = ranked.find((candidate) => (
        predicate(candidate.surface) &&
        !selected.some((surface) => surface.file_path === candidate.surface.file_path)
      ));
      if (entry) selected.push(entry.surface);
    };

    takeFirst((surface) => normalizeRepoPath(surface.file_path).toLowerCase() === 'docs/process/testing.md');
    takeFirst((surface) => normalizeRepoPath(surface.file_path).toLowerCase().startsWith('docs/systems/'));

    for (const entry of ranked) {
      if (selected.some((surface) => surface.file_path === entry.surface.file_path)) continue;
      selected.push(entry.surface);
      if (selected.length >= 2) break;
    }

    return selected.slice(0, 2);
  }

  private isDocLikePath(filePath: string): boolean {
    const normalized = normalizeRepoPath(filePath).toLowerCase();
    return normalized === 'readme.md' || normalized.startsWith('docs/') || normalized.endsWith('.md');
  }

  private countFileTermOverlap(filePath: string, familyTerms: string[]): number {
    if (familyTerms.length === 0) return 0;
    const tokens = new Set(
      this.tokenizeGoalValue(filePath)
        .filter(Boolean)
        .flatMap((token) => this.getGoalTokenVariants(token)),
    );
    return familyTerms.filter((term) => tokens.has(term)).length;
  }

  private countSharedFamilyTerms(leftFilePath: string, rightFilePath: string): number {
    const leftTokens = new Set(
      this.tokenizeGoalValue(leftFilePath)
        .filter(Boolean)
        .flatMap((token) => this.getGoalTokenVariants(token)),
    );
    const rightTokens = new Set(
      this.tokenizeGoalValue(rightFilePath)
        .filter(Boolean)
        .flatMap((token) => this.getGoalTokenVariants(token)),
    );
    let shared = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        shared += 1;
      }
    }
    return shared;
  }

  private getDocRoleBoost(filePath: string, hasConcentratedTests: boolean): number {
    const normalized = normalizeRepoPath(filePath).toLowerCase();
    let boost = 0;
    if (normalized.startsWith('docs/systems/')) {
      boost += 16;
    }
    if (normalized.startsWith('docs/process/') && hasConcentratedTests) {
      boost += 44;
    }
    if (normalized.endsWith('/testing.md') || normalized === 'docs/process/testing.md') {
      boost += hasConcentratedTests ? 36 : 12;
    }
    return boost;
  }

  private getGenericDocPenalty(filePath: string): number {
    const basenameTokens = this.tokenizeGoalValue(path.posix.basename(normalizeRepoPath(filePath)));
    const weightedGenericTokens = new Map<string, number>([
      ['archive', 18],
      ['branch', 18],
      ['branches', 18],
      ['cheatsheet', 18],
      ['config', 18],
      ['core', 40],
      ['gdd', 18],
      ['overview', 18],
      ['readme', 18],
      ['reference', 18],
      ['runtime', 40],
      ['workflow', 18],
    ]);
    return basenameTokens.reduce((total, token) => total + (weightedGenericTokens.get(token) || 0), 0);
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

    const hotspotNames = (impact?.shape?.file?.largest_members || [])
      .slice(0, 3)
      .map((member: any) => member.name)
      .filter(Boolean);
    if (this.isConcentratedOwnerImpact(impact) && hotspotNames.length > 0) {
      notes.push({
        level: 'medium',
        summary: `Local implementation pressure is concentrated in ${hotspotNames.join(', ')}.`,
        reason: 'Shape analysis found the largest same-file members for this concentrated owner, which are likely insertion or proof points for the requested change.',
        source: 'impact',
        evidence: 'grounded',
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
