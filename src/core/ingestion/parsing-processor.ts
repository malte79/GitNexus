import { KnowledgeGraph, GraphNode, GraphRelationship } from '../graph/types.js';
import Parser from 'tree-sitter';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader.js';
import { LANGUAGE_QUERIES } from './tree-sitter-queries.js';
import { generateId } from '../../lib/utils.js';
import { SymbolTable } from './symbol-table.js';
import { ASTCache } from './ast-cache.js';
import { getLanguageFromFilename, yieldToEventLoop } from './utils.js';
import { appendLuauModuleSymbols, createDefinitionArtifacts } from './parsing-symbol-support.js';
import { WorkerPool } from './workers/worker-pool.js';
import type { ParseWorkerResult, ParseWorkerInput, ExtractedImport, ExtractedCall, ExtractedHeritage, ExtractedRoute } from './workers/parse-worker.js';

export { isNodeExported } from './parsing-symbol-support.js';

export type FileProgressCallback = (current: number, total: number, filePath: string) => void;

export interface WorkerExtractedData {
  imports: ExtractedImport[];
  calls: ExtractedCall[];
  heritage: ExtractedHeritage[];
  routes: ExtractedRoute[];
}

const resolveLuauModuleMethodId = (
  filePath: string,
  methodRef: { name: string; startLine: number; label: string; targetName?: string; targetLabel?: string },
  symbolTable: SymbolTable,
): string | null => {
  if (methodRef.targetLabel) {
    const directId = generateId(methodRef.targetLabel, `${filePath}:${methodRef.targetName || methodRef.name}:${methodRef.startLine}`);
    if (symbolTable.lookupExact(filePath, methodRef.targetName || methodRef.name) === directId) {
      return directId;
    }
  }

  const targetName = methodRef.targetName || methodRef.name;
  const exact = symbolTable.lookupExact(filePath, targetName);
  if (!exact) return null;

  if (!methodRef.targetLabel) {
    return (
      exact.startsWith('Method:') ||
      exact.startsWith('Function:') ||
      exact.startsWith('Property:') ||
      exact.startsWith('Const:') ||
      exact.startsWith('Static:') ||
      exact.startsWith('CodeElement:')
    )
      ? exact
      : null;
  }

  return exact.startsWith(`${methodRef.targetLabel}:`) ? exact : null;
};

// ============================================================================
// Worker-based parallel parsing
// ============================================================================

const processParsingWithWorkers = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  symbolTable: SymbolTable,
  astCache: ASTCache,
  workerPool: WorkerPool,
  onFileProgress?: FileProgressCallback,
): Promise<WorkerExtractedData> => {
  // Filter to parseable files only
  const parseableFiles: ParseWorkerInput[] = [];
  for (const file of files) {
    const lang = getLanguageFromFilename(file.path);
    if (lang) parseableFiles.push({ path: file.path, content: file.content });
  }

  if (parseableFiles.length === 0) return { imports: [], calls: [], heritage: [], routes: [] };

  const total = files.length;

  // Dispatch to worker pool — pool handles splitting into chunks and sub-batching
  const chunkResults = await workerPool.dispatch<ParseWorkerInput, ParseWorkerResult>(
    parseableFiles,
    (filesProcessed) => {
      onFileProgress?.(Math.min(filesProcessed, total), total, 'Parsing...');
    },
  );

  // Merge results from all workers into graph and symbol table
  const allImports: ExtractedImport[] = [];
  const allCalls: ExtractedCall[] = [];
  const allHeritage: ExtractedHeritage[] = [];
  const allRoutes: ExtractedRoute[] = [];
  for (const result of chunkResults) {
    for (const node of result.nodes) {
      graph.addNode({
        id: node.id,
        label: node.label as any,
        properties: node.properties,
      });
    }

    for (const rel of result.relationships) {
      graph.addRelationship(rel);
    }

    for (const sym of result.symbols) {
      symbolTable.add(sym.filePath, sym.name, sym.nodeId, sym.type);
    }

    allImports.push(...result.imports);
    allCalls.push(...result.calls);
    allHeritage.push(...result.heritage);
    allRoutes.push(...result.routes);
  }

  // Final progress
  onFileProgress?.(total, total, 'done');
  return { imports: allImports, calls: allCalls, heritage: allHeritage, routes: allRoutes };
};

// ============================================================================
// Sequential fallback (original implementation)
// ============================================================================

const processParsingSequential = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  symbolTable: SymbolTable,
  astCache: ASTCache,
  onFileProgress?: FileProgressCallback
) => {
  const parser = await loadParser();
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    onFileProgress?.(i + 1, total, file.path);

    if (i % 20 === 0) await yieldToEventLoop();

    const language = getLanguageFromFilename(file.path);

    if (!language) continue;

    // Skip very large files — they can crash tree-sitter or cause OOM
    if (file.content.length > 512 * 1024) continue;

    try {
      await loadLanguage(language, file.path);
    } catch {
      continue;  // parser unavailable — already warned in pipeline
    }

    let tree;
    try {
      tree = parser.parse(file.content, undefined, { bufferSize: 1024 * 256 });
    } catch (parseError) {
      console.warn(`Skipping unparseable file: ${file.path}`);
      continue;
    }

    astCache.set(file.path, tree);

    const queryString = LANGUAGE_QUERIES[language];
    if (!queryString) {
      continue;
    }

    let query;
    let matches;
    try {
      const language = parser.getLanguage();
      query = new Parser.Query(language, queryString);
      matches = query.matches(tree.rootNode);
    } catch (queryError) {
      console.warn(`Query error for ${file.path}:`, queryError);
      continue;
    }

    matches.forEach(match => {
      const captureMap: Record<string, any> = {};

      match.captures.forEach(c => {
        captureMap[c.name] = c.node;
      });

      if (captureMap['import']) {
        return;
      }

      if (captureMap['call']) {
        return;
      }

      const artifacts = createDefinitionArtifacts(captureMap, file.path, language);
      if (!artifacts) return;

      graph.addNode(artifacts.node as GraphNode);
      symbolTable.add(artifacts.symbol.filePath, artifacts.symbol.name, artifacts.symbol.nodeId, artifacts.symbol.type);
      graph.addRelationship(artifacts.relationship as GraphRelationship);
    });

    if (language === 'luau') {
      appendLuauModuleSymbols(tree.rootNode, file.path, {
        hasNode: (id) => Boolean(graph.getNode(id)),
        addNode: (node) => graph.addNode(node as GraphNode),
        addSymbol: (symbol) => symbolTable.add(symbol.filePath, symbol.name, symbol.nodeId, symbol.type),
        addRelationship: (relationship) => graph.addRelationship(relationship as GraphRelationship),
        resolveMemberId: (targetFilePath, memberRef) => resolveLuauModuleMethodId(targetFilePath, memberRef, symbolTable),
      });
    }
  }
};

// ============================================================================
// Public API
// ============================================================================

export const processParsing = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  symbolTable: SymbolTable,
  astCache: ASTCache,
  onFileProgress?: FileProgressCallback,
  workerPool?: WorkerPool,
): Promise<WorkerExtractedData | null> => {
  if (workerPool) {
    try {
      return await processParsingWithWorkers(graph, files, symbolTable, astCache, workerPool, onFileProgress);
    } catch (err) {
      console.warn('Worker pool parsing failed, falling back to sequential:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback: sequential parsing (no pre-extracted data)
  await processParsingSequential(graph, files, symbolTable, astCache, onFileProgress);
  return null;
};
