import fs from 'fs/promises';
import path from 'path';
import type { KnowledgeGraph } from '../graph/types.js';
import { SupportedLanguages } from '../../config/supported-languages.js';
import { loadRojoProjectIndex } from './roblox/rojo-project.js';
import type { RojoProjectIndex, RobloxPathSpec } from './roblox/types.js';

export interface ImportResolutionContext {
  allFilePaths: Set<string>;
  allFileList: string[];
  normalizedFileList: string[];
  suffixIndex: SuffixIndex;
  resolveCache: Map<string, string | null>;
}

interface TsconfigPaths {
  aliases: Map<string, string>;
  baseUrl: string;
}

interface GoModuleConfig {
  modulePath: string;
}

interface ComposerConfig {
  psr4: Map<string, string>;
}

interface SwiftPackageConfig {
  targets: Map<string, string>;
}

export interface ImportLanguageConfigs {
  tsconfigPaths: TsconfigPaths | null;
  goModule: GoModuleConfig | null;
  composerConfig: ComposerConfig | null;
  swiftPackageConfig: SwiftPackageConfig | null;
  rojoProject: RojoProjectIndex | null;
}

export interface SuffixIndex {
  get(suffix: string): string | undefined;
  getInsensitive(suffix: string): string | undefined;
  getFilesInDir(dirSuffix: string, extension: string): string[];
}

const isDev = process.env.NODE_ENV === 'development';
const RESOLVE_CACHE_CAP = 100_000;
const KOTLIN_EXTENSIONS: readonly string[] = ['.kt', '.kts'];
const EXTENSIONS = [
  '',
  '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js',
  '.py', '/__init__.py',
  '.lua', '.luau', '/init.lua', '/init.luau',
  '.java',
  '.kt', '.kts',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx', '.hh',
  '.cs',
  '.go',
  '.rs', '/mod.rs',
  '.php', '.phtml',
  '.swift',
];

export const createImportResolutionContext = (allPaths: string[]): ImportResolutionContext => {
  const allFileList = allPaths;
  const normalizedFileList = allFileList.map((p) => p.replace(/\\/g, '/'));
  const allFilePaths = new Set(allFileList);
  const suffixIndex = buildSuffixIndex(normalizedFileList, allFileList);
  return { allFilePaths, allFileList, normalizedFileList, suffixIndex, resolveCache: new Map() };
};

export const loadImportLanguageConfigs = async (
  repoRoot: string,
  allFileList: string[],
): Promise<ImportLanguageConfigs> => ({
  tsconfigPaths: await loadTsconfigPaths(repoRoot),
  goModule: await loadGoModulePath(repoRoot),
  composerConfig: await loadComposerConfig(repoRoot),
  swiftPackageConfig: await loadSwiftPackageConfig(repoRoot),
  rojoProject: repoRoot ? await loadRojoProjectIndex(repoRoot, allFileList) : null,
});

export const applyRojoRuntimeAreas = (graph: KnowledgeGraph, rojoProject: RojoProjectIndex) => {
  graph.forEachNode((node) => {
    const filePath = node.properties.filePath;
    if (!filePath) return;
    const runtimeArea = rojoProject.getRuntimeAreaForPath(filePath);
    if (runtimeArea) node.properties.runtimeArea = runtimeArea;
  });
};

export const resolveRobloxImportSpec = (
  filePath: string,
  robloxPath: RobloxPathSpec,
  rojoProject: RojoProjectIndex,
): string[] => {
  if (robloxPath.rootKind === 'service') {
    if (!robloxPath.serviceName) return [];
    return rojoProject.resolveDataModelSegments([robloxPath.serviceName, ...robloxPath.segments]);
  }

  const currentTargets = rojoProject.getTargetsForFile(filePath);
  const resolved = new Set<string>();
  for (const target of currentTargets) {
    const parentDepth = robloxPath.parentDepth ?? 0;
    if (parentDepth > target.dataModelSegments.length) continue;
    const baseSegments = target.dataModelSegments.slice(0, Math.max(0, target.dataModelSegments.length - parentDepth));
    const candidates = rojoProject.resolveDataModelSegments([...baseSegments, ...robloxPath.segments]);
    for (const candidate of candidates) resolved.add(candidate);
  }
  return [...resolved];
};

export const appendKotlinWildcard = (importPath: string, importNode: any): string => {
  for (let i = 0; i < importNode.childCount; i++) {
    if (importNode.child(i)?.type === 'wildcard_import') {
      return importPath.endsWith('.*') ? importPath : `${importPath}.*`;
    }
  }
  return importPath;
};

export const resolveJvmWildcard = (
  importPath: string,
  normalizedFileList: string[],
  allFileList: string[],
  extensions: readonly string[],
  index?: SuffixIndex,
): string[] => {
  const packagePath = importPath.slice(0, -2).replace(/\./g, '/');

  if (index) {
    const candidates = extensions.flatMap((ext) => index.getFilesInDir(packagePath, ext));
    const packageSuffix = '/' + packagePath + '/';
    return candidates.filter((filePath) => {
      const normalized = filePath.replace(/\\/g, '/');
      const idx = normalized.indexOf(packageSuffix);
      if (idx < 0) return false;
      const afterPkg = normalized.substring(idx + packageSuffix.length);
      return !afterPkg.includes('/');
    });
  }

  const packageSuffix = '/' + packagePath + '/';
  const matches: string[] = [];
  for (let i = 0; i < normalizedFileList.length; i++) {
    const normalized = normalizedFileList[i];
    if (normalized.includes(packageSuffix) && extensions.some((ext) => normalized.endsWith(ext))) {
      const afterPackage = normalized.substring(normalized.indexOf(packageSuffix) + packageSuffix.length);
      if (!afterPackage.includes('/')) matches.push(allFileList[i]);
    }
  }
  return matches;
};

export const resolveJvmMemberImport = (
  importPath: string,
  normalizedFileList: string[],
  allFileList: string[],
  extensions: readonly string[],
  index?: SuffixIndex,
): string | null => {
  const segments = importPath.split('.');
  if (segments.length < 3) return null;

  const lastSeg = segments[segments.length - 1];
  if (!(lastSeg === '*' || /^[a-z]/.test(lastSeg) || /^[A-Z_]+$/.test(lastSeg))) return null;

  const classPath = segments.slice(0, -1).join('/');
  for (const ext of extensions) {
    const classSuffix = classPath + ext;
    if (index) {
      const result = index.get(classSuffix) || index.getInsensitive(classSuffix);
      if (result) return result;
    } else {
      const fullSuffix = '/' + classSuffix;
      for (let i = 0; i < normalizedFileList.length; i++) {
        if (normalizedFileList[i].endsWith(fullSuffix) ||
            normalizedFileList[i].toLowerCase().endsWith(fullSuffix.toLowerCase())) {
          return allFileList[i];
        }
      }
    }
  }

  return null;
};

export const resolveGoPackage = (
  importPath: string,
  goModule: GoModuleConfig,
  normalizedFileList: string[],
  allFileList: string[],
): string[] => {
  if (!importPath.startsWith(goModule.modulePath)) return [];
  const relativePkg = importPath.slice(goModule.modulePath.length + 1);
  if (!relativePkg) return [];

  const pkgSuffix = '/' + relativePkg + '/';
  const matches: string[] = [];
  for (let i = 0; i < normalizedFileList.length; i++) {
    const normalized = normalizedFileList[i];
    if (normalized.includes(pkgSuffix) && normalized.endsWith('.go') && !normalized.endsWith('_test.go')) {
      const afterPkg = normalized.substring(normalized.indexOf(pkgSuffix) + pkgSuffix.length);
      if (!afterPkg.includes('/')) matches.push(allFileList[i]);
    }
  }

  return matches;
};

export const resolvePhpImport = (
  importPath: string,
  composerConfig: ComposerConfig | null,
  allFiles: Set<string>,
  normalizedFileList: string[],
  allFileList: string[],
  index?: SuffixIndex,
): string | null => {
  const normalized = importPath.replace(/\\/g, '/');

  if (composerConfig) {
    const sorted = [...composerConfig.psr4.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [nsPrefix, dirPrefix] of sorted) {
      const nsPrefixSlash = nsPrefix.replace(/\\/g, '/');
      if (normalized.startsWith(nsPrefixSlash + '/') || normalized === nsPrefixSlash) {
        const remainder = normalized.slice(nsPrefixSlash.length).replace(/^\//, '');
        const filePath = dirPrefix + (remainder ? '/' + remainder : '') + '.php';
        if (allFiles.has(filePath)) return filePath;
        if (index) {
          const result = index.getInsensitive(filePath);
          if (result) return result;
        }
      }
    }
  }

  const pathParts = normalized.split('/').filter(Boolean);
  return suffixResolve(pathParts, normalizedFileList, allFileList, index);
};

export const resolveImportPath = (
  currentFile: string,
  importPath: string,
  context: ImportResolutionContext,
  language: SupportedLanguages,
  configs: Pick<ImportLanguageConfigs, 'tsconfigPaths'>,
): string | null => {
  const { allFilePaths, allFileList, normalizedFileList, suffixIndex: index, resolveCache } = context;
  const cacheKey = `${currentFile}::${importPath}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey) ?? null;

  const cache = (result: string | null): string | null => {
    if (resolveCache.size >= RESOLVE_CACHE_CAP) {
      const evictCount = Math.floor(RESOLVE_CACHE_CAP * 0.2);
      const iter = resolveCache.keys();
      for (let i = 0; i < evictCount; i++) {
        const key = iter.next().value;
        if (key !== undefined) resolveCache.delete(key);
      }
    }
    resolveCache.set(cacheKey, result);
    return result;
  };

  if ((language === SupportedLanguages.TypeScript || language === SupportedLanguages.JavaScript) &&
      configs.tsconfigPaths &&
      !importPath.startsWith('.')) {
    for (const [aliasPrefix, targetPrefix] of configs.tsconfigPaths.aliases) {
      if (importPath.startsWith(aliasPrefix)) {
        const remainder = importPath.slice(aliasPrefix.length);
        const rewritten = configs.tsconfigPaths.baseUrl === '.'
          ? targetPrefix + remainder
          : `${configs.tsconfigPaths.baseUrl}/${targetPrefix}${remainder}`;

        const resolved = tryResolveWithExtensions(rewritten, allFilePaths);
        if (resolved) return cache(resolved);

        const parts = rewritten.split('/').filter(Boolean);
        const suffixResult = suffixResolve(parts, normalizedFileList, allFileList, index);
        if (suffixResult) return cache(suffixResult);
      }
    }
  }

  if (language === SupportedLanguages.Rust) {
    const rustResult = resolveRustImport(currentFile, importPath, allFilePaths);
    if (rustResult) return cache(rustResult);
  }

  const currentDir = currentFile.split('/').slice(0, -1);
  const parts = importPath.split('/');
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') currentDir.pop();
    else currentDir.push(part);
  }

  const basePath = currentDir.join('/');
  if (importPath.startsWith('.')) {
    return cache(tryResolveWithExtensions(basePath, allFilePaths));
  }

  if (importPath.endsWith('.*')) return cache(null);
  const pathLike = importPath.includes('/') ? importPath : importPath.replace(/\./g, '/');
  return cache(suffixResolve(pathLike.split('/').filter(Boolean), normalizedFileList, allFileList, index));
};

export const getKotlinExtensions = (): readonly string[] => KOTLIN_EXTENSIONS;

function tryResolveWithExtensions(basePath: string, allFiles: Set<string>): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
}

async function loadTsconfigPaths(repoRoot: string): Promise<TsconfigPaths | null> {
  const candidates = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json'];
  for (const filename of candidates) {
    try {
      const tsconfigPath = path.join(repoRoot, filename);
      const raw = await fs.readFile(tsconfigPath, 'utf-8');
      const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const tsconfig = JSON.parse(stripped);
      const compilerOptions = tsconfig.compilerOptions;
      if (!compilerOptions?.paths) continue;

      const baseUrl = compilerOptions.baseUrl || '.';
      const aliases = new Map<string, string>();
      for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        const target = targets[0] as string;
        const aliasPrefix = pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern;
        const targetPrefix = target.endsWith('/*') ? target.slice(0, -1) : target;
        aliases.set(aliasPrefix, targetPrefix);
      }

      if (aliases.size > 0) {
        if (isDev) console.log(`📦 Loaded ${aliases.size} path aliases from ${filename}`);
        return { aliases, baseUrl };
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function loadGoModulePath(repoRoot: string): Promise<GoModuleConfig | null> {
  try {
    const content = await fs.readFile(path.join(repoRoot, 'go.mod'), 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    if (match) {
      if (isDev) console.log(`📦 Loaded Go module path: ${match[1]}`);
      return { modulePath: match[1] };
    }
  } catch {
    // No go.mod.
  }
  return null;
}

async function loadComposerConfig(repoRoot: string): Promise<ComposerConfig | null> {
  try {
    const raw = await fs.readFile(path.join(repoRoot, 'composer.json'), 'utf-8');
    const composer = JSON.parse(raw);
    const psr4Raw = composer.autoload?.['psr-4'] ?? {};
    const psr4Dev = composer['autoload-dev']?.['psr-4'] ?? {};
    const merged = { ...psr4Raw, ...psr4Dev };

    const psr4 = new Map<string, string>();
    for (const [ns, dir] of Object.entries(merged)) {
      psr4.set((ns as string).replace(/\\+$/, ''), (dir as string).replace(/\\/g, '/').replace(/\/+$/, ''));
    }
    if (isDev) console.log(`📦 Loaded ${psr4.size} PSR-4 mappings from composer.json`);
    return { psr4 };
  } catch {
    return null;
  }
}

async function loadSwiftPackageConfig(repoRoot: string): Promise<SwiftPackageConfig | null> {
  const targets = new Map<string, string>();
  const sourceDirs = ['Sources', 'Package/Sources', 'src'];

  for (const sourceDir of sourceDirs) {
    try {
      const entries = await fs.readdir(path.join(repoRoot, sourceDir), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) targets.set(entry.name, `${sourceDir}/${entry.name}`);
      }
    } catch {
      // Directory missing; continue.
    }
  }

  if (targets.size > 0) {
    if (isDev) console.log(`📦 Loaded ${targets.size} Swift package targets`);
    return { targets };
  }
  return null;
}

function buildSuffixIndex(normalizedFileList: string[], allFileList: string[]): SuffixIndex {
  const exactMap = new Map<string, string>();
  const lowerMap = new Map<string, string>();
  const dirMap = new Map<string, string[]>();

  for (let i = 0; i < normalizedFileList.length; i++) {
    const normalized = normalizedFileList[i];
    const original = allFileList[i];
    const parts = normalized.split('/');

    for (let j = parts.length - 1; j >= 0; j--) {
      const suffix = parts.slice(j).join('/');
      if (!exactMap.has(suffix)) exactMap.set(suffix, original);
      const lower = suffix.toLowerCase();
      if (!lowerMap.has(lower)) lowerMap.set(lower, original);
    }

    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash >= 0) {
      const dirParts = parts.slice(0, -1);
      const fileName = parts[parts.length - 1];
      const ext = fileName.substring(fileName.lastIndexOf('.'));
      for (let j = dirParts.length - 1; j >= 0; j--) {
        const dirSuffix = dirParts.slice(j).join('/');
        const key = `${dirSuffix}:${ext}`;
        let list = dirMap.get(key);
        if (!list) {
          list = [];
          dirMap.set(key, list);
        }
        list.push(original);
      }
    }
  }

  return {
    get: (suffix: string) => exactMap.get(suffix),
    getInsensitive: (suffix: string) => lowerMap.get(suffix.toLowerCase()),
    getFilesInDir: (dirSuffix: string, extension: string) => dirMap.get(`${dirSuffix}:${extension}`) || [],
  };
}

function suffixResolve(
  pathParts: string[],
  normalizedFileList: string[],
  allFileList: string[],
  index?: SuffixIndex,
): string | null {
  if (index) {
    for (let i = 0; i < pathParts.length; i++) {
      const suffix = pathParts.slice(i).join('/');
      for (const ext of EXTENSIONS) {
        const suffixWithExt = suffix + ext;
        const result = index.get(suffixWithExt) || index.getInsensitive(suffixWithExt);
        if (result) return result;
      }
    }
    return null;
  }

  for (let i = 0; i < pathParts.length; i++) {
    const suffix = pathParts.slice(i).join('/');
    for (const ext of EXTENSIONS) {
      const suffixWithExt = suffix + ext;
      const suffixPattern = '/' + suffixWithExt;
      const matchIdx = normalizedFileList.findIndex((filePath) =>
        filePath.endsWith(suffixPattern) || filePath.toLowerCase().endsWith(suffixPattern.toLowerCase())
      );
      if (matchIdx !== -1) return allFileList[matchIdx];
    }
  }
  return null;
}

function resolveRustImport(
  currentFile: string,
  importPath: string,
  allFiles: Set<string>,
): string | null {
  let rustPath: string;

  if (importPath.startsWith('crate::')) {
    rustPath = importPath.slice(7).replace(/::/g, '/');
    return tryRustModulePath(`src/${rustPath}`, allFiles) ||
      tryRustModulePath(rustPath, allFiles);
  }

  if (importPath.startsWith('super::')) {
    const currentDir = currentFile.split('/').slice(0, -1);
    currentDir.pop();
    rustPath = importPath.slice(7).replace(/::/g, '/');
    return tryRustModulePath([...currentDir, rustPath].join('/'), allFiles);
  }

  if (importPath.startsWith('self::')) {
    const currentDir = currentFile.split('/').slice(0, -1);
    rustPath = importPath.slice(6).replace(/::/g, '/');
    return tryRustModulePath([...currentDir, rustPath].join('/'), allFiles);
  }

  if (importPath.includes('::')) {
    rustPath = importPath.replace(/::/g, '/');
    return tryRustModulePath(rustPath, allFiles);
  }

  return null;
}

function tryRustModulePath(modulePath: string, allFiles: Set<string>): string | null {
  if (allFiles.has(`${modulePath}.rs`)) return `${modulePath}.rs`;
  if (allFiles.has(`${modulePath}/mod.rs`)) return `${modulePath}/mod.rs`;
  if (allFiles.has(`${modulePath}/lib.rs`)) return `${modulePath}/lib.rs`;

  const lastSlash = modulePath.lastIndexOf('/');
  if (lastSlash > 0) {
    const parentPath = modulePath.substring(0, lastSlash);
    if (allFiles.has(`${parentPath}.rs`)) return `${parentPath}.rs`;
    if (allFiles.has(`${parentPath}/mod.rs`)) return `${parentPath}/mod.rs`;
  }

  return null;
}
