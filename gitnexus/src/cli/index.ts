#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { createLazyAction } from './lazy-action.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json');
const program = new Command();

program
  .name('gitnexus')
  .description('GitNexus headless CLI for local indexing and MCP access')
  .version(pkg.version);

program
  .command('analyze [path]')
  .description('Index a repository into the local .codenexus state')
  .option('-f, --force', 'Force full re-index even if up to date')
  .option('--index-only', 'Index without mutating repo files outside .codenexus/')
  .action(createLazyAction(() => import('./analyze.js'), 'analyzeCommand'));

program
  .command('mcp')
  .description('Start the MCP server')
  .action(createLazyAction(() => import('./mcp.js'), 'mcpCommand'));

program
  .command('status')
  .description('Show index status for the current repo')
  .action(createLazyAction(() => import('./status.js'), 'statusCommand'));

program.parse(process.argv);
