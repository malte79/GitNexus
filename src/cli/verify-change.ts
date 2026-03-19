import fs from 'node:fs';
import { runRepoToolCommand } from './mcp-command-client.js';

export async function verifyChangeCommand(
  terms: string[] | undefined,
  options: {
    contractFile?: string;
    taskContext?: string;
    scope?: string;
    baseRef?: string;
    changedFile?: string[];
    reportedTestTarget?: string[];
    maxSurfaces?: number;
  },
): Promise<void> {
  const goal = terms?.join(' ').trim();
  let contractJson: string | undefined;

  if (options.contractFile) {
    try {
      contractJson = fs.readFileSync(options.contractFile, 'utf-8');
    } catch (error) {
      console.error(`Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
  }

  if (!goal && !contractJson) {
    console.error('Provide a goal or `--contract-file`. Usage: `gnexus verify-change <goal...>`.');
    process.exitCode = 1;
    return;
  }

  await runRepoToolCommand('verify_change', {
    ...(goal ? { goal } : {}),
    ...(contractJson ? { contract_json: contractJson } : {}),
    ...(options.taskContext ? { task_context: options.taskContext } : {}),
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.baseRef ? { base_ref: options.baseRef } : {}),
    ...(options.changedFile?.length ? { changed_files: options.changedFile } : {}),
    ...(options.reportedTestTarget?.length ? { reported_test_targets: options.reportedTestTarget } : {}),
    ...(Number.isInteger(options.maxSurfaces) ? { max_surfaces: options.maxSurfaces } : {}),
  });
}
