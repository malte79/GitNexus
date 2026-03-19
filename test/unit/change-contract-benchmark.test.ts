import { describe, expect, it } from 'vitest';
import {
  compareBenchmarkRuns,
  loadBenchmarkCorpus,
  validateBenchmarkCorpus,
  validateBenchmarkRun,
} from '../../scripts/change-contract-benchmark-support.js';

function makeRun(
  corpus: ReturnType<typeof loadBenchmarkCorpus>,
  overrides: Partial<Parameters<typeof validateBenchmarkRun>[0]> = {},
) {
  return {
    corpus_version: corpus.corpus_version,
    mode: 'baseline',
    runtime_signature: 'pinned-corpus-v1',
    variance: {
      repeated_runs: 1,
      measurement_method: 'manual-pilot',
    },
    task_results: corpus.tasks.map((task) => ({
      task_id: task.id,
      role: task.role,
      agent_runtime: structuredClone(task.agent_runtime),
      freshness_prerequisites: structuredClone(task.freshness_prerequisites),
      orientation_boundary: structuredClone(task.orientation_boundary),
      success: true,
      metrics: {
        time_to_first_correct_edit_seconds: 10,
        total_task_time_seconds: 20,
        orientation_tokens_before_first_edit: 100,
        wrong_surface_count: 1,
        rework_count: 0,
        recommended_test_recall: 1,
        recommended_test_precision: 1,
      },
      trustworthiness: {
        grounded_surface_precision: 0.9,
        strong_inference_useful_rate: 0.8,
        strong_inference_noise_rate: 0.1,
        misleading_overconfidence_rate: 0.05,
        verification_truthfulness_on_contract_insufficiency: 0.85,
      },
    })),
    ...overrides,
  };
}

describe('change-contract benchmark corpus', () => {
  it('validates the pinned corpus fixture', () => {
    const corpus = loadBenchmarkCorpus('test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json');
    expect(validateBenchmarkCorpus(corpus)).toEqual([]);
  });

  it('rejects missing gold adjudication fields', () => {
    const corpus = loadBenchmarkCorpus('test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json');
    const broken = structuredClone(corpus);
    broken.tasks[0].gold.correct_edit_surfaces = [];

    expect(validateBenchmarkCorpus(broken)).toContain(
      `task ${broken.tasks[0].id} must include gold.correct_edit_surfaces`,
    );
  });

  it('rejects runs with mismatched freshness or orientation prerequisites', () => {
    const corpus = loadBenchmarkCorpus('test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json');
    const run = makeRun(corpus);
    run.task_results[0].freshness_prerequisites.indexed_commit = 'different';

    expect(validateBenchmarkRun(run, corpus).join('\n')).toContain('indexed commit does not match corpus freshness prerequisite');
  });

  it('rejects runs with mismatched task runtime config', () => {
    const corpus = loadBenchmarkCorpus('test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json');
    const run = makeRun(corpus);
    run.task_results[0].agent_runtime.client = 'different-client';

    expect(validateBenchmarkRun(run, corpus).join('\n')).toContain('client runtime does not match corpus agent_runtime.client');
  });

  it('rejects runs missing variance metadata or trustworthiness fields', () => {
    const corpus = loadBenchmarkCorpus('test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json');
    const run = makeRun(corpus, {
      variance: {
        repeated_runs: 0,
        measurement_method: '',
      },
    });
    delete (run.task_results[0].trustworthiness as Partial<typeof run.task_results[0]['trustworthiness']>).grounded_surface_precision;

    const issues = validateBenchmarkRun(run, corpus).join('\n');
    expect(issues).toContain('variance.repeated_runs must be an integer >= 1');
    expect(issues).toContain('variance.measurement_method is required');
    expect(issues).toContain('task planning-repo-manager-split is missing trustworthiness field grounded_surface_precision');
  });

  it('rejects compare mode when baseline and candidate runtime signatures drift', () => {
    const corpus = loadBenchmarkCorpus('test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json');
    const baseline = makeRun(corpus, { mode: 'baseline', runtime_signature: 'baseline-runtime' });
    const candidate = makeRun(corpus, { mode: 'change_contract', runtime_signature: 'candidate-runtime' });

    expect(() => compareBenchmarkRuns(corpus, baseline, candidate)).toThrow(
      'baseline and candidate runtime_signature must match',
    );
  });

  it('computes comparison thresholds from pinned baseline and candidate results', () => {
    const corpus = loadBenchmarkCorpus('test/fixtures/change-contract-benchmark/gnexus-agent-benchmark.json');
    const baseline = makeRun(corpus, { mode: 'baseline' });
    const candidate = makeRun(corpus, { mode: 'change_contract' });

    for (const result of baseline.task_results) {
      result.metrics.time_to_first_correct_edit_seconds = 100;
      result.metrics.total_task_time_seconds = 200;
      result.metrics.orientation_tokens_before_first_edit = 1000;
      result.metrics.wrong_surface_count = 10;
      result.metrics.rework_count = 2;
      result.metrics.recommended_test_recall = 0.8;
      result.metrics.recommended_test_precision = 0.7;
      result.trustworthiness.grounded_surface_precision = 0.75;
      result.trustworthiness.strong_inference_useful_rate = 0.65;
      result.trustworthiness.strong_inference_noise_rate = 0.2;
      result.trustworthiness.misleading_overconfidence_rate = 0.15;
      result.trustworthiness.verification_truthfulness_on_contract_insufficiency = 0.7;
    }
    for (const result of candidate.task_results) {
      result.metrics.time_to_first_correct_edit_seconds = 70;
      result.metrics.total_task_time_seconds = 150;
      result.metrics.orientation_tokens_before_first_edit = 700;
      result.metrics.wrong_surface_count = 6;
      result.metrics.rework_count = 1;
      result.metrics.recommended_test_recall = 0.8;
      result.metrics.recommended_test_precision = 0.75;
      result.trustworthiness.grounded_surface_precision = 0.9;
      result.trustworthiness.strong_inference_useful_rate = 0.8;
      result.trustworthiness.strong_inference_noise_rate = 0.1;
      result.trustworthiness.misleading_overconfidence_rate = 0.05;
      result.trustworthiness.verification_truthfulness_on_contract_insufficiency = 0.88;
    }

    const comparison = compareBenchmarkRuns(corpus, baseline, candidate);
    expect(comparison.equivalence.runtime_signature_match).toBe(true);
    expect(comparison.equivalence.freshness_prerequisites_match).toBe(true);
    expect(comparison.equivalence.orientation_boundaries_match).toBe(true);
    expect(comparison.thresholds.final_task_success_ok).toBe(true);
    expect(comparison.thresholds.time_to_first_correct_edit_ok).toBe(true);
    expect(comparison.thresholds.orientation_tokens_ok).toBe(true);
    expect(comparison.thresholds.wrong_surface_ok).toBe(true);
    expect(comparison.thresholds.qa_security_recall_ok).toBe(true);
    expect(comparison.thresholds.trustworthiness_ok).toBe(true);
    expect(comparison.thresholds.ship_verdict).toBe(true);
  });
});
