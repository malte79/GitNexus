import { parentPort } from 'node:worker_threads';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Luau from 'tree-sitter-luau';
import Java from 'tree-sitter-java';
import C from 'tree-sitter-c';
import CPP from 'tree-sitter-cpp';
import CSharp from 'tree-sitter-c-sharp';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Kotlin from 'tree-sitter-kotlin';
import PHP from 'tree-sitter-php';
import { createRequire } from 'node:module';
import { SupportedLanguages } from '../../../config/supported-languages.js';
import { LANGUAGE_QUERIES } from '../tree-sitter-queries.js';
import { getLanguageFromFilename } from '../utils.js';
import { processFileGroup } from './parse-worker-support.js';
import type { ParseWorkerInput, ParseWorkerResult } from './parse-worker-types.js';

export type {
  ParsedNode,
  ParsedRelationship,
  ParsedSymbol,
  ExtractedImport,
  ExtractedCall,
  ExtractedHeritage,
  ExtractedRoute,
  ParseWorkerInput,
  ParseWorkerResult,
} from './parse-worker-types.js';

const parser = new Parser();

const _require = createRequire(import.meta.url);
let Swift: any = null;
try { Swift = _require('tree-sitter-swift'); } catch {}

const languageMap: Record<string, any> = {
  [SupportedLanguages.JavaScript]: JavaScript,
  [SupportedLanguages.TypeScript]: TypeScript.typescript,
  [`${SupportedLanguages.TypeScript}:tsx`]: TypeScript.tsx,
  [SupportedLanguages.Python]: Python,
  [SupportedLanguages.Luau]: Luau,
  [SupportedLanguages.Java]: Java,
  [SupportedLanguages.C]: C,
  [SupportedLanguages.CPlusPlus]: CPP,
  [SupportedLanguages.CSharp]: CSharp,
  [SupportedLanguages.Go]: Go,
  [SupportedLanguages.Rust]: Rust,
  [SupportedLanguages.Kotlin]: Kotlin,
  [SupportedLanguages.PHP]: PHP.php_only,
  ...(Swift ? { [SupportedLanguages.Swift]: Swift } : {}),
};

const setLanguage = (language: SupportedLanguages, filePath: string): void => {
  const key = language === SupportedLanguages.TypeScript && filePath.endsWith('.tsx')
    ? `${language}:tsx`
    : language;
  const lang = languageMap[key];
  if (!lang) throw new Error(`Unsupported language: ${language}`);
  parser.setLanguage(lang);
};

const createEmptyWorkerResult = (): ParseWorkerResult => ({
  nodes: [],
  relationships: [],
  symbols: [],
  imports: [],
  calls: [],
  heritage: [],
  routes: [],
  fileCount: 0,
});

const processBatch = (files: ParseWorkerInput[], onProgress?: (filesProcessed: number) => void): ParseWorkerResult => {
  const result = createEmptyWorkerResult();
  const byLanguage = new Map<SupportedLanguages, ParseWorkerInput[]>();

  for (const file of files) {
    const lang = getLanguageFromFilename(file.path);
    if (!lang) continue;
    let list = byLanguage.get(lang);
    if (!list) {
      list = [];
      byLanguage.set(lang, list);
    }
    list.push(file);
  }

  let totalProcessed = 0;
  let lastReported = 0;
  const PROGRESS_INTERVAL = 100;

  const onFileProcessed = onProgress ? () => {
    totalProcessed++;
    if (totalProcessed - lastReported >= PROGRESS_INTERVAL) {
      lastReported = totalProcessed;
      onProgress(totalProcessed);
    }
  } : undefined;

  for (const [language, langFiles] of byLanguage) {
    const queryString = LANGUAGE_QUERIES[language];
    if (!queryString) continue;

    const regularFiles: ParseWorkerInput[] = [];
    const tsxFiles: ParseWorkerInput[] = [];

    if (language === SupportedLanguages.TypeScript) {
      for (const file of langFiles) {
        if (file.path.endsWith('.tsx')) tsxFiles.push(file);
        else regularFiles.push(file);
      }
    } else {
      regularFiles.push(...langFiles);
    }

    const processGroup = (group: ParseWorkerInput[]) => {
      if (group.length === 0) return;
      try {
        setLanguage(language, group[0].path);
        processFileGroup(group, language, queryString, parser, result, onFileProcessed);
      } catch {
        // Parser unavailable for this language in the worker; skip the group.
      }
    };

    processGroup(regularFiles);
    processGroup(tsxFiles);
  }

  return result;
};

const mergeResult = (target: ParseWorkerResult, src: ParseWorkerResult) => {
  target.nodes.push(...src.nodes);
  target.relationships.push(...src.relationships);
  target.symbols.push(...src.symbols);
  target.imports.push(...src.imports);
  target.calls.push(...src.calls);
  target.heritage.push(...src.heritage);
  target.routes.push(...src.routes);
  target.fileCount += src.fileCount;
};

let accumulated = createEmptyWorkerResult();
let cumulativeProcessed = 0;

parentPort!.on('message', (msg: any) => {
  try {
    if (msg && msg.type === 'sub-batch') {
      const result = processBatch(msg.files, (filesProcessed) => {
        parentPort!.postMessage({ type: 'progress', filesProcessed: cumulativeProcessed + filesProcessed });
      });
      cumulativeProcessed += result.fileCount;
      mergeResult(accumulated, result);
      parentPort!.postMessage({ type: 'sub-batch-done' });
      return;
    }

    if (msg && msg.type === 'flush') {
      parentPort!.postMessage({ type: 'result', data: accumulated });
      accumulated = createEmptyWorkerResult();
      cumulativeProcessed = 0;
      return;
    }

    if (Array.isArray(msg)) {
      const result = processBatch(msg, (filesProcessed) => {
        parentPort!.postMessage({ type: 'progress', filesProcessed });
      });
      parentPort!.postMessage({ type: 'result', data: result });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({ type: 'error', error: message });
  }
});
