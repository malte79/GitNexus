import fs from 'node:fs';
import path from 'node:path';

export type BenchmarkRole = 'planning' | 'engineering' | 'qa' | 'security';

export interface ChangeContractBenchmarkTask {
  id: string;
  role: BenchmarkRole;
  repo: string;
  repo_commit: string;
  prompt_shell: string;
  task_statement: string;
  agent_runtime: {
    client: string;
    model_family: string;
    retry_budget: number;
  };
  freshness_prerequisites: {
    indexed_commit: string;
    serving_state: string;
    repo_clean: boolean;
  };
  orientation_boundary: {
    start: string;
    end: string;
  };
  gold: {
    correct_edit_surfaces: string[];
    wrong_surface_boundaries: string[];
    expected_tests: string[];
    success_criteria: string[];
  };
}

export interface ChangeContractBenchmarkCorpus {
  corpus_version: number;
  description: string;
  tasks: ChangeContractBenchmarkTask[];
}

export interface BenchmarkTaskMetrics {
  time_to_first_correct_edit_seconds: number;
  total_task_time_seconds: number;
  orientation_tokens_before_first_edit: number;
  wrong_surface_count: number;
  rework_count: number;
  recommended_test_recall: number;
  recommended_test_precision: number;
}

export interface BenchmarkTaskTrustworthiness {
  grounded_surface_precision: number;
  strong_inference_useful_rate: number;
  strong_inference_noise_rate: number;
  misleading_overconfidence_rate: number;
  verification_truthfulness_on_contract_insufficiency: number;
}

export interface BenchmarkTaskResult {
  task_id: string;
  role: BenchmarkRole;
  agent_runtime: {
    client: string;
    model_family: string;
    retry_budget: number;
  };
  freshness_prerequisites: {
    indexed_commit: string;
    serving_state: string;
    repo_clean: boolean;
  };
  orientation_boundary: {
    start: string;
    end: string;
  };
  success: boolean;
  metrics: BenchmarkTaskMetrics;
  trustworthiness: BenchmarkTaskTrustworthiness;
}

export interface BenchmarkRunResult {
  corpus_version: number;
  mode: 'baseline' | 'change_contract';
  runtime_signature: string;
  variance: {
    repeated_runs: number;
    measurement_method: string;
    notes?: string;
  };
  task_results: BenchmarkTaskResult[];
}

export interface BenchmarkComparison {
  task_count: number;
  equivalence: {
    runtime_signature_match: boolean;
    freshness_prerequisites_match: boolean;
    orientation_boundaries_match: boolean;
  };
  role_breakdowns: Record<BenchmarkRole, {
    baseline_successes: number;
    candidate_successes: number;
    shared_successes: number;
    median_time_to_first_correct_edit_delta: number;
    median_total_task_time_delta: number;
    median_orientation_token_delta: number;
    wrong_surface_delta: number;
    rework_delta: number;
    recommended_test_recall_delta: number;
    recommended_test_precision_delta: number;
    grounded_surface_precision_delta: number;
    strong_inference_useful_rate_delta: number;
    strong_inference_noise_rate_delta: number;
    misleading_overconfidence_rate_delta: number;
    verification_truthfulness_delta: number;
  }>;
  thresholds: {
    final_task_success_ok: boolean;
    time_to_first_correct_edit_ok: boolean;
    orientation_tokens_ok: boolean;
    wrong_surface_ok: boolean;
    qa_security_recall_ok: boolean;
    trustworthiness_ok: boolean;
    ship_verdict: boolean;
  };
}

const BENCHMARK_ROLES: BenchmarkRole[] = ['planning', 'engineering', 'qa', 'security'];

export function loadBenchmarkCorpus(filePath: string): ChangeContractBenchmarkCorpus {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ChangeContractBenchmarkCorpus;
}

export function validateBenchmarkCorpus(corpus: ChangeContractBenchmarkCorpus): string[] {
  const issues: string[] = [];

  if (!Number.isInteger(corpus.corpus_version) || corpus.corpus_version < 1) {
    issues.push('corpus_version must be an integer >= 1');
  }
  if (!Array.isArray(corpus.tasks) || corpus.tasks.length === 0) {
    issues.push('tasks must be a non-empty array');
    return issues;
  }

  const seenIds = new Set<string>();
  const roleCounts = new Map<BenchmarkRole, number>();
  for (const role of BENCHMARK_ROLES) {
    roleCounts.set(role, 0);
  }

  for (const task of corpus.tasks) {
    if (!task.id?.trim()) issues.push('task id is required');
    if (seenIds.has(task.id)) issues.push(`duplicate task id: ${task.id}`);
    seenIds.add(task.id);

    if (!BENCHMARK_ROLES.includes(task.role)) {
      issues.push(`task ${task.id} has invalid role: ${task.role}`);
    } else {
      roleCounts.set(task.role, (roleCounts.get(task.role) || 0) + 1);
    }

    if (!task.prompt_shell?.trim()) issues.push(`task ${task.id} is missing prompt_shell`);
    if (!task.task_statement?.trim()) issues.push(`task ${task.id} is missing task_statement`);
    if (!task.repo?.trim()) issues.push(`task ${task.id} is missing repo`);
    if (!task.repo_commit?.trim()) issues.push(`task ${task.id} is missing repo_commit`);
    if (!task.agent_runtime?.client?.trim()) issues.push(`task ${task.id} is missing agent_runtime.client`);
    if (!task.agent_runtime?.model_family?.trim()) issues.push(`task ${task.id} is missing agent_runtime.model_family`);
    if (!Number.isInteger(task.agent_runtime?.retry_budget)) issues.push(`task ${task.id} is missing agent_runtime.retry_budget`);
    if (!task.freshness_prerequisites?.indexed_commit?.trim()) issues.push(`task ${task.id} is missing freshness_prerequisites.indexed_commit`);
    if (!task.freshness_prerequisites?.serving_state?.trim()) issues.push(`task ${task.id} is missing freshness_prerequisites.serving_state`);
    if (typeof task.freshness_prerequisites?.repo_clean !== 'boolean') issues.push(`task ${task.id} is missing freshness_prerequisites.repo_clean`);
    if (!task.orientation_boundary?.start?.trim()) issues.push(`task ${task.id} is missing orientation_boundary.start`);
    if (!task.orientation_boundary?.end?.trim()) issues.push(`task ${task.id} is missing orientation_boundary.end`);
    if (!Array.isArray(task.gold?.correct_edit_surfaces) || task.gold.correct_edit_surfaces.length === 0) {
      issues.push(`task ${task.id} must include gold.correct_edit_surfaces`);
    }
    if (!Array.isArray(task.gold?.wrong_surface_boundaries) || task.gold.wrong_surface_boundaries.length === 0) {
      issues.push(`task ${task.id} must include gold.wrong_surface_boundaries`);
    }
    if (!Array.isArray(task.gold?.expected_tests) || task.gold.expected_tests.length === 0) {
      issues.push(`task ${task.id} must include gold.expected_tests`);
    }
    if (!Array.isArray(task.gold?.success_criteria) || task.gold.success_criteria.length === 0) {
      issues.push(`task ${task.id} must include gold.success_criteria`);
    }
  }

  if (corpus.tasks.length < 12) {
    issues.push('benchmark corpus must include at least 12 tasks');
  }

  for (const role of BENCHMARK_ROLES) {
    if ((roleCounts.get(role) || 0) < 3) {
      issues.push(`benchmark corpus must include at least 3 tasks for role ${role}`);
    }
  }

  return issues;
}

export function loadBenchmarkRun(filePath: string): BenchmarkRunResult {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BenchmarkRunResult;
}

export function validateBenchmarkRun(run: BenchmarkRunResult, corpus: ChangeContractBenchmarkCorpus): string[] {
  const issues: string[] = [];
  const tasksById = new Map(corpus.tasks.map((task) => [task.id, task]));

  if (run.corpus_version !== corpus.corpus_version) {
    issues.push(`run corpus_version ${run.corpus_version} does not match corpus version ${corpus.corpus_version}`);
  }
  if (!['baseline', 'change_contract'].includes(run.mode)) {
    issues.push(`invalid run mode: ${run.mode}`);
  }
  if (!run.runtime_signature?.trim()) {
    issues.push('runtime_signature is required');
  }
  if (!Number.isInteger(run.variance?.repeated_runs) || run.variance.repeated_runs < 1) {
    issues.push('variance.repeated_runs must be an integer >= 1');
  }
  if (!run.variance?.measurement_method?.trim()) {
    issues.push('variance.measurement_method is required');
  }
  if (!Array.isArray(run.task_results) || run.task_results.length !== corpus.tasks.length) {
    issues.push('task_results must cover every task in the corpus exactly once');
  }

  const seenIds = new Set<string>();
  for (const result of run.task_results || []) {
    const task = tasksById.get(result.task_id);
    if (!task) {
      issues.push(`unknown task result id: ${result.task_id}`);
      continue;
    }
    if (seenIds.has(result.task_id)) {
      issues.push(`duplicate task result id: ${result.task_id}`);
    }
    seenIds.add(result.task_id);

    if (result.role !== task.role) {
      issues.push(`task ${result.task_id} role ${result.role} does not match corpus role ${task.role}`);
    }
    if (result.agent_runtime?.client !== task.agent_runtime.client) {
      issues.push(`task ${result.task_id} client runtime does not match corpus agent_runtime.client`);
    }
    if (result.agent_runtime?.model_family !== task.agent_runtime.model_family) {
      issues.push(`task ${result.task_id} model runtime does not match corpus agent_runtime.model_family`);
    }
    if (result.agent_runtime?.retry_budget !== task.agent_runtime.retry_budget) {
      issues.push(`task ${result.task_id} retry budget does not match corpus agent_runtime.retry_budget`);
    }
    if (result.freshness_prerequisites.indexed_commit !== task.freshness_prerequisites.indexed_commit) {
      issues.push(`task ${result.task_id} indexed commit does not match corpus freshness prerequisite`);
    }
    if (result.freshness_prerequisites.serving_state !== task.freshness_prerequisites.serving_state) {
      issues.push(`task ${result.task_id} serving state does not match corpus freshness prerequisite`);
    }
    if (result.freshness_prerequisites.repo_clean !== task.freshness_prerequisites.repo_clean) {
      issues.push(`task ${result.task_id} repo_clean does not match corpus freshness prerequisite`);
    }
    if (result.orientation_boundary.start !== task.orientation_boundary.start || result.orientation_boundary.end !== task.orientation_boundary.end) {
      issues.push(`task ${result.task_id} orientation boundary does not match corpus`);
    }
    if (typeof result.success !== 'boolean') {
      issues.push(`task ${result.task_id} success must be boolean`);
    }

    for (const field of [
      'time_to_first_correct_edit_seconds',
      'total_task_time_seconds',
      'orientation_tokens_before_first_edit',
      'wrong_surface_count',
      'rework_count',
      'recommended_test_recall',
      'recommended_test_precision',
    ] satisfies Array<keyof BenchmarkTaskMetrics>) {
      if (typeof result.metrics?.[field] !== 'number' || Number.isNaN(result.metrics[field])) {
        issues.push(`task ${result.task_id} is missing metric ${field}`);
      }
    }

    for (const field of [
      'grounded_surface_precision',
      'strong_inference_useful_rate',
      'strong_inference_noise_rate',
      'misleading_overconfidence_rate',
      'verification_truthfulness_on_contract_insufficiency',
    ] satisfies Array<keyof BenchmarkTaskTrustworthiness>) {
      if (typeof result.trustworthiness?.[field] !== 'number' || Number.isNaN(result.trustworthiness[field])) {
        issues.push(`task ${result.task_id} is missing trustworthiness field ${field}`);
      }
    }
  }

  return issues;
}

export function compareBenchmarkRuns(
  corpus: ChangeContractBenchmarkCorpus,
  baseline: BenchmarkRunResult,
  candidate: BenchmarkRunResult,
): BenchmarkComparison {
  if (baseline.mode !== 'baseline') {
    throw new Error('baseline run must have mode "baseline"');
  }
  if (candidate.mode !== 'change_contract') {
    throw new Error('candidate run must have mode "change_contract"');
  }
  if (baseline.runtime_signature !== candidate.runtime_signature) {
    throw new Error('baseline and candidate runtime_signature must match');
  }

  const roleBreakdowns = Object.fromEntries(BENCHMARK_ROLES.map((role) => [role, {
    baseline_successes: 0,
    candidate_successes: 0,
    shared_successes: 0,
    median_time_to_first_correct_edit_delta: 0,
    median_total_task_time_delta: 0,
    median_orientation_token_delta: 0,
    wrong_surface_delta: 0,
    rework_delta: 0,
    recommended_test_recall_delta: 0,
    recommended_test_precision_delta: 0,
    grounded_surface_precision_delta: 0,
    strong_inference_useful_rate_delta: 0,
    strong_inference_noise_rate_delta: 0,
    misleading_overconfidence_rate_delta: 0,
    verification_truthfulness_delta: 0,
  }])) as BenchmarkComparison['role_breakdowns'];

  const baselineById = new Map(baseline.task_results.map((task) => [task.task_id, task]));
  const candidateById = new Map(candidate.task_results.map((task) => [task.task_id, task]));
  let freshnessEquivalent = true;
  let orientationEquivalent = true;

  for (const role of BENCHMARK_ROLES) {
    const taskIds = corpus.tasks.filter((task) => task.role === role).map((task) => task.id);
    const baselineTasks = taskIds.map((taskId) => baselineById.get(taskId)!);
    const candidateTasks = taskIds.map((taskId) => candidateById.get(taskId)!);

    for (let index = 0; index < taskIds.length; index += 1) {
      const baselineTask = baselineTasks[index];
      const candidateTask = candidateTasks[index];
      if (
        baselineTask.agent_runtime.client !== candidateTask.agent_runtime.client
        || baselineTask.agent_runtime.model_family !== candidateTask.agent_runtime.model_family
        || baselineTask.agent_runtime.retry_budget !== candidateTask.agent_runtime.retry_budget
      ) {
        throw new Error(`baseline and candidate runtime config must match for task ${taskIds[index]}`);
      }
      if (
        baselineTask.freshness_prerequisites.indexed_commit !== candidateTask.freshness_prerequisites.indexed_commit
        || baselineTask.freshness_prerequisites.serving_state !== candidateTask.freshness_prerequisites.serving_state
        || baselineTask.freshness_prerequisites.repo_clean !== candidateTask.freshness_prerequisites.repo_clean
      ) {
        freshnessEquivalent = false;
      }
      if (
        baselineTask.orientation_boundary.start !== candidateTask.orientation_boundary.start
        || baselineTask.orientation_boundary.end !== candidateTask.orientation_boundary.end
      ) {
        orientationEquivalent = false;
      }
    }

    const sharedSuccessPairs = baselineTasks
      .map((baselineTask, index) => ({ baselineTask, candidateTask: candidateTasks[index] }))
      .filter(({ baselineTask, candidateTask }) => baselineTask.success && candidateTask.success);
    const sharedBaselineTasks = sharedSuccessPairs.map(({ baselineTask }) => baselineTask);
    const sharedCandidateTasks = sharedSuccessPairs.map(({ candidateTask }) => candidateTask);

    roleBreakdowns[role] = {
      baseline_successes: baselineTasks.filter((task) => task.success).length,
      candidate_successes: candidateTasks.filter((task) => task.success).length,
      shared_successes: sharedSuccessPairs.length,
      median_time_to_first_correct_edit_delta: percentageReduction(
        median(sharedBaselineTasks.map((task) => task.metrics.time_to_first_correct_edit_seconds)),
        median(sharedCandidateTasks.map((task) => task.metrics.time_to_first_correct_edit_seconds)),
      ),
      median_total_task_time_delta: percentageReduction(
        median(sharedBaselineTasks.map((task) => task.metrics.total_task_time_seconds)),
        median(sharedCandidateTasks.map((task) => task.metrics.total_task_time_seconds)),
      ),
      median_orientation_token_delta: percentageReduction(
        median(sharedBaselineTasks.map((task) => task.metrics.orientation_tokens_before_first_edit)),
        median(sharedCandidateTasks.map((task) => task.metrics.orientation_tokens_before_first_edit)),
      ),
      wrong_surface_delta: percentageReduction(
        median(sharedBaselineTasks.map((task) => task.metrics.wrong_surface_count)),
        median(sharedCandidateTasks.map((task) => task.metrics.wrong_surface_count)),
      ),
      rework_delta: percentageReduction(
        median(sharedBaselineTasks.map((task) => task.metrics.rework_count)),
        median(sharedCandidateTasks.map((task) => task.metrics.rework_count)),
      ),
      recommended_test_recall_delta:
        median(candidateTasks.map((task) => task.metrics.recommended_test_recall))
        - median(baselineTasks.map((task) => task.metrics.recommended_test_recall)),
      recommended_test_precision_delta:
        median(candidateTasks.map((task) => task.metrics.recommended_test_precision))
        - median(baselineTasks.map((task) => task.metrics.recommended_test_precision)),
      grounded_surface_precision_delta:
        median(candidateTasks.map((task) => task.trustworthiness.grounded_surface_precision))
        - median(baselineTasks.map((task) => task.trustworthiness.grounded_surface_precision)),
      strong_inference_useful_rate_delta:
        median(candidateTasks.map((task) => task.trustworthiness.strong_inference_useful_rate))
        - median(baselineTasks.map((task) => task.trustworthiness.strong_inference_useful_rate)),
      strong_inference_noise_rate_delta:
        median(candidateTasks.map((task) => task.trustworthiness.strong_inference_noise_rate))
        - median(baselineTasks.map((task) => task.trustworthiness.strong_inference_noise_rate)),
      misleading_overconfidence_rate_delta:
        median(candidateTasks.map((task) => task.trustworthiness.misleading_overconfidence_rate))
        - median(baselineTasks.map((task) => task.trustworthiness.misleading_overconfidence_rate)),
      verification_truthfulness_delta:
        median(candidateTasks.map((task) => task.trustworthiness.verification_truthfulness_on_contract_insufficiency))
        - median(baselineTasks.map((task) => task.trustworthiness.verification_truthfulness_on_contract_insufficiency)),
    };
  }

  const trustworthinessOk = BENCHMARK_ROLES.every((role) =>
    roleBreakdowns[role].grounded_surface_precision_delta >= 0
    && roleBreakdowns[role].strong_inference_useful_rate_delta >= 0
    && roleBreakdowns[role].strong_inference_noise_rate_delta <= 0
    && roleBreakdowns[role].misleading_overconfidence_rate_delta <= 0
    && roleBreakdowns[role].verification_truthfulness_delta >= 0,
  );

  const finalTaskSuccessOk = BENCHMARK_ROLES.every((role) =>
    roleBreakdowns[role].candidate_successes >= roleBreakdowns[role].baseline_successes
    && roleBreakdowns[role].candidate_successes > 0,
  );
  const comparableRoles = Object.values(roleBreakdowns).filter((entry) => entry.shared_successes > 0);
  const timeToFirstCorrectEditOk =
    comparableRoles.length > 0
    && median(comparableRoles.map((entry) => entry.median_time_to_first_correct_edit_delta)) >= 20;
  const orientationTokensOk =
    comparableRoles.length > 0
    && median(comparableRoles.map((entry) => entry.median_orientation_token_delta)) >= 25;
  const wrongSurfaceOk =
    comparableRoles.length > 0
    && median(comparableRoles.map((entry) => entry.wrong_surface_delta)) >= 30;
  const qaSecurityRecallOk = ['qa', 'security'].every((role) => roleBreakdowns[role as BenchmarkRole].recommended_test_recall_delta >= 0);

  return {
    task_count: corpus.tasks.length,
    equivalence: {
      runtime_signature_match: true,
      freshness_prerequisites_match: freshnessEquivalent,
      orientation_boundaries_match: orientationEquivalent,
    },
    role_breakdowns: roleBreakdowns,
    thresholds: {
      final_task_success_ok: finalTaskSuccessOk,
      time_to_first_correct_edit_ok: timeToFirstCorrectEditOk,
      orientation_tokens_ok: orientationTokensOk,
      wrong_surface_ok: wrongSurfaceOk,
      qa_security_recall_ok: qaSecurityRecallOk,
      trustworthiness_ok: trustworthinessOk,
      ship_verdict:
        finalTaskSuccessOk
        && timeToFirstCorrectEditOk
        && orientationTokensOk
        && wrongSurfaceOk
        && qaSecurityRecallOk
        && trustworthinessOk
        && freshnessEquivalent
        && orientationEquivalent,
    },
  };
}

export function discoverBenchmarkFixtureFiles(fixturesDir: string): string[] {
  return fs.readdirSync(fixturesDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(fixturesDir, entry))
    .sort();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function percentageReduction(baseline: number, candidate: number): number {
  if (baseline <= 0) return 0;
  return ((baseline - candidate) / baseline) * 100;
}
