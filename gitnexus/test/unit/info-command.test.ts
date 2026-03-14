import { describe, expect, it } from 'vitest';
import { renderHelpMarkdown, renderInfoMarkdown } from '../../src/cli/info.js';

describe('renderHelpMarkdown', () => {
  it('documents the use-plane and manage-plane command split', () => {
    const output = renderHelpMarkdown();

    expect(output).toContain('# CodeNexus');
    expect(output).toContain('## Everyday Commands');
    expect(output).toContain('## Admin Commands');
    expect(output).toContain('codenexus query');
    expect(output).toContain('codenexus query --owners');
    expect(output).toContain('codenexus context');
    expect(output).toContain('codenexus impact');
    expect(output).toContain('codenexus summary --subsystems');
    expect(output).toContain('codenexus manage init');
    expect(output).toContain('codenexus manage index');
    expect(output).toContain('codenexus manage status');
    expect(output).toContain('codenexus manage start');
    expect(output).not.toContain('codenexus info');
  });

  it('stays CLI-first and task-oriented', () => {
    const output = renderHelpMarkdown();

    expect(output).toContain('## Normal Workflow');
    expect(output).toContain('## Recovery');
    expect(output).toContain('codenexus manage start');
    expect(output).toContain('codenexus manage index');
    expect(output).toContain('codenexus manage restart');
  });

  it('includes brief use cases and example queries for supported command types', () => {
    const output = renderHelpMarkdown();

    expect(output).toContain('### `query`');
    expect(output).toContain('### `context`');
    expect(output).toContain('### `impact`');
    expect(output).toContain('### `detect-changes`');
    expect(output).toContain('### `cypher`');
    expect(output).toContain('### `rename`');
    expect(output).toContain('### `summary`');
    expect(output).toContain('bridge http lifecycle status start stop studio automation');
    expect(output).toContain('bridge http lifecycle status start stop studio automation --owners');
    expect(output).toContain('CommandBridgeHandler');
    expect(output).toContain('context CommandBridgeHandler --file typed/bridge/http');
    expect(output).toContain('ProtocolRouter');
    expect(output).toContain('impact onTransportClosed --file-path typed/plugin/runtime/runtime_manager.lua --direction upstream --max-depth 4');
    expect(output).toContain('summary --subsystems');
  });

  it('removes stale GitNexus and transport details from default help', () => {
    const output = renderHelpMarkdown();

    expect(output).not.toContain('GitNexus');
    expect(output).not.toContain('gitnexus://');
    expect(output).not.toContain('MCP');
    expect(output).not.toContain('/api/mcp');
    expect(output).not.toContain('/api/health');
    expect(output).not.toContain('StreamableHTTPClientTransport');
    expect(output).not.toContain('/Users/alex/Projects/GitNexusFork-agent-1/gitnexus');
  });

  it('keeps renderInfoMarkdown as an alias for the help surface text', () => {
    expect(renderInfoMarkdown()).toBe(renderHelpMarkdown());
  });
});
