import type { RepoHandle } from './local-backend-types.js';
import type { LocalBackendSearchHost } from './local-backend-search-types.js';
import { LocalBackendSearchLookupSupport } from './local-backend-search-lookup-support.js';
import { LocalBackendSearchEnrichmentSupport } from './local-backend-search-enrichment-support.js';
import { LocalBackendSearchRankingSupport } from './local-backend-search-ranking-support.js';
import { LocalBackendSearchQuerySupport } from './local-backend-search-query-support.js';

export class LocalBackendSearchSupport {
  private readonly lookup: LocalBackendSearchLookupSupport;
  private readonly enrichment: LocalBackendSearchEnrichmentSupport;
  private readonly ranking: LocalBackendSearchRankingSupport;
  private readonly querySupport: LocalBackendSearchQuerySupport;

  constructor(host: LocalBackendSearchHost) {
    this.lookup = new LocalBackendSearchLookupSupport(host);
    this.enrichment = new LocalBackendSearchEnrichmentSupport(host);
    this.ranking = new LocalBackendSearchRankingSupport(host, this.lookup, this.enrichment);
    this.querySupport = new LocalBackendSearchQuerySupport(host, this.ranking);
  }

  async query(repo: RepoHandle, params: {
    query: string;
    task_context?: string;
    goal?: string;
    owners?: boolean;
    limit?: number;
    max_symbols?: number;
    include_content?: boolean;
  }): Promise<any> {
    return this.querySupport.query(repo, params);
  }

  async lookupNamedSymbols(
    repo: RepoHandle,
    params: { name: string; file_path?: string; include_content?: boolean },
  ): Promise<any[]> {
    return this.lookup.lookupNamedSymbols(repo, params);
  }

  async getRojoProjectIndex(repo: RepoHandle): Promise<any | null> {
    return this.enrichment.getRojoProjectIndex(repo);
  }

  async getPrimaryModuleSymbols(repo: RepoHandle, filePaths: string[]): Promise<Map<string, string>> {
    return this.enrichment.getPrimaryModuleSymbols(repo, filePaths);
  }

  async getBoundaryImports(
    repo: RepoHandle,
    filePaths: string[],
  ): Promise<Map<string, Array<{ name: string; filePath: string; runtimeArea?: string }>>> {
    return this.enrichment.getBoundaryImports(repo, filePaths);
  }
}
