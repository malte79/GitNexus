import fs from 'fs/promises';
import path from 'path';
import {
  getChangedFiles,
  getChangedGovernedFiles,
  getRepoRoot,
  loadDocsManifest,
  matchesAnyPattern,
} from './docs-manifest.mjs';

const INVALID_DOCS_LINE_PATTERNS = [
  /^Docs:\s*update docs\b/i,
  /^Docs:\s*TBD\b/i,
  /^Docs:\s*later\b/i,
  /^Docs:\s*if needed\b/i,
];

const INVALID_PLACEHOLDER_PATTERNS = [
  /^\s*TBD\s*$/i,
  /^\s*TODO\s*:?.*$/i,
  /^\s*FIXME\s*:?.*$/i,
];

async function listMarkdownFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function checkActiveEpicDocsLines(repoRoot) {
  const doingDir = path.join(repoRoot, 'planning', 'epics', 'doing');
  const files = await listMarkdownFiles(doingDir);
  const failures = [];

  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const content = await fs.readFile(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (INVALID_DOCS_LINE_PATTERNS.some(pattern => pattern.test(line))) {
        failures.push(`${rel}:${index + 1} invalid Docs line: ${line.trim()}`);
      }
    });
  }

  return failures;
}

async function checkGovernedPlaceholders(repoRoot, manifest) {
  const governedFiles = await getChangedGovernedFiles(manifest);
  const failures = [];

  for (const rel of governedFiles) {
    if (!rel.endsWith('.md')) continue;
    const file = path.join(repoRoot, rel);
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (INVALID_PLACEHOLDER_PATTERNS.some(pattern => pattern.test(line))) {
        failures.push(`${rel}:${index + 1} unresolved placeholder text: ${line.trim()}`);
      }
    });
  }

  return failures;
}

async function checkOwnedContractDocsRequirement(manifest) {
  const changedFiles = await getChangedFiles();
  const changedGovernedFiles = await getChangedGovernedFiles(manifest);

  const contractChanges = changedFiles.filter(file =>
    matchesAnyPattern(file, manifest.contracts.requireDocsWhenChanged),
  );

  const docsChanged = changedGovernedFiles.length > 0;
  const durableDocsChanged = changedGovernedFiles.some(file => file.startsWith('docs/'));
  const onlyAllowlistedChanges = changedFiles.length > 0 && changedFiles.every(file =>
    matchesAnyPattern(file, manifest.contracts.allowNoDocsWhenOnlyChanged),
  );

  if (contractChanges.length > 0 && !durableDocsChanged) {
    throw new Error(
      `Owned contract surfaces changed without durable docs updates under docs/: ${contractChanges.join(', ')}`,
    );
  }

  if (onlyAllowlistedChanges && !docsChanged) {
    console.log('docs-contracts: no-docs-needed refactor/tooling change accepted by allowlist.');
    return;
  }

  if (changedFiles.length > 0 && !docsChanged && contractChanges.length === 0) {
    console.log('docs-contracts: no governed docs changes were required for this change set.');
  }
}

async function main() {
  const repoRoot = getRepoRoot();
  const manifest = await loadDocsManifest();
  const failures = [];

  failures.push(...await checkActiveEpicDocsLines(repoRoot));
  failures.push(...await checkGovernedPlaceholders(repoRoot, manifest));

  if (failures.length > 0) {
    failures.forEach(failure => console.error(failure));
    throw new Error(`Found ${failures.length} docs-contract issue(s)`);
  }

  await checkOwnedContractDocsRequirement(manifest);
}

main().catch((error) => {
  console.error(`check-docs-contracts failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
