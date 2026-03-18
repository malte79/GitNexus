import { describe, expect, it } from 'vitest';
import path from 'path';
import { runPipelineFromRepo } from '../../src/core/ingestion/pipeline.js';

const MINI_LUAU_REPO = path.resolve(__dirname, '..', 'fixtures', 'mini-luau-repo');

describe('Luau indexing end-to-end', () => {
  it('indexes a mini Luau repo and produces useful graph edges', async () => {
    const result = await runPipelineFromRepo(MINI_LUAU_REPO, () => {});

    expect(result.totalFileCount).toBe(3);
    expect(result.graph.nodeCount).toBeGreaterThan(0);
    expect(result.graph.relationshipCount).toBeGreaterThan(0);

    const fileNodes: string[] = [];
    const symbolNames: string[] = [];
    result.graph.forEachNode(node => {
      if (node.label === 'File') fileNodes.push(node.properties.filePath || node.properties.name);
      if (['Function', 'Method', 'TypeAlias'].includes(node.label)) {
        symbolNames.push(node.properties.name);
      }
    });

    expect(fileNodes).toContain('src/main.luau');
    expect(fileNodes).toContain('src/util.lua');
    expect(fileNodes).toContain('src/bootstrap.luau');
    expect(symbolNames).toContain('formatName');
    expect(symbolNames).toContain('formatAlias');
    expect(symbolNames).toContain('render');
    expect(symbolNames).toContain('slugify');
    expect(symbolNames).toContain('Request');

    const callEdges: Array<{ source: string; target: string }> = [];
    let importCount = 0;

    for (const rel of result.graph.iterRelationships()) {
      if (rel.type === 'IMPORTS') importCount++;
      if (rel.type === 'CALLS') {
        const source = result.graph.getNode(rel.sourceId);
        const target = result.graph.getNode(rel.targetId);
        if (source && target) {
          callEdges.push({
            source: source.properties.name,
            target: target.properties.name,
          });
        }
      }
    }

    expect(importCount).toBeGreaterThanOrEqual(2);
    expect(callEdges).toContainEqual({ source: 'formatName', target: 'slugify' });
    expect(callEdges).toContainEqual({ source: 'formatAlias', target: 'formatName' });
  });
});
