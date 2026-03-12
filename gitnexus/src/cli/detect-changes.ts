import { runRepoToolCommand } from './mcp-command-client.js';

export async function detectChangesCommand(options: {
  scope?: string;
  baseRef?: string;
}): Promise<void> {
  await runRepoToolCommand('detect_changes', {
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.baseRef ? { base_ref: options.baseRef } : {}),
  });
}
