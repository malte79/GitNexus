import { describe, expect, it } from 'vitest';
import { renderHelpMarkdown, renderInfoMarkdown } from '../../src/cli/info.js';

describe('renderHelpMarkdown', () => {
  it('documents the use-plane and manage-plane command split', () => {
    const output = renderHelpMarkdown();

    expect(output).toContain('## Command Shape');
    expect(output).toContain('codenexus help');
    expect(output).toContain('codenexus query <terms...>');
    expect(output).toContain('codenexus query <terms...> --owners');
    expect(output).toContain('codenexus manage <subcommand>');
    expect(output).toContain('codenexus manage init');
    expect(output).toContain('codenexus manage index');
    expect(output).toContain('codenexus manage status');
    expect(output).toContain('codenexus manage start');
    expect(output).not.toContain('codenexus info');
  });

  it('explains the HTTP-service dependency and remediation path', () => {
    const output = renderHelpMarkdown();

    expect(output).toContain('## Service Requirement');
    expect(output).toContain('still use the repo-local MCP HTTP service');
    expect(output).toContain('normal remediation is');
    expect(output).toContain('codenexus manage start');
    expect(output).toContain('/api/mcp');
    expect(output).toContain('/api/health');
    expect(output).toContain('StreamableHTTPClientTransport');
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
    expect(output).toContain('typed bridge http lifecycle status start stop studio automation --owners');
    expect(output).toContain('CommandBridgeHandler');
    expect(output).toContain('context CommandBridgeHandler --file typed/bridge/http');
    expect(output).toContain('ProtocolRouter');
    expect(output).toContain('impact onTransportClosed --file-path typed/plugin/runtime/runtime_manager.lua --direction upstream --max-depth 4');
    expect(output).toContain('member_coverage');
    expect(output).toContain('summary --subsystems');
    expect(output).toContain('gitnexus://properties/File');
  });

  it('keeps the direct MCP path documented for advanced users', () => {
    const output = renderHelpMarkdown();

    expect(output).toContain('## Using The HTTP Service');
    expect(output).toContain("name: 'query'");
    expect(output).toContain("name: 'context'");
    expect(output).toContain("name: 'impact'");
    expect(output).toContain("name: 'cypher'");
    expect(output).toContain("name: 'detect_changes'");
    expect(output).toContain("name: 'rename'");
  });

  it('keeps renderInfoMarkdown as an alias for the help surface text', () => {
    expect(renderInfoMarkdown()).toBe(renderHelpMarkdown());
  });
});
