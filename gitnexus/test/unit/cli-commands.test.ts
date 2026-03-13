import { describe, expect, it } from 'vitest';

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
        'help',
        'query',
        'context',
        'impact',
        'detect-changes',
        'cypher',
        'rename',
        'summary',
        'manage',
      ]);

      const manage = program.commands.find((command) => command.name() === 'manage');
      expect(manage?.commands.map((command) => command.name())).toEqual([
        'init',
        'index',
        'status',
        'serve',
        'start',
        'stop',
        'restart',
      ]);

      const impact = program.commands.find((command) => command.name() === 'impact');
      expect(impact?.options.map((option) => option.long)).toEqual(
        expect.arrayContaining(['--uid', '--file-path', '--direction', '--max-depth']),
      );
    });

    it('renders help for the new use-plane and manage-plane tree', async () => {
      const { buildProgram } = await import('../../src/cli/index.js');
      const help = buildProgram().helpInformation();

      expect(help).toContain('codenexus');
      expect(help).toContain('help');
      expect(help).toContain('query');
      expect(help).toContain('context');
      expect(help).toContain('impact');
      expect(help).toContain('detect-changes');
      expect(help).toContain('cypher');
      expect(help).toContain('rename');
      expect(help).toContain('summary');
      expect(help).toContain('manage');
      expect(help).not.toContain('\ninfo');
      expect(help).not.toContain('\ninit');
      expect(help).not.toContain('\nindex');
      expect(help).not.toContain('\nstatus');
      expect(help).not.toContain('\nserve');
      expect(help).not.toContain('\nstart');
      expect(help).not.toContain('\nstop');
      expect(help).not.toContain('\nrestart');
      expect(help).not.toContain('gitnexus');
    });
  });

  describe('legacy top-level guidance', () => {
    it('redirects old top-level admin commands to manage', async () => {
      const { handleLegacyTopLevelCommand } = await import('../../src/cli/index.js');
      const messages: string[] = [];

      expect(handleLegacyTopLevelCommand(['node', 'codenexus', 'status'], (line) => messages.push(line))).toBe(true);
      expect(messages.join('\n')).toContain('Use `codenexus manage status` instead.');
    });

    it('redirects codenexus info to codenexus help', async () => {
      const { handleLegacyTopLevelCommand } = await import('../../src/cli/index.js');
      const messages: string[] = [];

      expect(handleLegacyTopLevelCommand(['node', 'codenexus', 'info'], (line) => messages.push(line))).toBe(true);
      expect(messages.join('\n')).toContain('Use `codenexus help` instead.');
    });
  });

  describe('command modules', () => {
    it('exports helpCommand from the help surface module', async () => {
      const { helpCommand } = await import('../../src/cli/info.js');
      expect(typeof helpCommand).toBe('function');
    });

    it('exports top-level analysis commands', async () => {
      const { queryCommand } = await import('../../src/cli/query.js');
      const { contextCommand } = await import('../../src/cli/context.js');
      const { impactCommand } = await import('../../src/cli/impact.js');
      const { detectChangesCommand } = await import('../../src/cli/detect-changes.js');
      const { cypherCommand } = await import('../../src/cli/cypher.js');
      const { renameCommand } = await import('../../src/cli/rename.js');
      const { summaryCommand } = await import('../../src/cli/summary.js');

      expect(typeof queryCommand).toBe('function');
      expect(typeof contextCommand).toBe('function');
      expect(typeof impactCommand).toBe('function');
      expect(typeof detectChangesCommand).toBe('function');
      expect(typeof cypherCommand).toBe('function');
      expect(typeof renameCommand).toBe('function');
      expect(typeof summaryCommand).toBe('function');
    });
  });
});
