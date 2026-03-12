import { runRepoToolCommand } from './mcp-command-client.js';

export async function contextCommand(
  name: string | undefined,
  options: {
    uid?: string;
    filePath?: string;
    includeContent?: boolean;
  },
): Promise<void> {
  if (!name && !options.uid) {
    console.error('Provide a symbol name or `--uid`. Usage: `codenexus context <name>`.');
    process.exitCode = 1;
    return;
  }

  await runRepoToolCommand('context', {
    ...(name ? { name } : {}),
    ...(options.uid ? { uid: options.uid } : {}),
    ...(options.filePath ? { file_path: options.filePath } : {}),
    ...(options.includeContent ? { include_content: true } : {}),
  });
}
