import fs from 'fs/promises';
import path from 'path';
import type { KnowledgeGraph } from '../graph/types.js';
import { loadRojoProjectIndex } from './roblox/rojo-project.js';
import type { ComposerConfig, GoModuleConfig, ImportLanguageConfigs, RojoProjectIndex, SwiftPackageConfig, TsconfigPaths } from './import-resolution-types.js';

const isDev = process.env.NODE_ENV === 'development';

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

async function loadTsconfigPaths(repoRoot: string): Promise<TsconfigPaths | null> {
  const candidates = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json'];
  for (const filename of candidates) {
    try {
      const raw = await fs.readFile(path.join(repoRoot, filename), 'utf-8');
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
