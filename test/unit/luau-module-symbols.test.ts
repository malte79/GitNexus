import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import Luau from 'tree-sitter-luau';
import { extractLuauLocalTableContainerCandidates, extractLuauModuleSymbolCandidates } from '../../src/core/ingestion/luau-module-symbols.js';

const parser = new Parser();
parser.setLanguage(Luau);

describe('extractLuauModuleSymbolCandidates', () => {
  it('extracts a strong named returned module table with methods', () => {
    const tree = parser.parse(`
      local SpotlightRegistry = {}

      function SpotlightRegistry.init()
        return true
      end

      SpotlightRegistry.register = function()
        return SpotlightRegistry.init()
      end

      return SpotlightRegistry
    `);

    const candidates = extractLuauModuleSymbolCandidates(tree.rootNode, 'src/shared/Spotlight/SpotlightRegistry.lua');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: 'SpotlightRegistry',
      confidence: 'strong',
      description: 'luau-module:strong:named-return-table',
    });
    expect(candidates[0].memberRefs.map((method) => method.name).sort()).toEqual(['init', 'register']);
  });

  it('extracts a weak module symbol from a returned table literal', () => {
    const tree = parser.parse(`
      return {
        render = function()
          return true
        end,
        hide = function()
          return false
        end,
      }
    `);

    const candidates = extractLuauModuleSymbolCandidates(tree.rootNode, 'src/client/UI/UIService.lua');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: 'UIService',
      confidence: 'weak',
      description: 'luau-module:weak:return-table-literal',
    });
    expect(candidates[0].memberRefs.map((method) => method.name).sort()).toEqual(['hide', 'render']);
  });

  it('records delegate targets for weak returned-table wrappers around existing module methods', () => {
    const tree = parser.parse(`
      local RuntimeManager = {}

      function RuntimeManager.new(config)
        return config
      end

      return {
        new = function(config)
          return RuntimeManager.new(config)
        end,
      }
    `);

    const candidates = extractLuauModuleSymbolCandidates(tree.rootNode, 'typed/plugin/runtime/runtime_manager.lua');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].memberRefs).toHaveLength(1);
    expect(candidates[0].memberRefs[0]).toMatchObject({
      name: 'new',
      targetBaseName: 'RuntimeManager',
      targetName: 'new',
    });
    expect(candidates[0].description).toContain('backing=RuntimeManager');
  });

  it('records delegate targets for weak returned-table wrappers around top-level functions', () => {
    const tree = parser.parse(`
      local function buildPayload(config)
        return config
      end

      return {
        createPayload = function(config)
          return Helpers.buildPayload(config)
        end,
      }
    `);

    const candidates = extractLuauModuleSymbolCandidates(tree.rootNode, 'typed/plugin/runtime/helpers.lua');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].memberRefs).toHaveLength(1);
    expect(candidates[0].memberRefs[0]).toMatchObject({
      name: 'createPayload',
      targetName: 'buildPayload',
    });
  });

  it('records exported property fields from weak returned-table wrappers', () => {
    const tree = parser.parse(`
      local DEFAULTS = {
        timeout = 5,
      }

      local RuntimeManager = {}

      function RuntimeManager.new(config)
        return config
      end

      return {
        new = function(config)
          return RuntimeManager.new(config)
        end,
        DEFAULTS = DEFAULTS,
      }
    `);

    const candidates = extractLuauModuleSymbolCandidates(tree.rootNode, 'typed/plugin/runtime/runtime_manager.lua');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].memberRefs.map((member) => member.name).sort()).toEqual(['DEFAULTS', 'new']);
    expect(candidates[0].memberRefs.find((member) => member.name === 'DEFAULTS')).toMatchObject({
      label: 'Property',
      targetName: 'DEFAULTS',
      synthetic: true,
    });
  });

  it('does not synthesize a module symbol for a plain local table that is never returned', () => {
    const tree = parser.parse(`
      local InternalCache = {}

      function InternalCache.store()
        return true
      end
    `);

    const candidates = extractLuauModuleSymbolCandidates(tree.rootNode, 'src/shared/InternalCache.lua');
    expect(candidates).toEqual([]);
  });

  it('extracts grounded local-table containers for non-exported Luau method tables', () => {
    const tree = parser.parse(`
      local RuntimeManager = {}

      function RuntimeManager.new(config)
        return config
      end

      function RuntimeManager.stop()
        return true
      end

      return {
        new = function(config)
          return RuntimeManager.new(config)
        end,
      }
    `);

    const containers = extractLuauLocalTableContainerCandidates(tree.rootNode);
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      name: 'RuntimeManager',
      description: 'luau-module:local-table',
    });
    expect(containers[0].memberRefs.map((member) => member.name).sort()).toEqual(['new', 'stop']);
  });

  it('does not extract unrelated local tables that are never referenced by a weak returned wrapper', () => {
    const tree = parser.parse(`
      local InternalState = {}

      function InternalState.bump()
        return true
      end

      return {
        new = function()
          return {}
        end,
      }
    `);

    const containers = extractLuauLocalTableContainerCandidates(tree.rootNode);
    expect(containers).toEqual([]);
  });
});
