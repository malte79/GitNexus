import type { ImportResolutionContext, SuffixIndex } from './import-resolution-types.js';

const RESOLVE_CACHE_CAP = 100_000;

export const createImportResolutionContext = (allPaths: string[]): ImportResolutionContext => {
  const allFileList = allPaths;
  const normalizedFileList = allFileList.map((p) => p.replace(/\\/g, '/'));
  const allFilePaths = new Set(allFileList);
  const suffixIndex = buildSuffixIndex(normalizedFileList, allFileList);
  return { allFilePaths, allFileList, normalizedFileList, suffixIndex, resolveCache: new Map() };
};

export const cacheResolvedImport = (
  context: ImportResolutionContext,
  cacheKey: string,
  result: string | null,
): string | null => {
  if (context.resolveCache.size >= RESOLVE_CACHE_CAP) {
    const evictCount = Math.floor(RESOLVE_CACHE_CAP * 0.2);
    const iter = context.resolveCache.keys();
    for (let i = 0; i < evictCount; i++) {
      const key = iter.next().value;
      if (key !== undefined) context.resolveCache.delete(key);
    }
  }
  context.resolveCache.set(cacheKey, result);
  return result;
};

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

    const dirParts = parts.slice(0, -1);
    const fileName = parts[parts.length - 1];
    const dotIndex = fileName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? fileName.substring(dotIndex) : '';
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

  return {
    get: (suffix: string) => exactMap.get(suffix),
    getInsensitive: (suffix: string) => lowerMap.get(suffix.toLowerCase()),
    getFilesInDir: (dirSuffix: string, extension: string) => dirMap.get(`${dirSuffix}:${extension}`) || [],
  };
}
