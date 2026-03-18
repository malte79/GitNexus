import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import {
  getGovernedMarkdownFiles,
  getRepoRoot,
  loadDocsManifest,
  resolveCommandBinary,
} from './docs-manifest.mjs';

const execFile = promisify(execFileCb);

async function main() {
  const manifest = await loadDocsManifest();
  const governedFiles = await getGovernedMarkdownFiles(manifest);

  if (governedFiles.length === 0) {
    throw new Error('No governed markdown files resolved from docs/governed-paths.toml');
  }

  const binary = await resolveCommandBinary('markdownlint-cli2');
  const repoRoot = getRepoRoot();
  const configPath = path.join(repoRoot, '.markdownlint-cli2.jsonc');

  await execFile(binary, ['--config', configPath, ...governedFiles], {
    cwd: repoRoot,
  });
}

main().catch((error) => {
  console.error(`lint-docs failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
