import fs from 'node:fs/promises';
import path from 'node:path';
import type { RojoMappedTarget, RojoMount, RojoProjectIndex, RobloxRuntimeArea } from './types.js';

interface RojoProjectFile {
  tree?: Record<string, unknown>;
}

interface RojoTreeNode {
  $path?: string;
  $className?: string;
  [key: string]: unknown;
}

const SUPPORTED_PROJECT_FILE = 'default.project.json';

const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');

const toRuntimeArea = (segments: string[]): RobloxRuntimeArea => {
  const [head, second] = segments;
  if (head === 'ReplicatedStorage') return 'shared';
  if (head === 'ServerScriptService' || head === 'ServerStorage') return 'server';
  if (head === 'StarterPlayer' || head === 'StarterGui' || head === 'StarterPack') return 'client';
  if (second === 'StarterPlayerScripts') return 'client';
  return 'other';
};

const stripLuauExtension = (name: string): string | null => {
  const match = name.match(/^(.*)\.(lua|luau)$/);
  if (!match) return null;
  let stem = match[1];
  if (stem === 'init') return '';
  if (stem.endsWith('.client')) stem = stem.slice(0, -7);
  if (stem.endsWith('.server')) stem = stem.slice(0, -7);
  return stem;
};

const walkTree = (node: RojoTreeNode, currentSegments: string[], mounts: RojoMount[]) => {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$') || !value || typeof value !== 'object') continue;
    const child = value as RojoTreeNode;
    const childSegments = [...currentSegments, key];
    if (typeof child.$path === 'string') {
      mounts.push({
        sourcePath: normalizePath(child.$path),
        dataModelSegments: childSegments,
        runtimeArea: toRuntimeArea(childSegments),
      });
    }
    walkTree(child, childSegments, mounts);
  }
};

const buildTargetsForFile = (filePath: string, mounts: RojoMount[]): RojoMappedTarget[] => {
  const normalizedFilePath = normalizePath(filePath);
  const targets: RojoMappedTarget[] = [];
  for (const mount of mounts) {
    if (normalizedFilePath !== mount.sourcePath && !normalizedFilePath.startsWith(`${mount.sourcePath}/`)) continue;
    if (normalizedFilePath === mount.sourcePath) {
      const mountedFileName = path.basename(normalizedFilePath);
      const mountedInstanceName = stripLuauExtension(mountedFileName);
      if (mountedInstanceName === null) continue;
      targets.push({
        filePath: normalizedFilePath,
        dataModelPath: mount.dataModelSegments.join('/'),
        dataModelSegments: [...mount.dataModelSegments],
        runtimeArea: mount.runtimeArea,
      });
      continue;
    }

    const relative = normalizedFilePath === mount.sourcePath
      ? ''
      : normalizedFilePath.slice(mount.sourcePath.length + 1);
    const parts = relative ? relative.split('/').filter(Boolean) : [];
    if (parts.length === 0) continue;
    const fileName = parts[parts.length - 1];
    const instanceName = stripLuauExtension(fileName);
    if (instanceName === null) continue;
    const dirSegments = parts.slice(0, -1);
    const dataModelSegments = [
      ...mount.dataModelSegments,
      ...dirSegments,
      ...(instanceName ? [instanceName] : []),
    ];
    targets.push({
      filePath: normalizedFilePath,
      dataModelPath: dataModelSegments.join('/'),
      dataModelSegments,
      runtimeArea: mount.runtimeArea,
    });
  }
  return targets;
};

export const loadRojoProjectIndex = async (
  repoRoot: string,
  allFilePaths: string[],
): Promise<RojoProjectIndex | null> => {
  const projectFilePath = path.join(repoRoot, SUPPORTED_PROJECT_FILE);
  let parsed: RojoProjectFile;
  try {
    parsed = JSON.parse(await fs.readFile(projectFilePath, 'utf-8')) as RojoProjectFile;
  } catch {
    return null;
  }

  const tree = parsed.tree;
  if (!tree || typeof tree !== 'object') return null;

  const mounts: RojoMount[] = [];
  walkTree(tree as RojoTreeNode, [], mounts);
  if (mounts.length === 0) return null;

  const fileTargets = new Map<string, RojoMappedTarget[]>();
  const reverseTargets = new Map<string, string[]>();
  for (const filePath of allFilePaths) {
    const normalizedFilePath = normalizePath(filePath);
    const targets = buildTargetsForFile(normalizedFilePath, mounts);
    if (targets.length === 0) continue;
    fileTargets.set(normalizedFilePath, targets);
    for (const target of targets) {
      const key = target.dataModelSegments.join('/');
      const existing = reverseTargets.get(key);
      if (existing) {
        if (!existing.includes(normalizedFilePath)) existing.push(normalizedFilePath);
      } else {
        reverseTargets.set(key, [normalizedFilePath]);
      }
    }
  }

  return {
    projectFilePath: normalizePath(path.relative(repoRoot, projectFilePath)),
    mounts,
    getTargetsForFile(filePath: string): RojoMappedTarget[] {
      return fileTargets.get(normalizePath(filePath)) ?? [];
    },
    resolveDataModelSegments(dataModelSegments: string[]): string[] {
      return reverseTargets.get(dataModelSegments.join('/')) ?? [];
    },
    getRuntimeAreaForPath(filePath: string): RobloxRuntimeArea | null {
      const normalizedFilePath = normalizePath(filePath);
      const directTargets = fileTargets.get(normalizedFilePath);
      if (directTargets?.length) {
        return directTargets[0].runtimeArea;
      }
      for (const mount of mounts) {
        if (normalizedFilePath === mount.sourcePath || normalizedFilePath.startsWith(`${mount.sourcePath}/`)) {
          return mount.runtimeArea;
        }
      }
      return null;
    },
  };
};
