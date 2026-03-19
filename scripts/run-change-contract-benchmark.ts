#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  compareBenchmarkRuns,
  discoverBenchmarkFixtureFiles,
  loadBenchmarkCorpus,
  loadBenchmarkRun,
  validateBenchmarkCorpus,
  validateBenchmarkRun,
} from './change-contract-benchmark-support.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[current.slice(2)] = 'true';
      continue;
    }
    args[current.slice(2)] = next;
    index += 1;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixturesDir = args.fixtures || path.resolve('test/fixtures/change-contract-benchmark');
  const corpusFiles = discoverBenchmarkFixtureFiles(fixturesDir);

  if (corpusFiles.length === 0) {
    throw new Error(`No benchmark corpus JSON files found in ${fixturesDir}`);
  }

  for (const corpusFile of corpusFiles) {
    const corpus = loadBenchmarkCorpus(corpusFile);
    const issues = validateBenchmarkCorpus(corpus);
    if (issues.length > 0) {
      throw new Error(`Invalid benchmark corpus ${path.basename(corpusFile)}:\n- ${issues.join('\n- ')}`);
    }
  }

  if (args.baseline && args.candidate) {
    const corpus = loadBenchmarkCorpus(corpusFiles[0]);
    const baseline = loadBenchmarkRun(args.baseline);
    const candidate = loadBenchmarkRun(args.candidate);

    const baselineIssues = validateBenchmarkRun(baseline, corpus);
    const candidateIssues = validateBenchmarkRun(candidate, corpus);
    if (baselineIssues.length > 0) {
      throw new Error(`Baseline run is invalid:\n- ${baselineIssues.join('\n- ')}`);
    }
    if (candidateIssues.length > 0) {
      throw new Error(`Candidate run is invalid:\n- ${candidateIssues.join('\n- ')}`);
    }

    const comparison = compareBenchmarkRuns(corpus, baseline, candidate);
    const serialized = `${JSON.stringify(comparison, null, 2)}\n`;
    if (args['write-comparison']) {
      fs.mkdirSync(path.dirname(args['write-comparison']), { recursive: true });
      fs.writeFileSync(args['write-comparison'], serialized);
    }
    process.stdout.write(serialized);
    return;
  }

  if (args.run) {
    const corpus = loadBenchmarkCorpus(corpusFiles[0]);
    const run = loadBenchmarkRun(args.run);
    const issues = validateBenchmarkRun(run, corpus);
    if (issues.length > 0) {
      throw new Error(`Benchmark run is invalid:\n- ${issues.join('\n- ')}`);
    }
    process.stdout.write(JSON.stringify({
      run: path.basename(args.run),
      validation: 'ok',
    }, null, 2) + '\n');
    return;
  }

  process.stdout.write(JSON.stringify({
    corpus_files: corpusFiles.map((filePath) => path.basename(filePath)),
    validation: 'ok',
  }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
