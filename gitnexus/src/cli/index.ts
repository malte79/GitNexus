#!/usr/bin/env node

import { Command } from 'commander';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createLazyAction } from './lazy-action.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json');
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('codenexus')
    .description('CodeNexus CLI for repo-local indexing and serving')
    .version(pkg.version);

  program
    .command('init')
    .description('Activate CodeNexus for the current repo boundary')
    .action(createLazyAction(() => import('./init.js'), 'initCommand'));

  program
    .command('index [path]')
    .description('Build or refresh the local .codenexus index')
    .option('-f, --force', 'Force full re-index even if up to date')
    .option('--index-only', 'Index without mutating repo files outside .codenexus/')
    .action(createLazyAction(() => import('./index-command.js'), 'indexCommand'));

  program
    .command('status')
    .description('Show CodeNexus status for the current repo boundary')
    .action(createLazyAction(() => import('./status.js'), 'statusCommand'));

  program
    .command('serve')
    .description('Start the repo-local CodeNexus service')
    .action(createLazyAction(() => import('./serve.js'), 'serveCommand'));

  program
    .command('info')
    .description('Print lifecycle and usage guidance for CodeNexus')
    .action(createLazyAction(() => import('./info.js'), 'infoCommand'));

  return program;
}

function isCliEntrypoint(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  buildProgram().parse(process.argv);
}
