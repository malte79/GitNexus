import { runRepoToolCommand } from './mcp-command-client.js';

export async function renameCommand(
  symbolName: string | undefined,
  options: {
    uid?: string;
    newName: string;
    filePath?: string;
    apply?: boolean;
  },
): Promise<void> {
  if (!symbolName && !options.uid) {
    console.error('Provide a symbol name or `--uid`. Usage: `codenexus rename <symbolName> --new-name <name>`.');
    process.exitCode = 1;
    return;
  }

  await runRepoToolCommand('rename', {
    ...(symbolName ? { symbol_name: symbolName } : {}),
    ...(options.uid ? { symbol_uid: options.uid } : {}),
    new_name: options.newName,
    ...(options.filePath ? { file_path: options.filePath } : {}),
    dry_run: !options.apply,
  });
}
