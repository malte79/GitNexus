import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendAnalysisHost } from './local-backend-analysis-types.js';
import {
  type ChangeContract,
  type ChangeContractSurface,
  type ChangeContractTestTarget,
  type EvidenceBucket,
  type PlanChangeParams,
  type VerifyChangeParams,
  type VerifyChangeResult,
  createPathStem,
  createSurfaceKey,
  isTestLikePath,
  normalizeRepoPath,
} from './local-backend-change-contract-types.js';
import { LocalBackendChangeContractSupport } from './local-backend-change-contract-support.js';

export class LocalBackendVerifyChangeSupport {
  private readonly planSupport: LocalBackendChangeContractSupport;

  constructor(private readonly host: LocalBackendAnalysisHost) {
    this.planSupport = new LocalBackendChangeContractSupport(host);
  }

  async verifyChange(repo: RepoHandle, params: VerifyChangeParams): Promise<VerifyChangeResult | { error: string }> {
    const contract = await this.loadContract(repo, params);
    if ('error' in contract) {
      return contract;
    }

    const changedFiles = await this.resolveChangedFiles(repo, params);
    const reportedTestTargets = (params.reported_test_targets || []).map((target) => target.trim()).filter(Boolean);
    const normalizedChanged = changedFiles.map((filePath) => normalizeRepoPath(filePath));
    const contractSurfaceKeys = new Set(
      [...contract.required_edit_surfaces, ...contract.likely_dependent_surfaces].map((surface) => createSurfaceKey(surface)),
    );
    const contractCoveredFiles = new Set(
      [...contract.required_edit_surfaces, ...contract.likely_dependent_surfaces].map((surface) => normalizeRepoPath(surface.file_path)),
    );
    const changedSurfaceRecords = normalizedChanged.map((filePath) => ({
      file_path: filePath,
      reason: 'This file is present in the current claimed or detected change set.',
      source: 'reported_change' as const,
      evidence: 'grounded' as const,
    }));

    const missingGrounded = contract.required_edit_surfaces.filter((surface) => {
      if (surface.evidence !== 'grounded') return false;
      return !normalizedChanged.includes(normalizeRepoPath(surface.file_path));
    });

    const unreviewedInferred = contract.likely_dependent_surfaces.filter((surface) => {
      if (surface.evidence === 'hypothesis') return false;
      return !normalizedChanged.includes(normalizeRepoPath(surface.file_path));
    });

    const rawOutOfContract = changedSurfaceRecords
      .filter((surface) => !contractCoveredFiles.has(normalizeRepoPath(surface.file_path)) && !contractSurfaceKeys.has(createSurfaceKey(surface)))
      .map((surface) => ({
        ...surface,
        kind: 'File',
      })) satisfies ChangeContractSurface[];

    const ownerMatches = rawOutOfContract.length > 0
      ? await this.host.getOwnerSymbolsForFiles(repo, rawOutOfContract.map((surface) => surface.file_path))
      : [];
    const contractModuleNames = new Set(contract.affected_modules.map((module) => module.name));
    const contractOwnerNames = new Set([
      ...contract.required_edit_surfaces.map((surface) => surface.symbol_name).filter(Boolean),
      ...contract.likely_dependent_surfaces.map((surface) => surface.symbol_name).filter(Boolean),
    ]);

    const contractInsufficiency: ChangeContractSurface[] = [];
    const outOfContract: ChangeContractSurface[] = [];

    for (const surface of rawOutOfContract) {
      const normalizedFile = normalizeRepoPath(surface.file_path);
      const ownerOverlap = ownerMatches.find((owner: any) =>
        normalizeRepoPath(owner.filePath || '') === normalizedFile
        && (contractModuleNames.has(owner.name) || contractOwnerNames.has(owner.name)),
      );

      if (ownerOverlap) {
        contractInsufficiency.push({
          ...surface,
          reason: 'This changed file belongs to an owner already implicated by the contract, so the contract likely underspecified the real edit surface.',
          source: 'owner_overlap',
          evidence: 'strong_inference',
        });
      } else {
        outOfContract.push(surface);
      }
    }

    const missingRecommendedTests = this.findMissingRecommendedTests(contract.recommended_tests, normalizedChanged, reportedTestTargets);
    const status: VerifyChangeResult['status'] =
      contractInsufficiency.length > 0
        ? 'contract_insufficiency'
        : (missingGrounded.length || unreviewedInferred.length || outOfContract.length || missingRecommendedTests.length)
          ? 'attention'
          : 'ok';

    return {
      goal: contract.goal,
      status,
      contract,
      changed_files: normalizedChanged,
      reported_test_targets: reportedTestTargets,
      mismatches: {
        missing_grounded_surfaces: missingGrounded,
        unreviewed_inferred_surfaces: unreviewedInferred,
        out_of_contract_touched_surfaces: outOfContract,
        missing_recommended_tests: missingRecommendedTests,
        contract_insufficiency: contractInsufficiency,
      },
      summary: {
        changed_file_count: normalizedChanged.length,
        missing_grounded_count: missingGrounded.length,
        unreviewed_inferred_count: unreviewedInferred.length,
        out_of_contract_count: outOfContract.length,
        missing_recommended_test_count: missingRecommendedTests.length,
        contract_insufficiency_count: contractInsufficiency.length,
      },
    };
  }

  private async loadContract(repo: RepoHandle, params: VerifyChangeParams): Promise<ChangeContract | { error: string }> {
    if (params.contract_json?.trim()) {
      try {
        const parsed = JSON.parse(params.contract_json) as ChangeContract;
        const missingFields = [
          !parsed.goal ? 'goal' : null,
          !Array.isArray(parsed.required_edit_surfaces) ? 'required_edit_surfaces' : null,
          !Array.isArray(parsed.likely_dependent_surfaces) ? 'likely_dependent_surfaces' : null,
          !Array.isArray(parsed.recommended_tests) ? 'recommended_tests' : null,
          !Array.isArray(parsed.affected_modules) ? 'affected_modules' : null,
          !Array.isArray(parsed.supporting_processes) ? 'supporting_processes' : null,
          !Array.isArray(parsed.risk_notes) ? 'risk_notes' : null,
          !Array.isArray(parsed.unknowns) ? 'unknowns' : null,
        ].filter(Boolean);
        if (missingFields.length > 0) {
          return { error: `contract_json is missing required change-contract fields: ${missingFields.join(', ')}` };
        }
        return parsed;
      } catch (error) {
        return { error: `Failed to parse contract_json: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    const generated = await this.planSupport.planChange(repo, {
      goal: params.goal,
      task_context: params.task_context,
      max_surfaces: params.max_surfaces,
    } satisfies PlanChangeParams);

    return generated;
  }

  private async resolveChangedFiles(repo: RepoHandle, params: VerifyChangeParams): Promise<string[]> {
    const explicit = (params.changed_files || []).map((filePath) => filePath.trim()).filter(Boolean);
    if (explicit.length > 0) {
      return explicit;
    }

    const detectResult = await this.host.detectChanges(repo, {
      scope: params.scope,
      base_ref: params.base_ref,
    });

    return Array.isArray(detectResult?.changed_files) ? detectResult.changed_files : [];
  }

  private findMissingRecommendedTests(
    recommendedTests: ChangeContractTestTarget[],
    changedFiles: string[],
    reportedTestTargets: string[],
  ): ChangeContractTestTarget[] {
    const normalizedChanged = new Set(changedFiles.map((filePath) => normalizeRepoPath(filePath)));
    const normalizedReported = new Set(reportedTestTargets.map((target) => target.trim().toLowerCase()));
    const changedStems = new Set(
      [...changedFiles.filter((filePath) => isTestLikePath(filePath)), ...reportedTestTargets]
        .map((target) => target.toLowerCase())
        .map((target) => createPathStem(target)),
    );

    return recommendedTests.filter((target) => {
      if (target.kind === 'file' && target.file_path) {
        const normalized = normalizeRepoPath(target.file_path);
        return !normalizedChanged.has(normalized) && !normalizedReported.has(normalized.toLowerCase());
      }

      if (target.kind === 'process') {
        return !normalizedReported.has(target.target.toLowerCase());
      }

      return !normalizedReported.has(target.target.toLowerCase()) && !changedStems.has(createPathStem(target.target));
    });
  }
}
