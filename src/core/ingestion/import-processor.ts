import type { KnowledgeGraph } from '../graph/types.js';
import type { ASTCache } from './ast-cache.js';
import Parser from 'tree-sitter';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader.js';
import { LANGUAGE_QUERIES } from './tree-sitter-queries.js';
import { generateId } from '../../lib/utils.js';
import { getLanguageFromFilename, yieldToEventLoop } from './utils.js';
import {
  appendKotlinWildcard,
  applyRojoRuntimeAreas,
  createImportResolutionContext,
  getKotlinExtensions,
  loadImportLanguageConfigs,
  resolveGoPackage,
  resolveImportPath,
  resolveJvmMemberImport,
  resolveJvmWildcard,
  resolvePhpImport,
  resolveRobloxImportSpec,
  type ImportResolutionContext,
} from './import-resolution-support.js';
import { SupportedLanguages } from '../../config/supported-languages.js';
import { extractLuauRobloxAliasesAndImports } from './roblox/luau-resolution.js';
import type { ExtractedImport } from './workers/parse-worker-types.js';

const isDev = process.env.NODE_ENV === 'development';

export type ImportMap = Map<string, Set<string>>;
export type { ImportResolutionContext } from './import-resolution-support.js';

export const createImportMap = (): ImportMap => new Map();
export const buildImportResolutionContext = createImportResolutionContext;

const addImportEdge = (
  graph: KnowledgeGraph,
  importMap: ImportMap,
  filePath: string,
  resolvedPath: string,
) => {
  const sourceId = generateId('File', filePath);
  const targetId = generateId('File', resolvedPath);
  const relId = generateId('IMPORTS', `${filePath}->${resolvedPath}`);

  graph.addRelationship({
    id: relId,
    sourceId,
    targetId,
    type: 'IMPORTS',
    confidence: 1.0,
    reason: '',
  });

  if (!importMap.has(filePath)) importMap.set(filePath, new Set());
  importMap.get(filePath)!.add(resolvedPath);
};

const resolveStandardImport = (
  filePath: string,
  rawImportPath: string,
  language: SupportedLanguages,
  ctx: ImportResolutionContext,
  configs: Awaited<ReturnType<typeof loadImportLanguageConfigs>>,
): string | null => {
  return resolveImportPath(filePath, rawImportPath, ctx, language, {
    tsconfigPaths: configs.tsconfigPaths,
  });
};

const processSingleImport = (
  addEdge: (filePath: string, resolvedPath: string) => void,
  filePath: string,
  rawImportPath: string,
  language: SupportedLanguages,
  ctx: ImportResolutionContext,
  configs: Awaited<ReturnType<typeof loadImportLanguageConfigs>>,
) => {
  if (language === SupportedLanguages.Java || language === SupportedLanguages.Kotlin) {
    const exts = language === SupportedLanguages.Java ? ['.java'] : getKotlinExtensions();

    if (rawImportPath.endsWith('.*')) {
      const matchedFiles = resolveJvmWildcard(rawImportPath, ctx.normalizedFileList, ctx.allFileList, exts, ctx.suffixIndex);
      if (matchedFiles.length === 0 && language === SupportedLanguages.Kotlin) {
        const javaMatches = resolveJvmWildcard(rawImportPath, ctx.normalizedFileList, ctx.allFileList, ['.java'], ctx.suffixIndex);
        for (const matchedFile of javaMatches) addEdge(filePath, matchedFile);
        if (javaMatches.length > 0) return;
      }
      for (const matchedFile of matchedFiles) addEdge(filePath, matchedFile);
      return;
    }

    let memberResolved = resolveJvmMemberImport(rawImportPath, ctx.normalizedFileList, ctx.allFileList, exts, ctx.suffixIndex);
    if (!memberResolved && language === SupportedLanguages.Kotlin) {
      memberResolved = resolveJvmMemberImport(rawImportPath, ctx.normalizedFileList, ctx.allFileList, ['.java'], ctx.suffixIndex);
    }
    if (memberResolved) {
      addEdge(filePath, memberResolved);
      return;
    }
  }

  if (language === SupportedLanguages.Go && configs.goModule && rawImportPath.startsWith(configs.goModule.modulePath)) {
    const pkgFiles = resolveGoPackage(rawImportPath, configs.goModule, ctx.normalizedFileList, ctx.allFileList);
    if (pkgFiles.length > 0) {
      for (const pkgFile of pkgFiles) addEdge(filePath, pkgFile);
      return;
    }
  }

  if (language === SupportedLanguages.PHP) {
    const resolved = resolvePhpImport(rawImportPath, configs.composerConfig, ctx.allFilePaths, ctx.normalizedFileList, ctx.allFileList, ctx.suffixIndex);
    if (resolved) addEdge(filePath, resolved);
    return;
  }

  if (language === SupportedLanguages.Swift && configs.swiftPackageConfig) {
    const targetDir = configs.swiftPackageConfig.targets.get(rawImportPath);
    if (targetDir) {
      const dirPrefix = `${targetDir}/`;
      for (const candidate of ctx.allFileList) {
        if (candidate.startsWith(dirPrefix) && candidate.endsWith('.swift')) {
          addEdge(filePath, candidate);
        }
      }
    }
    return;
  }

  const resolvedPath = resolveStandardImport(filePath, rawImportPath, language, ctx, configs);
  if (resolvedPath) addEdge(filePath, resolvedPath);
};

export const processImports = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void,
  repoRoot?: string,
  allPaths?: string[],
) => {
  const allFileList = allPaths ?? files.map((file) => file.path);
  const ctx = createImportResolutionContext(allFileList);
  const parser = await loadParser();
  const configs = await loadImportLanguageConfigs(repoRoot || '', ctx.allFileList);
  if (configs.rojoProject) applyRojoRuntimeAreas(graph, configs.rojoProject);

  let totalImportsFound = 0;
  let totalImportsResolved = 0;
  const trackedAddImportEdge = (filePath: string, resolvedPath: string) => {
    totalImportsResolved++;
    addImportEdge(graph, importMap, filePath, resolvedPath);
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length);
    if (i % 20 === 0) await yieldToEventLoop();

    const language = getLanguageFromFilename(file.path);
    if (!language) continue;

    const queryStr = LANGUAGE_QUERIES[language];
    if (!queryStr) continue;

    await loadLanguage(language, file.path);

    let tree = astCache.get(file.path);
    if (!tree) {
      try {
        tree = parser.parse(file.content, undefined, { bufferSize: 1024 * 256 });
      } catch {
        continue;
      }
      astCache.set(file.path, tree);
    }

    let matches;
    try {
      matches = new Parser.Query(parser.getLanguage(), queryStr).matches(tree.rootNode);
    } catch {
      continue;
    }

    for (const match of matches) {
      const captureMap: Record<string, any> = {};
      match.captures.forEach((capture) => {
        captureMap[capture.name] = capture.node;
      });

      if (!(captureMap.import && captureMap['import.source'])) continue;
      if (language === SupportedLanguages.Luau) continue;

      const rawImportPath = language === SupportedLanguages.Kotlin
        ? appendKotlinWildcard(captureMap['import.source'].text.replace(/['"<>]/g, ''), captureMap.import)
        : captureMap['import.source'].text.replace(/['"<>]/g, '');
      totalImportsFound++;

      processSingleImport(trackedAddImportEdge, file.path, rawImportPath, language, ctx, configs);
    }

    if (language === SupportedLanguages.Luau) {
      const luauImports = extractLuauRobloxAliasesAndImports(tree.rootNode, file.path);
      for (const luauImport of luauImports) {
        totalImportsFound++;
        if (luauImport.robloxPath) {
          if (!configs.rojoProject) continue;
          const resolvedPaths = resolveRobloxImportSpec(file.path, luauImport.robloxPath, configs.rojoProject);
          for (const resolvedPath of resolvedPaths) trackedAddImportEdge(file.path, resolvedPath);
          continue;
        }

        if (!luauImport.rawImportPath) continue;
        const resolvedPath = resolveStandardImport(file.path, luauImport.rawImportPath, language, ctx, configs);
        if (resolvedPath) trackedAddImportEdge(file.path, resolvedPath);
      }
    }
  }

  if (isDev) {
    console.log(`📊 Import processing complete: ${totalImportsResolved}/${totalImportsFound} imports resolved to graph edges`);
  }
};

export const processImportsFromExtracted = async (
  graph: KnowledgeGraph,
  files: { path: string }[],
  extractedImports: ExtractedImport[],
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void,
  repoRoot?: string,
  prebuiltCtx?: ImportResolutionContext,
) => {
  const ctx = prebuiltCtx ?? createImportResolutionContext(files.map((file) => file.path));
  const configs = await loadImportLanguageConfigs(repoRoot || '', ctx.allFileList);
  if (configs.rojoProject) applyRojoRuntimeAreas(graph, configs.rojoProject);

  let totalImportsFound = 0;
  let totalImportsResolved = 0;
  const trackedAddImportEdge = (filePath: string, resolvedPath: string) => {
    totalImportsResolved++;
    addImportEdge(graph, importMap, filePath, resolvedPath);
  };

  const importsByFile = new Map<string, ExtractedImport[]>();
  for (const extracted of extractedImports) {
    let list = importsByFile.get(extracted.filePath);
    if (!list) {
      list = [];
      importsByFile.set(extracted.filePath, list);
    }
    list.push(extracted);
  }

  const totalFiles = importsByFile.size;
  let filesProcessed = 0;

  for (const [filePath, fileImports] of importsByFile) {
    filesProcessed++;
    if (filesProcessed % 100 === 0) {
      onProgress?.(filesProcessed, totalFiles);
      await yieldToEventLoop();
    }

    for (const { rawImportPath, language, robloxPath } of fileImports) {
      totalImportsFound++;

      if (language === SupportedLanguages.Luau && robloxPath) {
        if (!configs.rojoProject) continue;
        const resolvedPaths = resolveRobloxImportSpec(filePath, robloxPath, configs.rojoProject);
        for (const resolvedPath of resolvedPaths) trackedAddImportEdge(filePath, resolvedPath);
        continue;
      }

      if (!rawImportPath) continue;

      const cacheKey = `${filePath}::${rawImportPath}`;
      if (ctx.resolveCache.has(cacheKey)) {
        const cached = ctx.resolveCache.get(cacheKey);
        if (cached) trackedAddImportEdge(filePath, cached);
        continue;
      }

      const before = totalImportsResolved;
      processSingleImport(trackedAddImportEdge, filePath, rawImportPath, language as SupportedLanguages, ctx, configs);
    }
  }

  onProgress?.(totalFiles, totalFiles);

  if (isDev) {
    console.log(`📊 Import processing (fast path): ${totalImportsResolved}/${totalImportsFound} imports resolved to graph edges`);
  }
};
