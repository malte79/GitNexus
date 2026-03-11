import { describe, expect, it } from 'vitest';
import { renderInfoMarkdown } from '../../src/cli/info.js';

describe('renderInfoMarkdown', () => {
  it('includes the full lifecycle commands', () => {
    const output = renderInfoMarkdown();

    expect(output).toContain('codenexus init');
    expect(output).toContain('codenexus index');
    expect(output).toContain('codenexus status');
    expect(output).toContain('codenexus serve');
  });

  it('includes AGENTS guidance and restart-after-reindex behavior', () => {
    const output = renderInfoMarkdown();

    expect(output).toContain('Suggested AGENTS.md Snippet');
    expect(output).toContain('restart `codenexus serve` after reindexing');
    expect(output).toContain('`.codenexus/`');
  });

  it('calls out planning, implementing, and refactoring guidance', () => {
    const output = renderInfoMarkdown();

    expect(output).toContain('### Planning');
    expect(output).toContain('### Implementing');
    expect(output).toContain('### Refactoring');
    expect(output).toContain('will use it as part of normal code analysis');
    expect(output).toContain('Agents should use CodeNexus aggressively for refactors');
  });
});
