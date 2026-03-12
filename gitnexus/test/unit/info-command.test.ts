import { describe, expect, it } from 'vitest';
import { renderInfoMarkdown } from '../../src/cli/info.js';

describe('renderInfoMarkdown', () => {
  it('includes the full lifecycle commands', () => {
    const output = renderInfoMarkdown();

    expect(output).toContain('codenexus init');
    expect(output).toContain('codenexus index');
    expect(output).toContain('codenexus status');
    expect(output).toContain('codenexus serve');
    expect(output).toContain('codenexus start');
    expect(output).toContain('codenexus stop');
    expect(output).toContain('codenexus restart');
  });

  it('includes AGENTS guidance and live-reload behavior', () => {
    const output = renderInfoMarkdown();

    expect(output).toContain('Suggested AGENTS.md Snippet');
    expect(output).toContain('live service adopts rebuilt indexes automatically in the normal path');
    expect(output).toContain('if live reload fails, use `codenexus restart`');
    expect(output).toContain('background auto-indexing by default on a 5 minute interval');
    expect(output).toContain('`.codenexus/`');
    expect(output).toContain('/api/mcp');
  });

  it('calls out planning, implementing, and refactoring guidance', () => {
    const output = renderInfoMarkdown();

    expect(output).toContain('### Planning');
    expect(output).toContain('### Implementing');
    expect(output).toContain('### Refactoring');
    expect(output).toContain('### Background Freshness');
    expect(output).toContain('will use it as part of normal code analysis');
    expect(output).toContain('Agents should use CodeNexus aggressively for refactors');
  });

  it('documents how to use the HTTP service and supported tool calls', () => {
    const output = renderInfoMarkdown();

    expect(output).toContain('## Using The HTTP Service');
    expect(output).toContain('http://127.0.0.1:4747/api/health');
    expect(output).toContain('http://127.0.0.1:4747/api/mcp');
    expect(output).toContain('Streamable HTTP');
    expect(output).toContain('StreamableHTTPClientTransport');
    expect(output).toContain("name: 'query'");
    expect(output).toContain("name: 'context'");
    expect(output).toContain("name: 'impact'");
    expect(output).toContain("name: 'cypher'");
    expect(output).toContain("name: 'detect_changes'");
    expect(output).toContain("name: 'rename'");
  });
});
