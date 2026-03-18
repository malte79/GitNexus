import fs from 'fs/promises';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import { parse } from 'smol-toml';

const execFile = promisify(execFileCb);

const scriptFile = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptFile);
const packageRoot = path.resolve(scriptsDir, '..');
const repoRoot = packageRoot;

const normalize = (filePath) => filePath.split(path.sep).join('/');

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function getRepoRoot() {
  return repoRoot;
}

export function getPackageRoot() {
  return packageRoot;
}

export function getManifestPath() {
  return path.join(repoRoot, 'docs', 'governed-paths.toml');
}

export async function loadDocsManifest() {
  const manifestPath = getManifestPath();
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = parse(raw);

  const governed = parsed.governed ?? {};
  const contracts = parsed.contracts ?? {};

  return {
    version: parsed.version,
    governed: {
      include: assertStringArray(governed.include ?? [], 'governed.include'),
      exclude: assertStringArray(governed.exclude ?? [], 'governed.exclude'),
    },
    contracts: {
      requireDocsWhenChanged: assertStringArray(
        contracts.require_docs_when_changed ?? [],
        'contracts.require_docs_when_changed',
      ),
      allowNoDocsWhenOnlyChanged: assertStringArray(
        contracts.allow_no_docs_when_only_changed ?? [],
        'contracts.allow_no_docs_when_only_changed',
      ),
    },
  };
}

export async function expandPatterns(patterns) {
  const results = new Set();
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: repoRoot,
      nodir: true,
      dot: true,
      windowsPathsNoEscape: true,
    });
    for (const match of matches) {
      results.add(normalize(match));
    }
  }
  return Array.from(results).sort();
}

export async function getGovernedFiles(manifest) {
  const included = await expandPatterns(manifest.governed.include);
  const excluded = new Set(await expandPatterns(manifest.governed.exclude));
  return included.filter(file => !excluded.has(file));
}

export function matchesAnyPattern(filePath, patterns) {
  return patterns.some(pattern => minimatch(filePath, pattern, { dot: true }));
}

async function resolveBaseRef() {
  const candidates = ['origin/main', 'origin/master', 'main', 'master'];
  for (const ref of candidates) {
    try {
      await execFile('git', ['rev-parse', '--verify', ref], { cwd: repoRoot });
      return ref;
    } catch {
      // try next ref
    }
  }
  return null;
}

async function runGit(args) {
  try {
    const { stdout } = await execFile('git', args, { cwd: repoRoot });
    return stdout
      .split('\n')
      .map(line => normalize(line.trim()))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function getChangedFiles() {
  const changed = new Set();
  const baseRef = await resolveBaseRef();

  if (baseRef) {
    try {
      const { stdout } = await execFile('git', ['merge-base', 'HEAD', baseRef], { cwd: repoRoot });
      const mergeBase = stdout.trim();
      const committed = await runGit(['diff', '--name-only', `${mergeBase}...HEAD`, '--']);
      committed.forEach(file => changed.add(file));
    } catch {
      // fall through to working tree and untracked state
    }
  }

  const worktree = await runGit(['diff', '--name-only', '--']);
  const staged = await runGit(['diff', '--cached', '--name-only', '--']);
  const untracked = await runGit(['ls-files', '--others', '--exclude-standard']);

  [...worktree, ...staged, ...untracked].forEach(file => changed.add(file));

  return Array.from(changed).sort();
}

export async function getChangedGovernedFiles(manifest) {
  const changedFiles = await getChangedFiles();
  return changedFiles.filter(file => matchesAnyPattern(file, manifest.governed.include))
    .filter(file => !matchesAnyPattern(file, manifest.governed.exclude));
}

export async function getGovernedMarkdownFiles(manifest) {
  const governedFiles = await getGovernedFiles(manifest);
  return governedFiles.filter(file => file.endsWith('.md'));
}

export async function resolveCommandBinary(binaryName) {
  const candidate = path.join(
    packageRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${binaryName}.cmd` : binaryName,
  );
  if (!(await fileExists(candidate))) {
    throw new Error(`${binaryName} is not installed at ${candidate}`);
  }
  return candidate;
}
