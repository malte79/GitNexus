import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/cli/init.js', () => ({
  initCommand: vi.fn(),
}));
vi.mock('../../src/cli/index-command.js', () => ({
  indexCommand: vi.fn(),
}));
vi.mock('../../src/cli/serve.js', () => ({
  serveCommand: vi.fn(),
}));

describe('CLI commands', () => {
  describe('version', () => {
    it('package.json has a valid version string', async () => {
      const pkg = await import('../../package.json', { with: { type: 'json' } });
      expect(pkg.default.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('package.json scripts', () => {
    it('has test scripts configured', async () => {
      const pkg = await import('../../package.json', { with: { type: 'json' } });
      expect(pkg.default.scripts.test).toBeDefined();
      expect(pkg.default.scripts['test:integration']).toBeDefined();
      expect(pkg.default.scripts['test:all']).toBeDefined();
    });

    it('has build script', async () => {
      const pkg = await import('../../package.json', { with: { type: 'json' } });
      expect(pkg.default.scripts.build).toBeDefined();
    });
  });

  describe('package.json bin entry', () => {
    it('exposes only the codenexus binary', async () => {
      const pkg = await import('../../package.json', { with: { type: 'json' } });
      expect(pkg.default.bin).toBeDefined();
      expect(pkg.default.bin.codenexus || pkg.default.bin).toBeDefined();
      expect(pkg.default.bin.gitnexus).toBeUndefined();
    });
  });

  describe('buildProgram', () => {
    it('registers the canonical command tree', async () => {
      const { buildProgram } = await import('../../src/cli/index.js');
      const program = buildProgram();

      expect(program.name()).toBe('codenexus');
      expect(program.commands.map((command) => command.name())).toEqual([
        'init',
        'index',
        'status',
        'serve',
      ]);
    });

    it('renders help for the codenexus command tree', async () => {
      const { buildProgram } = await import('../../src/cli/index.js');
      const help = buildProgram().helpInformation();

      expect(help).toContain('codenexus');
      expect(help).toContain('init');
      expect(help).toContain('index');
      expect(help).toContain('status');
      expect(help).toContain('serve');
      expect(help).not.toContain('analyze');
      expect(help).not.toContain('\nmcp');
      expect(help).not.toContain('gitnexus');
    });
  });

  describe('initCommand', () => {
    it('is a function', async () => {
      const { initCommand } = await import('../../src/cli/init.js');
      expect(typeof initCommand).toBe('function');
    });
  });

  describe('indexCommand', () => {
    it('is a function', async () => {
      const { indexCommand } = await import('../../src/cli/index-command.js');
      expect(typeof indexCommand).toBe('function');
    });
  });

  describe('serveCommand', () => {
    it('is a function', async () => {
      const { serveCommand } = await import('../../src/cli/serve.js');
      expect(typeof serveCommand).toBe('function');
    });
  });
});
