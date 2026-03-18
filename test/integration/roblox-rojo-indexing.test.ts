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

  it('creates first-class module symbols for representative Rojo Luau modules', async () => {
    const result = await runPipelineFromRepo(MINI_ROJO_REPO, () => {});

    const modules = new Map<string, { filePath: string; description: string; runtimeArea?: string }>();
    const moduleDefines = new Set<string>();

    result.graph.forEachNode(node => {
      if (node.label !== 'Module') return;
      modules.set(node.properties.name, {
        filePath: node.properties.filePath,
        description: node.properties.description || '',
        runtimeArea: node.properties.runtimeArea,
      });
    });

    for (const rel of result.graph.iterRelationships()) {
      if (rel.type !== 'DEFINES') continue;
      const source = result.graph.getNode(rel.sourceId);
      const target = result.graph.getNode(rel.targetId);
      if (!source || !target || source.label !== 'Module' || target.label !== 'Method') continue;
      moduleDefines.add(`${source.properties.name}->${target.properties.name}`);
    }

    expect(modules.get('UIService')).toMatchObject({
      filePath: 'src/client/UI/UIService.lua',
      description: 'luau-module:strong:named-return-table',
      runtimeArea: 'client',
    });
    expect(modules.get('WorldReady')).toMatchObject({
      filePath: 'src/server/WorldReady.lua',
      description: 'luau-module:strong:named-return-table',
      runtimeArea: 'server',
    });
    expect(modules.get('Log')).toMatchObject({
      filePath: 'src/shared/Log/init.lua',
      description: 'luau-module:strong:named-return-table',
      runtimeArea: 'shared',
    });

    expect(moduleDefines).toContain('UIService->render');
    expect(moduleDefines).toContain('WorldReady->markReady');
    expect(moduleDefines).toContain('Log->info');
  });
});
