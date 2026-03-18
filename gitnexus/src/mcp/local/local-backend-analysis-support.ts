import type { RepoHandle } from './local-backend-types.js';
import type {
  LocalBackendAnalysisHost,
  LocalBackendContextParams,
  ShapeSignals,
} from './local-backend-analysis-types.js';
import { LocalBackendShapeSupport } from './local-backend-shape-support.js';
import { LocalBackendContextSupport } from './local-backend-context-support.js';
import { LocalBackendDetectChangesSupport } from './local-backend-detect-changes-support.js';
import { LocalBackendRenameSupport } from './local-backend-rename-support.js';
import { LocalBackendImpactSupport } from './local-backend-impact-support.js';

export class LocalBackendAnalysisSupport {
  private readonly shapeSupport: LocalBackendShapeSupport;
  private readonly contextSupport: LocalBackendContextSupport;
  private readonly detectChangesSupport: LocalBackendDetectChangesSupport;
  private readonly renameSupport: LocalBackendRenameSupport;
  private readonly impactSupport: LocalBackendImpactSupport;

  constructor(host: LocalBackendAnalysisHost) {
    this.shapeSupport = new LocalBackendShapeSupport(host);
    this.contextSupport = new LocalBackendContextSupport(host);
    this.detectChangesSupport = new LocalBackendDetectChangesSupport(host);
    this.renameSupport = new LocalBackendRenameSupport(host, this.context.bind(this));
    this.impactSupport = new LocalBackendImpactSupport(host, this.shapeSupport, this.context.bind(this));
  }

  async getShapeSignals(repo: RepoHandle, filePath: string | undefined): Promise<ShapeSignals> {
    return this.shapeSupport.getShapeSignals(repo, filePath);
  }

  async context(repo: RepoHandle, params: LocalBackendContextParams): Promise<any> {
    return this.contextSupport.context(repo, params);
  }

  async detectChanges(repo: RepoHandle, params: { scope?: string; base_ref?: string }): Promise<any> {
    return this.detectChangesSupport.detectChanges(repo, params);
  }

  async rename(repo: RepoHandle, params: {
    symbol_name?: string;
    symbol_uid?: string;
    new_name: string;
    file_path?: string;
    dry_run?: boolean;
  }): Promise<any> {
    return this.renameSupport.rename(repo, params);
  }

  async impact(repo: RepoHandle, params: {
    target?: string;
    uid?: string;
    file_path?: string;
    direction: 'upstream' | 'downstream';
    maxDepth?: number;
    relationTypes?: string[];
    includeTests?: boolean;
    minConfidence?: number;
  }): Promise<any> {
    return this.impactSupport.impact(repo, params);
  }
}
