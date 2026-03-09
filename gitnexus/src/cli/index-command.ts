/**
 * Index Command
 *
 * Indexes a repository and stores the knowledge graph in .codenexus/
 */

import path from 'path';
import { execFileSync } from 'child_process';
import v8 from 'v8';
import cliProgress from 'cli-progress';
import fs from 'fs/promises';
import { runPipelineFromRepo } from '../core/ingestion/pipeline.js';
import {
  initKuzu,
  loadGraphToKuzu,
  getKuzuStats,
  closeKuzu,
  createFTSIndex,
} from '../core/kuzu/kuzu-adapter.js';
import { getStoragePaths, saveMeta, loadConfig, loadMeta } from '../storage/repo-manager.js';
import { getCurrentBranch, getCurrentCommit, isGitRepo, getGitRoot, isWorkingTreeDirty } from '../storage/git.js';

const HEAP_MB = 8192;
const HEAP_FLAG = `--max-old-space-size=${HEAP_MB}`;

function ensureHeap(): boolean {
  const nodeOpts = process.env.NODE_OPTIONS || '';
  if (nodeOpts.includes('--max-old-space-size')) return false;

  const v8Heap = v8.getHeapStatistics().heap_size_limit;
  if (v8Heap >= HEAP_MB * 1024 * 1024 * 0.9) return false;

  try {
    execFileSync(process.execPath, [HEAP_FLAG, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: `${nodeOpts} ${HEAP_FLAG}`.trim() },
    });
  } catch (e: any) {
    process.exitCode = e.status ?? 1;
  }
  return true;
}

export interface IndexOptions {
  force?: boolean;
  indexOnly?: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  extracting: 'Scanning files',
  structure: 'Building structure',
  parsing: 'Parsing code',
  imports: 'Resolving imports',
  calls: 'Tracing calls',
  heritage: 'Extracting inheritance',
  communities: 'Detecting communities',
  processes: 'Detecting processes',
  complete: 'Pipeline complete',
  kuzu: 'Loading into KuzuDB',
  fts: 'Creating search indexes',
  done: 'Done',
};

export const indexCommand = async (
  inputPath?: string,
  options?: IndexOptions,
) => {
  if (ensureHeap()) return;

  console.log('\n  CodeNexus Indexer\n');

  let repoPath: string;
  if (inputPath) {
    const resolvedPath = path.resolve(inputPath);
    const gitRoot = getGitRoot(resolvedPath);
    if (!gitRoot) {
      console.log('  Not a git repository\n');
      process.exitCode = 1;
      return;
    }
    repoPath = gitRoot;
  } else {
    const gitRoot = getGitRoot(process.cwd());
    if (!gitRoot) {
      console.log('  Not inside a git repository\n');
      process.exitCode = 1;
      return;
    }
    repoPath = gitRoot;
  }

  if (!isGitRepo(repoPath)) {
    console.log('  Not a git repository\n');
    process.exitCode = 1;
    return;
  }

  const { storagePath, kuzuPath } = getStoragePaths(repoPath);
  const config = await loadConfig(storagePath);
  if (!config) {
    console.log('  Repo is not initialized for CodeNexus\n');
    console.log('  Missing or invalid .codenexus/config.toml\n');
    console.log('  Run `codenexus init` first.\n');
    process.exitCode = 1;
    return;
  }

  const currentCommit = getCurrentCommit(repoPath);
  const currentBranch = getCurrentBranch(repoPath);
  const currentDirty = isWorkingTreeDirty(repoPath);
  const existingMeta = await loadMeta(storagePath);

  if (
    existingMeta &&
    !options?.force &&
    !currentDirty &&
    existingMeta.indexed_head === currentCommit &&
    existingMeta.indexed_branch === currentBranch &&
    existingMeta.worktree_root === repoPath &&
    !existingMeta.indexed_dirty
  ) {
    console.log('  Already up to date\n');
    return;
  }

  const bar = new cliProgress.SingleBar({
    format: '  {bar} {percentage}% | {phase}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    barGlue: '',
    autopadding: true,
    clearOnComplete: false,
    stopOnComplete: false,
  }, cliProgress.Presets.shades_grey);

  bar.start(100, 0, { phase: 'Initializing...' });

  let aborted = false;
  const sigintHandler = () => {
    if (aborted) process.exit(1);
    aborted = true;
    bar.stop();
    console.log('\n  Interrupted — cleaning up...');
    closeKuzu().catch(() => {}).finally(() => process.exit(130));
  };
  process.on('SIGINT', sigintHandler);

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const barLog = (...args: any[]) => {
    process.stdout.write('\x1b[2K\r');
    origLog(args.map(a => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  console.log = barLog;
  console.warn = barLog;
  console.error = barLog;

  let lastPhaseLabel = 'Initializing...';
  let phaseStart = Date.now();

  const updateBar = (value: number, phaseLabel: string) => {
    if (phaseLabel !== lastPhaseLabel) {
      lastPhaseLabel = phaseLabel;
      phaseStart = Date.now();
    }
    const elapsed = Math.round((Date.now() - phaseStart) / 1000);
    const display = elapsed >= 3 ? `${phaseLabel} (${elapsed}s)` : phaseLabel;
    bar.update(value, { phase: display });
  };

  const elapsedTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - phaseStart) / 1000);
    if (elapsed >= 3) {
      bar.update({ phase: `${lastPhaseLabel} (${elapsed}s)` });
    }
  }, 1000);

  const t0Global = Date.now();

  const pipelineResult = await runPipelineFromRepo(repoPath, (progress) => {
    const phaseLabel = PHASE_LABELS[progress.phase] || progress.phase;
    const scaled = Math.round(progress.percent * 0.6);
    updateBar(scaled, phaseLabel);
  });

  updateBar(60, 'Loading into KuzuDB...');

  await closeKuzu();
  const kuzuFiles = [kuzuPath, `${kuzuPath}.wal`, `${kuzuPath}.lock`];
  for (const f of kuzuFiles) {
    try {
      await fs.rm(f, { recursive: true, force: true });
    } catch {}
  }

  const t0Kuzu = Date.now();
  await initKuzu(kuzuPath);
  let kuzuMsgCount = 0;
  const kuzuResult = await loadGraphToKuzu(
    pipelineResult.graph,
    pipelineResult.repoPath,
    storagePath,
    (msg) => {
      kuzuMsgCount++;
      const progress = Math.min(84, 60 + Math.round((kuzuMsgCount / (kuzuMsgCount + 10)) * 24));
      updateBar(progress, msg);
    },
  );
  const kuzuTime = ((Date.now() - t0Kuzu) / 1000).toFixed(1);
  const kuzuWarnings = kuzuResult.warnings;

  updateBar(85, 'Creating search indexes...');
  const t0Fts = Date.now();
  try {
    await createFTSIndex('File', 'file_fts', ['name', 'content']);
    await createFTSIndex('Function', 'function_fts', ['name', 'content']);
    await createFTSIndex('Class', 'class_fts', ['name', 'content']);
    await createFTSIndex('Method', 'method_fts', ['name', 'content']);
    await createFTSIndex('Interface', 'interface_fts', ['name', 'content']);
  } catch {}
  const ftsTime = ((Date.now() - t0Fts) / 1000).toFixed(1);

  updateBar(98, 'Saving metadata...');
  const stats = await getKuzuStats();

  const meta = {
    version: 1 as const,
    indexed_head: currentCommit,
    indexed_branch: currentBranch,
    indexed_at: new Date().toISOString(),
    indexed_dirty: currentDirty,
    worktree_root: repoPath,
    stats: {
      files: pipelineResult.totalFileCount,
      nodes: stats.nodes,
      edges: stats.edges,
      communities: pipelineResult.communityResult?.stats.totalCommunities,
      processes: pipelineResult.processResult?.stats.totalProcesses,
    },
  };
  await saveMeta(storagePath, meta);

  await closeKuzu();

  const totalTime = ((Date.now() - t0Global) / 1000).toFixed(1);

  clearInterval(elapsedTimer);
  process.removeListener('SIGINT', sigintHandler);

  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;

  bar.update(100, { phase: 'Done' });
  bar.stop();

  console.log(`\n  Repository indexed successfully (${totalTime}s)\n`);
  console.log(
    `  ${stats.nodes.toLocaleString()} nodes | ${stats.edges.toLocaleString()} edges | ${pipelineResult.communityResult?.stats.totalCommunities || 0} clusters | ${pipelineResult.processResult?.stats.totalProcesses || 0} flows`,
  );
  console.log(`  KuzuDB ${kuzuTime}s | FTS ${ftsTime}s`);
  console.log(`  ${repoPath}`);

  if (options?.indexOnly) {
    console.log('  Note: --index-only is satisfied by default; codenexus index no longer mutates repo files outside .codenexus.');
  }

  if (kuzuWarnings.length > 0) {
    const totalFallback = kuzuWarnings.reduce((sum, warning) => {
      const match = warning.match(/\((\d+) edges\)/);
      return sum + (match ? parseInt(match[1], 10) : 0);
    }, 0);
    console.log(`  Note: ${totalFallback} edges across ${kuzuWarnings.length} types inserted via fallback`);
  }

  console.log('');
  process.exit(0);
};
