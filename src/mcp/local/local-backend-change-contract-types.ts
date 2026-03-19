import path from 'node:path';

export type EvidenceBucket = 'grounded' | 'strong_inference' | 'hypothesis';

export type ChangeSurfaceSource =
  | 'query'
  | 'impact'
  | 'impact_process'
  | 'impact_module'
  | 'intent_hint'
  | 'adjacent_test'
  | 'reported_change'
  | 'owner_overlap';

export interface ChangeContractSurface {
  file_path: string;
  symbol_name?: string;
  symbol_uid?: string;
  kind?: string;
  module?: string;
  process?: string;
  reason: string;
  source: ChangeSurfaceSource;
  evidence: EvidenceBucket;
  depth?: number;
}

export interface ChangeContractTestTarget {
  target: string;
  kind: 'file' | 'command' | 'process';
  file_path?: string;
  reason: string;
  source: ChangeSurfaceSource;
  evidence: EvidenceBucket;
}

export interface ChangeContractRiskNote {
  level: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  summary: string;
  reason: string;
  source: ChangeSurfaceSource;
  evidence: EvidenceBucket;
}

export interface ChangeContract {
  goal: string;
  task_context?: string;
  confidence_posture: 'bounded';
  evidence_buckets: {
    grounded: string;
    strong_inference: string;
    hypothesis: string;
  };
  primary_anchor: ChangeContractSurface | null;
  required_edit_surfaces: ChangeContractSurface[];
  likely_dependent_surfaces: ChangeContractSurface[];
  recommended_tests: ChangeContractTestTarget[];
  risk_notes: ChangeContractRiskNote[];
  supporting_processes: Array<{ name: string; hits?: number; evidence: EvidenceBucket }>;
  affected_modules: Array<{ name: string; impact?: string; hits?: number; evidence: EvidenceBucket }>;
  unknowns: string[];
}

export interface PlanChangeParams {
  goal?: string;
  task_context?: string;
  max_surfaces?: number;
}

export interface VerifyChangeParams {
  goal?: string;
  task_context?: string;
  contract_json?: string;
  scope?: string;
  base_ref?: string;
  changed_files?: string[];
  reported_test_targets?: string[];
  max_surfaces?: number;
}

export interface VerifyChangeMismatchSet {
  missing_grounded_surfaces: ChangeContractSurface[];
  unreviewed_inferred_surfaces: ChangeContractSurface[];
  out_of_contract_touched_surfaces: ChangeContractSurface[];
  missing_recommended_tests: ChangeContractTestTarget[];
  contract_insufficiency: ChangeContractSurface[];
}

export interface VerifyChangeResult {
  goal: string;
  status: 'ok' | 'attention' | 'contract_insufficiency';
  contract: ChangeContract;
  changed_files: string[];
  reported_test_targets: string[];
  mismatches: VerifyChangeMismatchSet;
  summary: {
    changed_file_count: number;
    missing_grounded_count: number;
    unreviewed_inferred_count: number;
    out_of_contract_count: number;
    missing_recommended_test_count: number;
    contract_insufficiency_count: number;
  };
}

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function isTestLikePath(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath).toLowerCase();
  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.tsx') ||
    normalized.endsWith('.test.js') ||
    normalized.endsWith('.test.jsx') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.tsx') ||
    normalized.endsWith('.spec.js') ||
    normalized.endsWith('.spec.jsx') ||
    normalized.endsWith('_test.py') ||
    normalized.endsWith('_spec.rb') ||
    normalized.endsWith('.spec.lua') ||
    normalized.endsWith('.test.lua')
  );
}

export function createSurfaceKey(surface: {
  file_path: string;
  symbol_name?: string;
  symbol_uid?: string;
}): string {
  return [
    normalizeRepoPath(surface.file_path),
    surface.symbol_uid || '',
    surface.symbol_name || '',
  ].join('::');
}

export function createPathStem(filePath: string): string {
  const parsed = path.parse(normalizeRepoPath(filePath));
  return parsed.name
    .replace(/(?:\.test|\.spec)$/i, '')
    .replace(/(?:_test|_spec)$/i, '')
    .toLowerCase();
}
