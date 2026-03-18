/**
 * Init Command
 *
 * Activates GNexus for the nearest enclosing repo boundary by creating
 * `.gnexus/config.toml` when it does not already exist.
 */

import fs from 'fs/promises';
import {
  getStoragePaths,
  loadConfigStrict,
  resolveRepoBoundary,
  saveConfig,
  type GNexusConfig,
} from '../storage/repo-manager.js';

const DEFAULT_CONFIG: GNexusConfig = {
  version: 1,
  port: 4747,
  auto_index: true,
  auto_index_interval_seconds: 300,
};

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export const initCommand = async () => {
  const boundary = resolveRepoBoundary(process.cwd());
  if (!boundary) {
    console.error('Not inside a git repository.');
    process.exitCode = 1;
    return;
  }

  const { repoRoot } = boundary;
  const { storagePath, configPath } = getStoragePaths(repoRoot);

  if (await fileExists(configPath)) {
    try {
      const existing = await loadConfigStrict(storagePath);
      console.log(`GNexus is already initialized for ${repoRoot}`);
      console.log(`Config: ${configPath}`);
      console.log(`Port: ${existing.port}`);
      console.log(
        `Auto-index: ${existing.auto_index ? 'enabled' : 'disabled'} (${existing.auto_index_interval_seconds}s interval)`,
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Invalid GNexus config at ${configPath}`);
      console.error(message);
      console.error('Repair the existing config and rerun `gnexus manage init`.');
      process.exitCode = 1;
      return;
    }
  }

  await saveConfig(storagePath, DEFAULT_CONFIG);

  console.log(`Initialized GNexus for ${repoRoot}`);
  console.log(`Created ${configPath}`);
  console.log(`Port: ${DEFAULT_CONFIG.port}`);
  console.log(
    `Auto-index: ${DEFAULT_CONFIG.auto_index ? 'enabled' : 'disabled'} (${DEFAULT_CONFIG.auto_index_interval_seconds}s interval)`,
  );
};
