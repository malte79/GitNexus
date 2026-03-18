import { SupportedLanguages } from '../../config/supported-languages.js';
import { cacheResolvedImport } from './import-resolution-context-support.js';
import type {
  ComposerConfig,
  GoModuleConfig,
  ImportLanguageConfigs,
  ImportResolutionContext,
  RojoProjectIndex,
  RobloxPathSpec,
  SuffixIndex,
} from './import-resolution-types.js';

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
        if (
          normalizedFileList[i].endsWith(fullSuffix) ||
          normalizedFileList[i].toLowerCase().endsWith(fullSuffix.toLowerCase())
        ) {
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

  if (
    (language === SupportedLanguages.TypeScript || language === SupportedLanguages.JavaScript) &&
    configs.tsconfigPaths &&
    !importPath.startsWith('.')
  ) {
    for (const [aliasPrefix, targetPrefix] of configs.tsconfigPaths.aliases) {
      if (importPath.startsWith(aliasPrefix)) {
        const remainder = importPath.slice(aliasPrefix.length);
        const rewritten =
          configs.tsconfigPaths.baseUrl === '.'
            ? targetPrefix + remainder
            : `${configs.tsconfigPaths.baseUrl}/${targetPrefix}${remainder}`;

        const resolved = tryResolveWithExtensions(rewritten, allFilePaths);
        if (resolved) return cacheResolvedImport(context, cacheKey, resolved);

        const parts = rewritten.split('/').filter(Boolean);
        const suffixResult = suffixResolve(parts, normalizedFileList, allFileList, index);
        if (suffixResult) return cacheResolvedImport(context, cacheKey, suffixResult);
      }
    }
  }

  if (language === SupportedLanguages.Rust) {
    const rustResult = resolveRustImport(currentFile, importPath, allFilePaths);
    if (rustResult) return cacheResolvedImport(context, cacheKey, rustResult);
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
    return cacheResolvedImport(context, cacheKey, tryResolveWithExtensions(basePath, allFilePaths));
  }

  if (importPath.endsWith('.*')) return cacheResolvedImport(context, cacheKey, null);
  const pathLike = importPath.includes('/') ? importPath : importPath.replace(/\./g, '/');
  return cacheResolvedImport(
    context,
    cacheKey,
    suffixResolve(pathLike.split('/').filter(Boolean), normalizedFileList, allFileList, index),
  );
};

export const getKotlinExtensions = (): readonly string[] => KOTLIN_EXTENSIONS;

function tryResolveWithExtensions(basePath: string, allFiles: Set<string>): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
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
      const matchIdx = normalizedFileList.findIndex(
        (filePath) =>
          filePath.endsWith(suffixPattern) || filePath.toLowerCase().endsWith(suffixPattern.toLowerCase()),
      );
      if (matchIdx !== -1) return allFileList[matchIdx];
    }
  }
  return null;
}

function resolveRustImport(currentFile: string, importPath: string, allFiles: Set<string>): string | null {
  let rustPath: string;

  if (importPath.startsWith('crate::')) {
    rustPath = importPath.slice(7).replace(/::/g, '/');
    return tryRustModulePath(`src/${rustPath}`, allFiles) || tryRustModulePath(rustPath, allFiles);
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
