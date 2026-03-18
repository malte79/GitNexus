import { describe, expect, it } from 'vitest';
import path from 'path';
import Parser from 'tree-sitter';
import Luau from 'tree-sitter-luau';
import { loadRojoProjectIndex } from '../../src/core/ingestion/roblox/rojo-project.js';
import { extractLuauRobloxAliasesAndImports, parseRobloxPathExpression } from '../../src/core/ingestion/roblox/luau-resolution.js';

const MINI_ROJO_REPO = path.resolve(__dirname, '..', 'fixtures', 'mini-rojo-repo');
const MINI_ROJO_FILES = [
  'src/shared/Log/init.lua',
  'src/client/UI/UIService.lua',
  'src/client/UIBootstrap.client.lua',
  'src/server/WorldReady.lua',
  'src/server/WorldBootstrap.server.lua',
];

describe('Rojo project mapping', () => {
  it('maps source files to deterministic DataModel targets and runtime areas', async () => {
    const project = await loadRojoProjectIndex(MINI_ROJO_REPO, MINI_ROJO_FILES);
    expect(project).not.toBeNull();

    const sharedTargets = project!.getTargetsForFile('src/shared/Log/init.lua');
    expect(sharedTargets[0]?.dataModelPath).toBe('ReplicatedStorage/Shared/Log');
    expect(sharedTargets[0]?.runtimeArea).toBe('shared');

    const clientTargets = project!.getTargetsForFile('src/client/UIBootstrap.client.lua');
    expect(clientTargets[0]?.dataModelPath).toBe('StarterPlayer/StarterPlayerScripts/UIBootstrap');
    expect(clientTargets[0]?.runtimeArea).toBe('client');

    const serverTargets = project!.getTargetsForFile('src/server/WorldBootstrap.server.lua');
    expect(serverTargets[0]?.dataModelPath).toBe('ServerScriptService/WorldBootstrap');
    expect(serverTargets[0]?.runtimeArea).toBe('server');

    expect(project!.resolveDataModelSegments(['ReplicatedStorage', 'Shared', 'Log']))
      .toContain('src/shared/Log/init.lua');
  });

  it('maps direct file mounts from default.project.json', async () => {
    const repoRoot = path.resolve(__dirname, '..', 'fixtures', 'mini-rojo-direct-file-repo');
    const project = await loadRojoProjectIndex(repoRoot, ['src/client/Main.client.lua']);
    expect(project).not.toBeNull();

    const targets = project!.getTargetsForFile('src/client/Main.client.lua');
    expect(targets).toHaveLength(1);
    expect(targets[0]?.dataModelPath).toBe('StarterPlayer/StarterPlayerScripts/Main');
    expect(targets[0]?.runtimeArea).toBe('client');
  });
});

describe('Roblox Luau path parsing', () => {
  const parser = new Parser();
  parser.setLanguage(Luau);

  const findFirstNamedNode = (root: Parser.SyntaxNode, type: string): Parser.SyntaxNode => {
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === type) return node;
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i);
        if (child) stack.push(child);
      }
    }
    throw new Error(`Node type not found: ${type}`);
  };

  it('parses GetService and WaitForChild chains conservatively', () => {
    const tree = parser.parse(`
      local ReplicatedStorage = game:GetService("ReplicatedStorage")
      local sharedRoot = ReplicatedStorage:WaitForChild("Shared")
      local Log = require(sharedRoot:WaitForChild("Log"))
      local UIService = require(script.Parent:WaitForChild("UI"):WaitForChild("UIService"))
    `);

    const imports = extractLuauRobloxAliasesAndImports(tree.rootNode, 'src/client/UIBootstrap.client.lua');
    const robloxImports = imports.filter(entry => entry.robloxPath);
    expect(robloxImports).toHaveLength(2);

    expect(robloxImports[0].robloxPath).toMatchObject({
      rootKind: 'service',
      serviceName: 'ReplicatedStorage',
      segments: ['Shared', 'Log'],
    });

    expect(robloxImports[1].robloxPath).toMatchObject({
      rootKind: 'script',
      parentDepth: 1,
      segments: ['UI', 'UIService'],
    });
  });

  it('parses direct script parent chains', () => {
    const tree = parser.parse('return require(script.Parent.Parent:WaitForChild("UI"):WaitForChild("DebugConsole"))');
    const requireCall = findFirstNamedNode(tree.rootNode, 'function_call');
    const args = requireCall.children.find(child => child.type === 'arguments');
    const argNode = args?.namedChild(0);
    const spec = parseRobloxPathExpression(argNode, new Map());
    expect(spec).toMatchObject({
      rootKind: 'script',
      parentDepth: 2,
      segments: ['UI', 'DebugConsole'],
    });
  });
});
