import type { MemberRecoverySource, RepoFreshnessSummary, RepoHandle } from './local-backend-types.js';

export interface ShapeSignals {
  file: {
    line_count: number | null;
    function_count: number;
    largest_members: Array<{ name: string; kind: string; startLine: number; endLine: number; line_count: number }>;
    average_lines_per_function: number | null;
    hotspot_share: number | null;
    concentration: 'low' | 'medium' | 'high' | 'critical';
    grounded_extraction_seams: Array<{ name: string; symbol_count: number; startLine: number; endLine: number }>;
  };
}

export interface LocalBackendAnalysisHost {
  ensureInitialized(repoId: string): Promise<void>;
  getRepoFreshnessSummary(repoRoot: string): Promise<RepoFreshnessSummary | null>;
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  humanizeSummaryLabel(label: string): string;
  isLowSignalSubsystemLabel(label: string): boolean;
  querySearch(
    repo: RepoHandle,
    params: {
      query: string;
      task_context?: string;
      goal?: string;
      owners?: boolean;
      limit?: number;
      max_symbols?: number;
      include_content?: boolean;
    },
  ): Promise<any>;
  detectChanges(
    repo: RepoHandle,
    params: { scope?: string; base_ref?: string },
  ): Promise<any>;
  analyzeImpact(
    repo: RepoHandle,
    params: {
      target?: string;
      uid?: string;
      file_path?: string;
      direction: 'upstream' | 'downstream';
      maxDepth?: number;
      relationTypes?: string[];
      includeTests?: boolean;
      minConfidence?: number;
    },
  ): Promise<any>;
  lookupNamedSymbols(
    repo: RepoHandle,
    params: { name: string; file_path?: string; include_content?: boolean },
  ): Promise<any[]>;
  getPrimaryModuleSymbols(repo: RepoHandle, filePaths: string[]): Promise<Map<string, string>>;
  getRojoProjectIndex(repo: RepoHandle): Promise<any | null>;
  getBoundaryImports(
    repo: RepoHandle,
    filePaths: string[],
  ): Promise<Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>>;
  getContainedMembers(
    repo: RepoHandle,
    symbol: { id: string; kind?: string; filePath?: string; startLine?: number; endLine?: number; description?: string },
  ): Promise<{ rows: any[]; inferred: boolean; source: MemberRecoverySource }>;
  classifyCoverageSignal(score: number): 'high' | 'medium' | 'low';
  getDetailedAffectedAreas(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
  getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
}

export type LocalBackendContextParams = {
  name?: string;
  uid?: string;
  file_path?: string;
  include_content?: boolean;
};

export type LocalBackendContextResolver = (
  repo: RepoHandle,
  params: LocalBackendContextParams,
) => Promise<any>;
