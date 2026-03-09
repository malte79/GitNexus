import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serveCommand } from '../../src/cli/serve.js';

describe('serveCommand', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = 0;
    errorSpy.mockClear();
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  it('fails clearly until the HTTP lifecycle exists', async () => {
    await serveCommand();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('not implemented yet');
  });
});
