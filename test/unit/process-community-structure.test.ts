import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const processProcessorPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/process-processor.ts');
const communityProcessorPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/community-processor.ts');

describe('process/community structure guards', () => {
  it('keeps process-processor as a thin orchestration seam', () => {
    const source = fs.readFileSync(processProcessorPath, 'utf-8');

    expect(source).toContain("from './process-entry-point-support.js'");
    expect(source).toContain("from './process-trace-support.js'");
    expect(source).toContain("from './process-output-support.js'");
    expect(source).not.toContain('const findEntryPoints =');
    expect(source).not.toContain('const traceFromEntryPoint =');
    expect(source).not.toContain('const deduplicateTraces =');
    expect(source).not.toContain('const deduplicateByEndpoints =');
    expect(source).not.toContain('const buildCallsGraph =');
    expect(source).not.toContain('const buildReverseCallsGraph =');
  });

  it('keeps community-processor as a thin orchestration seam', () => {
    const source = fs.readFileSync(communityProcessorPath, 'utf-8');

    expect(source).toContain("from './community-graph-support.js'");
    expect(source).toContain("from './community-label-support.js'");
    expect(source).not.toContain('const buildGraphologyGraph =');
    expect(source).not.toContain('const createCommunityNodes =');
    expect(source).not.toContain('const generateHeuristicLabel =');
    expect(source).not.toContain('const calculateCohesion =');
    expect(source).not.toContain('const createSeededRng =');
  });
});
