import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendAnalysisHost } from './local-backend-analysis-types.js';
import {
  type ChangeContract,
  type PlanChangeParams,
} from './local-backend-change-contract-types.js';
import { LocalBackendChangeEvidenceSupport } from './local-backend-change-evidence-support.js';

export class LocalBackendChangeContractSupport {
  private readonly evidenceSupport: LocalBackendChangeEvidenceSupport;

  constructor(host: LocalBackendAnalysisHost) {
    this.evidenceSupport = new LocalBackendChangeEvidenceSupport(host);
  }

  async planChange(repo: RepoHandle, params: PlanChangeParams): Promise<ChangeContract | { error: string }> {
    const goal = params.goal?.trim();
    if (!goal) {
      return { error: 'goal is required and cannot be empty.' };
    }

    const maxSurfaces = Math.max(3, Math.min(params.max_surfaces ?? 6, 12));
    const evidence = await this.evidenceSupport.collectEvidence(repo, {
      goal,
      task_context: params.task_context,
      max_surfaces: maxSurfaces,
    });

    return {
      goal,
      ...(params.task_context ? { task_context: params.task_context } : {}),
      confidence_posture: 'bounded',
      evidence_buckets: {
        grounded: 'Direct graph or search evidence from the current indexed repo.',
        strong_inference: 'Short structural inference from grounded owners, processes, modules, or test adjacency.',
        hypothesis: 'Useful inspection leads that are plausible but not yet proven by the current graph.',
      },
      primary_anchor: evidence.primaryAnchor,
      required_edit_surfaces: evidence.groundedSurfaces,
      likely_dependent_surfaces: evidence.likelySurfaces,
      recommended_tests: evidence.recommendedTests,
      risk_notes: evidence.riskNotes,
      supporting_processes: evidence.supportingProcesses,
      affected_modules: evidence.affectedModules,
      unknowns: evidence.unknowns,
    };
  }
}
