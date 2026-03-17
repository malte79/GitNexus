import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localBackendPath = path.resolve(import.meta.dirname, '../../src/mcp/local/local-backend.ts');
const overviewSupportPath = path.resolve(import.meta.dirname, '../../src/mcp/local/local-backend-overview-support.ts');

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
});
