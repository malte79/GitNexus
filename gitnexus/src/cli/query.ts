import { runRepoToolCommand } from './mcp-command-client.js';

export async function queryCommand(
  terms: string[] | undefined,
  options: {
    taskContext?: string;
    goal?: string;
    limit?: number;
    maxSymbols?: number;
    includeContent?: boolean;
    owners?: boolean;
  },
): Promise<void> {
  const query = terms?.join(' ').trim();
  if (!query) {
    console.error('Query text is required. Usage: `gnexus query <terms...>`.');
    process.exitCode = 1;
    return;
  }

  await runRepoToolCommand('query', {
    query,
    ...(options.taskContext ? { task_context: options.taskContext } : {}),
    ...(options.goal ? { goal: options.goal } : {}),
    ...(Number.isInteger(options.limit) ? { limit: options.limit } : {}),
    ...(Number.isInteger(options.maxSymbols) ? { max_symbols: options.maxSymbols } : {}),
    ...(options.includeContent ? { include_content: true } : {}),
    ...(options.owners ? { owners: true } : {}),
  });
}
