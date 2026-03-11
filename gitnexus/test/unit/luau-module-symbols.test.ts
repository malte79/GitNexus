import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import Luau from 'tree-sitter-luau';
import { extractLuauModuleSymbolCandidates } from '../../src/core/ingestion/luau-module-symbols.js';

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
    expect(candidates[0].methodRefs.map((method) => method.name).sort()).toEqual(['init', 'register']);
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
    expect(candidates[0].methodRefs.map((method) => method.name).sort()).toEqual(['hide', 'render']);
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
});
