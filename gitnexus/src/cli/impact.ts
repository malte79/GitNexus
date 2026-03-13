import { runRepoToolCommand } from './mcp-command-client.js';

export async function impactCommand(
  target: string | undefined,
  options: {
    uid?: string;
    filePath?: string;
    direction: string;
    maxDepth?: number;
    relationType?: string[];
    includeTests?: boolean;
    minConfidence?: number;
  },
): Promise<void> {
  if (!target && !options.uid) {
    console.error('Provide a symbol name or `--uid`. Usage: `codenexus impact <target> --direction upstream`.');
    process.exitCode = 1;
    return;
  }

  if (options.direction !== 'upstream' && options.direction !== 'downstream') {
    console.error('`--direction` must be `upstream` or `downstream`.');
    process.exitCode = 1;
    return;
  }

  await runRepoToolCommand('impact', {
    ...(target ? { target } : {}),
    ...(options.uid ? { uid: options.uid } : {}),
    ...(options.filePath ? { file_path: options.filePath } : {}),
    direction: options.direction,
    ...(Number.isInteger(options.maxDepth) ? { maxDepth: options.maxDepth } : {}),
    ...(options.relationType?.length ? { relationTypes: options.relationType } : {}),
    ...(options.includeTests ? { includeTests: true } : {}),
    ...(typeof options.minConfidence === 'number' && Number.isFinite(options.minConfidence)
      ? { minConfidence: options.minConfidence }
      : {}),
  });
}
