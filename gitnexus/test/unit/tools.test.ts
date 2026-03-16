import { describe, it, expect } from 'vitest';
import { GITNEXUS_TOOLS } from '../../src/mcp/tools.js';

describe('GITNEXUS_TOOLS', () => {
  it('exports exactly 7 tools', () => {
    expect(GITNEXUS_TOOLS).toHaveLength(7);
  });

  it('contains the expected bound-repo tool names', () => {
    expect(GITNEXUS_TOOLS.map(t => t.name)).toEqual(
      expect.arrayContaining([
        'query',
        'cypher',
        'context',
        'detect_changes',
        'rename',
        'impact',
        'summary',
      ]),
    );
  });

  it('does not expose list_repos', () => {
    expect(GITNEXUS_TOOLS.find(t => t.name === 'list_repos')).toBeUndefined();
  });

  it('does not expose repo parameters on active tools', () => {
    for (const tool of GITNEXUS_TOOLS) {
      expect(tool.inputSchema.properties.repo).toBeUndefined();
    }
  });

  it('query tool requires query', () => {
    const queryTool = GITNEXUS_TOOLS.find(t => t.name === 'query')!;
    expect(queryTool.inputSchema.required).toContain('query');
  });

  it('cypher tool requires query', () => {
    const cypherTool = GITNEXUS_TOOLS.find(t => t.name === 'cypher')!;
    expect(cypherTool.inputSchema.required).toContain('query');
  });

  it('impact tool requires direction and exposes disambiguation inputs', () => {
    const impactTool = GITNEXUS_TOOLS.find(t => t.name === 'impact')!;
    expect(impactTool.inputSchema.required).toEqual(expect.arrayContaining(['direction']));
    expect(impactTool.inputSchema.properties.target).toBeDefined();
    expect(impactTool.inputSchema.properties.uid).toBeDefined();
    expect(impactTool.inputSchema.properties.file_path).toBeDefined();
  });

  it('summary tool exposes concise and detailed subsystem controls', () => {
    const summaryTool = GITNEXUS_TOOLS.find(t => t.name === 'summary')!;
    expect(summaryTool.inputSchema.properties.showSubsystems).toBeDefined();
    expect(summaryTool.inputSchema.properties.showSubsystemDetails).toBeDefined();
  });

  it('rename tool requires new_name', () => {
    const renameTool = GITNEXUS_TOOLS.find(t => t.name === 'rename')!;
    expect(renameTool.inputSchema.required).toContain('new_name');
  });
});
