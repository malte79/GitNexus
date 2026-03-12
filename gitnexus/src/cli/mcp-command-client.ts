import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  getStoragePaths,
  loadConfig,
  loadRepo,
  probeServiceHealth,
  resolveRepoBoundary,
} from '../storage/repo-manager.js';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractToolText(result: any): string {
  if (!result?.content || !Array.isArray(result.content)) {
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  const text = result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n')
    .trim();

  return text || JSON.stringify(result, null, 2);
}

export async function callRepoTool(
  toolName: string,
  args: Record<string, unknown>,
  startPath = process.cwd(),
): Promise<{ text: string; isError: boolean }> {
  const boundary = resolveRepoBoundary(startPath);
  if (!boundary) {
    throw new Error('Not a git repository.');
  }

  const { storagePath } = getStoragePaths(boundary.repoRoot);
  const config = await loadConfig(storagePath);
  if (!config) {
    throw new Error(
      'CodeNexus is not initialized for this repo. Run `codenexus manage init`, `codenexus manage index`, then `codenexus manage start`.',
    );
  }

  const indexedRepo = await loadRepo(boundary.repoRoot);
  if (!indexedRepo) {
    throw new Error(
      'CodeNexus index is not ready for this repo. Run `codenexus manage index`, then `codenexus manage start`.',
    );
  }

  const liveHealth = await probeServiceHealth(config.port);
  if (!liveHealth) {
    throw new Error(
      'CodeNexus service is not running for this repo. Run `codenexus manage start`.',
    );
  }

  if (
    liveHealth.repo_root !== boundary.repoRoot ||
    liveHealth.worktree_root !== boundary.worktreeRoot
  ) {
    throw new Error(
      `Configured port ${config.port} is serving a different repo (${liveHealth.repo_root}). Stop that service and run \`codenexus manage start\` from the current repo.`,
    );
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${liveHealth.port}/api/mcp`),
  );
  const client = new Client({
    name: 'codenexus-cli',
    version: '1.0.0',
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return {
      text: extractToolText(result),
      isError: !!result?.isError,
    };
  } finally {
    try {
      await client.close();
    } catch {
      // best-effort cleanup only
    }
  }
}

export async function runRepoToolCommand(
  toolName: string,
  args: Record<string, unknown>,
  startPath = process.cwd(),
): Promise<void> {
  try {
    const result = await callRepoTool(toolName, args, startPath);
    const sink = result.isError ? console.error : console.log;
    sink(result.text);
    if (result.isError) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(getErrorMessage(error));
    process.exitCode = 1;
  }
}
