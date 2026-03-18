import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localBackendPath = path.resolve(import.meta.dirname, '../../src/mcp/local/local-backend.ts');
const overviewSupportPath = path.resolve(import.meta.dirname, '../../src/mcp/local/local-backend-overview-support.ts');
const searchSupportPath = path.resolve(import.meta.dirname, '../../src/mcp/local/local-backend-search-support.ts');
const analysisSupportPath = path.resolve(import.meta.dirname, '../../src/mcp/local/local-backend-analysis-support.ts');

describe('LocalBackend structure', () => {
  it('keeps the public seam thin and delegated', () => {
    const source = fs.readFileSync(localBackendPath, 'utf-8');
    const lineCount = source.split(/\r?\n/).length;

    expect(lineCount).toBeLessThanOrEqual(350);
    expect(source).toContain("import { LocalBackendCypherSupport } from './local-backend-cypher-support.js';");
    expect(source).toContain("import { LocalBackendOverviewSupport } from './local-backend-overview-support.js';");
    expect(source).toContain("import { LocalBackendSummaryPresentationSupport } from './local-backend-summary-presentation-support.js';");
    expect(source).toContain("import { LocalBackendSummaryQuerySupport } from './local-backend-summary-query-support.js';");
    expect(source).not.toContain("import { executeQuery");
    expect(source).not.toContain("import { executeParameterized");
    expect(source).not.toContain('getNodeProperties');
    expect(source).not.toContain('getPropertyResourceUri');
  });

  it('keeps overview cluster and process loading delegated to summary queries', () => {
    const source = fs.readFileSync(overviewSupportPath, 'utf-8');

    expect(source).toContain('this.summaryQueries.getClustersForOverview(repo, limit)');
    expect(source).toContain('this.summaryQueries.getProcessesForOverview(repo, limit)');
    expect(source).not.toContain("MATCH (c:Community)");
    expect(source).not.toContain("MATCH (p:Process)");
  });

  it('keeps search support thin and delegated to focused owners', () => {
    const source = fs.readFileSync(searchSupportPath, 'utf-8');
    const lineCount = source.split(/\r?\n/).length;

    expect(lineCount).toBeLessThanOrEqual(80);
    expect(source).toContain("import { LocalBackendSearchLookupSupport } from './local-backend-search-lookup-support.js';");
    expect(source).toContain("import { LocalBackendSearchEnrichmentSupport } from './local-backend-search-enrichment-support.js';");
    expect(source).toContain("import { LocalBackendSearchRankingSupport } from './local-backend-search-ranking-support.js';");
    expect(source).toContain("import { LocalBackendSearchQuerySupport } from './local-backend-search-query-support.js';");
    expect(source).not.toContain('executeQuery(');
    expect(source).not.toContain('executeParameterized(');
    expect(source).not.toContain('MATCH (');
  });

  it('keeps analysis support thin and delegated to focused owners', () => {
    const source = fs.readFileSync(analysisSupportPath, 'utf-8');
    const lineCount = source.split(/\r?\n/).length;

    expect(lineCount).toBeLessThanOrEqual(90);
    expect(source).toContain("import { LocalBackendShapeSupport } from './local-backend-shape-support.js';");
    expect(source).toContain("import { LocalBackendContextSupport } from './local-backend-context-support.js';");
    expect(source).toContain("import { LocalBackendDetectChangesSupport } from './local-backend-detect-changes-support.js';");
    expect(source).toContain("import { LocalBackendRenameSupport } from './local-backend-rename-support.js';");
    expect(source).toContain("import { LocalBackendImpactSupport } from './local-backend-impact-support.js';");
    expect(source).not.toContain('executeQuery(');
    expect(source).not.toContain('executeParameterized(');
    expect(source).not.toContain('MATCH (');
  });
});
