import type { RepoMeta } from '../../storage/repo-manager.js';

export interface CodebaseContext {
  projectName: string;
  stats: {
    fileCount: number;
    functionCount: number;
    communityCount: number;
    processCount: number;
  };
}

export interface RepoHandle {
  id: string;
  name: string;
  repoPath: string;
  storagePath: string;
  kuzuPath: string;
  indexedAt: string;
  lastCommit: string;
  stats?: RepoMeta['stats'];
}

export interface RepoFreshnessSummary {
  state: string;
  indexed_at: string | null;
  loaded_service_commit: string | null;
  indexed_commit: string | null;
  current_commit: string | null;
  detail_flags: string[];
}

export interface RojoTargetSummary {
  dataModelPath: string;
  runtimeArea: 'shared' | 'client' | 'server' | 'other';
}

export interface RankedSearchResult {
  nodeId?: string;
  name: string;
  type: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  runtimeArea?: string;
  description?: string;
  bm25Score: number;
  score: number;
  moduleSymbol?: string;
  dataModelPath?: string;
  boundaryImports?: Array<{ name: string; filePath: string; runtimeArea?: string }>;
}

export type MemberRecoverySource = 'contains' | 'defines' | 'file_defines' | 'range' | 'none';
