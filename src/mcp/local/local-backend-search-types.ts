import type { RepoHandle, RojoTargetSummary } from './local-backend-types.js';

export interface LocalBackendSearchHost {
  ensureInitialized(repoId: string): Promise<void>;
  getOwnerSymbolsForFiles(repo: RepoHandle, filePaths: string[]): Promise<any[]>;
  getNodeKind(row: { id?: string; uid?: string; nodeId?: string; type?: string; kind?: string }, fallback?: string): string;
  isOwnerLikeSymbolKind(resultType: string): boolean;
  isPrimaryOwnerKind(resultType: string): boolean;
  isLikelyProductionFile(filePath: string): boolean;
  isLikelyCodeFile(filePath: string): boolean;
  isPrimarySourceFile(filePath: string): boolean;
  isLowSignalSummarySymbol(name: string): boolean;
  getOwnerSymbolPriority(kind: string): number;
  rankOwnerCandidates<T extends { type: string; fanIn?: number; fan_in?: number; name: string; filePath?: string }>(owners: T[]): T[];
  rankRepresentativeSymbols<T extends { type: string; name: string; filePath?: string; fanIn?: number; fan_in?: number; startLine?: number }>(symbols: T[]): T[];
  rojoProjectCache: Map<string, Promise<any | null>>;
}

export interface SearchSeedResult {
  nodeId?: string;
  name: string;
  type: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  runtimeArea?: string;
  description?: string;
  score?: number;
  bm25Score?: number;
  moduleSymbol?: string;
  dataModelPath?: string;
  boundaryImports?: Array<{ name: string; filePath: string; runtimeArea?: string }>;
}

export interface BroadQueryFileSignal {
  communityCount: number;
  processCount: number;
}

export interface SearchEnrichmentBundle {
  rojoProject: any | null;
  primaryModules: Map<string, string>;
  boundaryImports: Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>;
  broadQueryFileSignals: Map<string, BroadQueryFileSignal>;
  anchorFiles: Set<string>;
  preferMappedResults: boolean;
}

export type RojoTargetLookup = RojoTargetSummary | undefined;
