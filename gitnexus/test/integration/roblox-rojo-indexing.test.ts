import { describe, expect, it } from 'vitest';
import path from 'path';
import { runPipelineFromRepo } from '../../src/core/ingestion/pipeline.js';

const MINI_ROJO_REPO = path.resolve(__dirname, '..', 'fixtures', 'mini-rojo-repo');

describe('Roblox Rojo indexing end-to-end', () => {
  it('resolves Rojo-aware Luau imports and runtime areas', async () => {
    const result = await runPipelineFromRepo(MINI_ROJO_REPO, () => {});

    expect(result.totalFileCount).toBe(6);
    expect(result.graph.nodeCount).toBeGreaterThan(0);
    expect(result.graph.relationshipCount).toBeGreaterThan(0);

    const fileAreas = new Map<string, string>();
    result.graph.forEachNode(node => {
      if (node.label === 'File' && node.properties.filePath) {
        fileAreas.set(node.properties.filePath, node.properties.runtimeArea || '');
      }
    });

    expect(fileAreas.get('src/shared/Log/init.lua')).toBe('shared');
    expect(fileAreas.get('src/client/UIBootstrap.client.lua')).toBe('client');
    expect(fileAreas.get('src/server/WorldBootstrap.server.lua')).toBe('server');

    const importEdges: Array<{ source: string; target: string }> = [];
    for (const rel of result.graph.iterRelationships()) {
      if (rel.type !== 'IMPORTS') continue;
      const source = result.graph.getNode(rel.sourceId);
      const target = result.graph.getNode(rel.targetId);
      if (!source || !target) continue;
      importEdges.push({
        source: source.properties.filePath,
        target: target.properties.filePath,
      });
    }

    expect(importEdges).toContainEqual({
      source: 'src/client/UIBootstrap.client.lua',
      target: 'src/shared/Log/init.lua',
    });
    expect(importEdges).toContainEqual({
      source: 'src/client/UIBootstrap.client.lua',
      target: 'src/client/UI/UIService.lua',
    });
    expect(importEdges).toContainEqual({
      source: 'src/server/WorldBootstrap.server.lua',
      target: 'src/shared/Log/init.lua',
    });
    expect(importEdges).toContainEqual({
      source: 'src/server/WorldBootstrap.server.lua',
      target: 'src/server/WorldReady.lua',
    });
  });
});
