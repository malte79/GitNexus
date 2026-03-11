import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSync } = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync,
  },
}));

import { resolveCliInvocation } from '../../src/cli/entrypoint-path.js';

describe('resolveCliInvocation', () => {
  beforeEach(() => {
    existsSync.mockReset();
  });

  it('prefers the sibling built cli entrypoint when it exists', () => {
    existsSync.mockReturnValue(true);

    const result = resolveCliInvocation(['serve']);

    expect(result.command).toBe(process.execPath);
    expect(result.args[0]).toMatch(/(?:^|[/\\])cli[/\\]index\.js$/);
    expect(result.args[1]).toBe('serve');
  });

  it('falls back to the built dist entrypoint when the sibling is absent', () => {
    existsSync
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const result = resolveCliInvocation(['index', '/repo']);

    expect(result.command).toBe(process.execPath);
    expect(result.args[0]).toMatch(/(?:^|[/\\])dist[/\\]cli[/\\]index\.js$/);
    expect(result.args[1]).toBe('index');
    expect(result.args[2]).toBe('/repo');
  });

  it('throws a build requirement error when no built cli entrypoint exists', () => {
    existsSync
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    expect(() => resolveCliInvocation(['index', '/repo'])).toThrow(
      'Run `npm run build --prefix gitnexus` before using background service commands from a source checkout.',
    );
  });
});
