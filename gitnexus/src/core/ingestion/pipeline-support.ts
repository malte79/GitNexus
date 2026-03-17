import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PipelineProgress } from '../../types/pipeline.js';
import { processParsing } from './parsing-processor.js';
import { processImports, processImportsFromExtracted, buildImportResolutionContext, type ImportMap } from './import-processor.js';
import { processCalls, processCallsFromExtracted, processRoutesFromExtracted } from './call-processor.js';
import { processHeritage, processHeritageFromExtracted } from './heritage-processor.js';
import { getLanguageFromFilename } from './utils.js';
import { isLanguageAvailable } from '../tree-sitter/parser-loader.js';
import { readFileContents, walkRepositoryPaths } from './filesystem-walker.js';
import type { KnowledgeGraph } from '../graph/types.js';
import type { SymbolTable } from './symbol-table.js';
import type { ASTCache } from './ast-cache.js';
import { createASTCache } from './ast-cache.js';
import { createWorkerPool, type WorkerPool } from './workers/worker-pool.js';

const isDev = process.env.NODE_ENV === 'development';
const CHUNK_BYTE_BUDGET = 20 * 1024 * 1024;

type ScannedFile = Awaited<ReturnType<typeof walkRepositoryPaths>>[number];

export interface PipelineState {
  graph: KnowledgeGraph;
  symbolTable: SymbolTable;
  astCache: ASTCache;
  importMap: ImportMap;
}

export interface ScannedRepository {
  scannedFiles: ScannedFile[];
  totalFiles: number;
  allPaths: string[];
  parseableFiles: ScannedFile[];
  chunks: string[][];
}

export const cleanupPipelineState = (state: PipelineState) => {
  state.astCache.clear();
  state.symbolTable.clear();
};

export const scanRepositoryForPipeline = async (
  repoPath: string,
  graph: KnowledgeGraph,
  onProgress: (progress: PipelineProgress) => void,
): Promise<ScannedRepository> => {
  onProgress({
    phase: 'extracting',
    percent: 0,
    message: 'Scanning repository...',
  });

  const scannedFiles = await walkRepositoryPaths(repoPath, (current, total, filePath) => {
    const scanProgress = Math.round((current / total) * 15);
    onProgress({
      phase: 'extracting',
      percent: scanProgress,
      message: 'Scanning repository...',
      detail: filePath,
      stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
    });
  });

  const totalFiles = scannedFiles.length;
  onProgress({
    phase: 'extracting',
    percent: 15,
    message: 'Repository scanned successfully',
    stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
  });

  const parseableFiles = scannedFiles.filter((file) => {
    const lang = getLanguageFromFilename(file.path);
    return lang && isLanguageAvailable(lang);
  });

  const skippedByLang = new Map<string, number>();
  for (const file of scannedFiles) {
    const lang = getLanguageFromFilename(file.path);
    if (lang && !isLanguageAvailable(lang)) {
      skippedByLang.set(lang, (skippedByLang.get(lang) || 0) + 1);
    }
  }
  for (const [lang, count] of skippedByLang) {
    console.warn(`Skipping ${count} ${lang} file(s) — ${lang} parser not available (native binding may not have built). Try: npm rebuild tree-sitter-${lang}`);
  }

  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentBytes = 0;
  for (const file of parseableFiles) {
    if (currentChunk.length > 0 && currentBytes + file.size > CHUNK_BYTE_BUDGET) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 0;
    }
    currentChunk.push(file.path);
    currentBytes += file.size;
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  if (isDev) {
    const totalMB = parseableFiles.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024);
    console.log(`📂 Scan: ${totalFiles} paths, ${parseableFiles.length} parseable (${totalMB.toFixed(0)}MB), ${chunks.length} chunks @ ${CHUNK_BYTE_BUDGET / (1024 * 1024)}MB budget`);
  }

  return {
    scannedFiles,
    totalFiles,
    allPaths: scannedFiles.map((file) => file.path),
    parseableFiles,
    chunks,
  };
};

export const createPipelineWorkerPool = (): WorkerPool | undefined => {
  try {
    let workerUrl = new URL('./workers/parse-worker.js', import.meta.url);
    const thisDir = fileURLToPath(new URL('.', import.meta.url));
    if (!fs.existsSync(fileURLToPath(workerUrl))) {
      const distWorker = path.resolve(thisDir, '..', '..', '..', 'dist', 'core', 'ingestion', 'workers', 'parse-worker.js');
      if (fs.existsSync(distWorker)) workerUrl = pathToFileURL(distWorker) as URL;
    }
    return createWorkerPool(workerUrl);
  } catch (err) {
    if (isDev) {
      console.warn('Worker pool creation failed, using sequential fallback:', (err as Error).message);
    }
    return undefined;
  }
};

export const runChunkedParsing = async (
  repoPath: string,
  scan: ScannedRepository,
  state: PipelineState,
  onProgress: (progress: PipelineProgress) => void,
): Promise<void> => {
  const totalParseable = scan.parseableFiles.length;
  const numChunks = scan.chunks.length;

  if (totalParseable === 0) {
    onProgress({
      phase: 'parsing',
      percent: 82,
      message: 'No parseable files found — skipping parsing phase',
      stats: { filesProcessed: 0, totalFiles: 0, nodesCreated: state.graph.nodeCount },
    });
    return;
  }

  onProgress({
    phase: 'parsing',
    percent: 20,
    message: `Parsing ${totalParseable} files in ${numChunks} chunk${numChunks !== 1 ? 's' : ''}...`,
    stats: { filesProcessed: 0, totalFiles: totalParseable, nodesCreated: state.graph.nodeCount },
  });

  let filesParsedSoFar = 0;
  state.astCache = createASTCache(scan.chunks.reduce((max, chunk) => Math.max(max, chunk.length), 0));
  const importCtx = buildImportResolutionContext(scan.allPaths);
  const allPathObjects = scan.allPaths.map((pathValue) => ({ path: pathValue }));
  const sequentialChunkPaths: string[][] = [];
  const workerPool = createPipelineWorkerPool();

  try {
    for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
      const chunkPaths = scan.chunks[chunkIdx];
      const chunkContents = await readFileContents(repoPath, chunkPaths);
      const chunkFiles = chunkPaths
        .filter((chunkPath) => chunkContents.has(chunkPath))
        .map((chunkPath) => ({ path: chunkPath, content: chunkContents.get(chunkPath)! }));

      const chunkWorkerData = await processParsing(
        state.graph,
        chunkFiles,
        state.symbolTable,
        state.astCache,
        (current, _total, filePath) => {
          const globalCurrent = filesParsedSoFar + current;
          const parsingProgress = 20 + ((globalCurrent / totalParseable) * 62);
          onProgress({
            phase: 'parsing',
            percent: Math.round(parsingProgress),
            message: `Parsing chunk ${chunkIdx + 1}/${numChunks}...`,
            detail: filePath,
            stats: { filesProcessed: globalCurrent, totalFiles: totalParseable, nodesCreated: state.graph.nodeCount },
          });
        },
        workerPool,
      );

      if (chunkWorkerData) {
        await processImportsFromExtracted(state.graph, allPathObjects, chunkWorkerData.imports, state.importMap, undefined, repoPath, importCtx);
        if (chunkWorkerData.calls.length > 0) {
          await processCallsFromExtracted(state.graph, chunkWorkerData.calls, state.symbolTable, state.importMap);
        }
        if (chunkWorkerData.heritage.length > 0) {
          await processHeritageFromExtracted(state.graph, chunkWorkerData.heritage, state.symbolTable);
        }
        if (chunkWorkerData.routes.length > 0) {
          await processRoutesFromExtracted(state.graph, chunkWorkerData.routes, state.symbolTable, state.importMap);
        }
      } else {
        await processImports(state.graph, chunkFiles, state.astCache, state.importMap, undefined, repoPath, scan.allPaths);
        sequentialChunkPaths.push(chunkPaths);
      }

      filesParsedSoFar += chunkFiles.length;
      state.astCache.clear();
    }
  } finally {
    await workerPool?.terminate();
  }

  for (const chunkPaths of sequentialChunkPaths) {
    const chunkContents = await readFileContents(repoPath, chunkPaths);
    const chunkFiles = chunkPaths
      .filter((chunkPath) => chunkContents.has(chunkPath))
      .map((chunkPath) => ({ path: chunkPath, content: chunkContents.get(chunkPath)! }));
    state.astCache = createASTCache(chunkFiles.length);
    await processCalls(state.graph, chunkFiles, state.astCache, state.symbolTable, state.importMap);
    await processHeritage(state.graph, chunkFiles, state.astCache, state.symbolTable);
    state.astCache.clear();
  }

  allPathObjects.length = 0;
  importCtx.resolveCache.clear();
  (importCtx as any).suffixIndex = null;
  (importCtx as any).normalizedFileList = null;

  if (isDev) {
    let importsCount = 0;
    for (const relationship of state.graph.iterRelationships()) {
      if (relationship.type === 'IMPORTS') importsCount++;
    }
    console.log(`📊 Pipeline: graph has ${importsCount} IMPORTS, ${state.graph.relationshipCount} total relationships`);
  }
};
