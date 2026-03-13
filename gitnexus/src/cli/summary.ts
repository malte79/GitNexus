import { runRepoToolCommand } from './mcp-command-client.js';

export async function summaryCommand(options: {
  clusters?: boolean;
  processes?: boolean;
  limit?: number;
  subsystems?: boolean;
}): Promise<void> {
  await runRepoToolCommand('summary', {
    showClusters: options.clusters,
    showProcesses: options.processes,
    ...(Number.isInteger(options.limit) ? { limit: options.limit } : {}),
    ...(options.subsystems ? { showSubsystems: true } : {}),
  });
}
