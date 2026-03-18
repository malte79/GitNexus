#!/usr/bin/env node

import { Command } from 'commander';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createLazyAction } from './lazy-action.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json');

const LEGACY_TOP_LEVEL_REDIRECTS: Record<string, string> = {
  init: 'gnexus manage init',
  index: 'gnexus manage index',
  status: 'gnexus manage status',
  serve: 'gnexus manage serve',
  start: 'gnexus manage start',
  stop: 'gnexus manage stop',
  restart: 'gnexus manage restart',
  info: 'gnexus help',
};

function buildManageCommand(): Command {
  const manage = new Command('manage');

  manage
    .description('Manage repo-local GNexus setup, indexing, and service lifecycle')
    .command('init')
    .description('Activate GNexus for the current repo boundary')
    .action(createLazyAction(() => import('./init.js'), 'initCommand'));

  manage
    .command('index [path]')
    .description('Build or refresh the local .gnexus index')
    .option('-f, --force', 'Force full re-index even if up to date')
    .option('--index-only', 'Index without mutating repo files outside .gnexus/')
    .action(createLazyAction(() => import('./index-command.js'), 'indexCommand'));

  manage
    .command('status')
    .description('Show GNexus status for the current repo boundary')
    .action(createLazyAction(() => import('./status.js'), 'statusCommand'));

  manage
    .command('serve')
    .description('Start the repo-local GNexus service in the foreground')
    .action(createLazyAction(() => import('./serve.js'), 'serveCommand'));

  manage
    .command('start')
    .description('Start the repo-local GNexus service in background mode')
    .action(createLazyAction(() => import('./start.js'), 'startCommand'));

  manage
    .command('stop')
    .description('Stop the repo-local GNexus background service')
    .action(createLazyAction(() => import('./stop.js'), 'stopCommand'));

  manage
    .command('restart')
    .description('Restart the repo-local GNexus background service')
    .action(createLazyAction(() => import('./restart.js'), 'restartCommand'));

  return manage;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('gnexus')
    .description('GNexus CLI for repo-local indexing and serving')
    .version(pkg.version)
    .helpCommand(false);

  program
    .command('help')
    .description('Show usage guidance for GNexus analysis and management')
    .action(createLazyAction(() => import('./info.js'), 'helpCommand'));

  program
    .command('query [terms...]')
    .description('Query the bound repo for symbols and execution flows related to a concept')
    .option('--task-context <text>', 'What you are working on')
    .option('--goal <text>', 'What you want to find')
    .option('--owners', 'Bias results toward likely production owners for broad subsystem discovery')
    .option('--limit <number>', 'Max processes to return', (value) => Number.parseInt(value, 10))
    .option('--max-symbols <number>', 'Max symbols per process', (value) => Number.parseInt(value, 10))
    .option('--include-content', 'Include full symbol source code')
    .action(createLazyAction(() => import('./query.js'), 'queryCommand'));

  program
    .command('context [name]')
    .description('Show callers, callees, and process context for one symbol in the bound repo')
    .option('--uid <uid>', 'Direct symbol UID from prior results')
    .option('--file-path <path>', 'File path to disambiguate common names')
    .option('--file <path>', 'Shorthand alias for --file-path')
    .option('--include-content', 'Include full symbol source code')
    .action(createLazyAction(() => import('./context.js'), 'contextCommand'));

  program
    .command('impact [target]')
    .description('Analyze the blast radius of changing a symbol in the bound repo')
    .option('--uid <uid>', 'Direct symbol UID from prior results')
    .option('--file-path <path>', 'File path to disambiguate common names')
    .requiredOption('--direction <direction>', 'Impact direction: upstream or downstream')
    .option('--max-depth <number>', 'Max relationship depth', (value) => Number.parseInt(value, 10))
    .option('--relation-type <type...>', 'Filter relation types (CALLS, IMPORTS, EXTENDS, IMPLEMENTS)')
    .option('--include-tests', 'Include test files')
    .option('--min-confidence <number>', 'Minimum relationship confidence', Number.parseFloat)
    .action(createLazyAction(() => import('./impact.js'), 'impactCommand'));

  program
    .command('detect-changes')
    .description('Analyze local git changes and affected execution flows in the bound repo')
    .option('--scope <scope>', 'unstaged, staged, all, or compare')
    .option('--base-ref <ref>', 'Branch or commit for compare scope')
    .action(createLazyAction(() => import('./detect-changes.js'), 'detectChangesCommand'));

  program
    .command('cypher [terms...]')
    .description('Run a read-only Cypher query against the bound repo graph')
    .action(createLazyAction(() => import('./cypher.js'), 'cypherCommand'));

  program
    .command('rename [symbolName]')
    .description('Preview or apply a coordinated multi-file symbol rename')
    .requiredOption('--new-name <name>', 'New symbol name')
    .option('--uid <uid>', 'Direct symbol UID from prior results')
    .option('--file-path <path>', 'File path to disambiguate common names')
    .option('--apply', 'Apply edits instead of previewing them')
    .action(createLazyAction(() => import('./rename.js'), 'renameCommand'));

  program
    .command('summary')
    .description('Show a compact structural summary of the bound repo')
    .option('--limit <number>', 'Max clusters or processes to return', (value) => Number.parseInt(value, 10))
    .option('--no-clusters', 'Skip module or subsystem summary')
    .option('--no-processes', 'Skip process summary')
    .option('--subsystems', 'Show the concise subsystem-oriented architectural summary')
    .option('--subsystems-detailed', 'Show the detailed subsystem-oriented architectural summary')
    .action(createLazyAction(() => import('./summary.js'), 'summaryCommand'));

  program.addCommand(buildManageCommand());

  return program;
}

export function handleLegacyTopLevelCommand(
  argv: string[],
  writeLine: (message: string) => void = console.error,
): boolean {
  const command = argv[2];
  if (!command) return false;

  const redirect = LEGACY_TOP_LEVEL_REDIRECTS[command];
  if (!redirect) return false;

  writeLine(`Top-level \`${command}\` was removed. Use \`${redirect}\` instead.`);
  return true;
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
  if (handleLegacyTopLevelCommand(process.argv)) {
    process.exitCode = 1;
  } else {
  buildProgram().parse(process.argv);
  }
}
