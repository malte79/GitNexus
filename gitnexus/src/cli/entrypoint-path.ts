import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CliInvocation {
  command: string;
  args: string[];
}

export function resolveCliInvocation(commandArgs: string[]): CliInvocation {
  const moduleDir = fileURLToPath(new URL('.', import.meta.url));
  const candidateEntrypoints = [
    path.join(moduleDir, 'index.js'),
    path.resolve(moduleDir, '..', '..', 'dist', 'cli', 'index.js'),
  ];

  for (const builtEntrypoint of candidateEntrypoints) {
    if (!fs.existsSync(builtEntrypoint)) {
      continue;
    }

    return {
      command: process.execPath,
      args: [builtEntrypoint, ...commandArgs],
    };
  }

  throw new Error(
    `CodeNexus CLI child invocation requires built CLI assets at ${candidateEntrypoints[0]} or ${candidateEntrypoints[1]}. ` +
      'Run `npm run build --prefix gitnexus` before using background service commands from a source checkout.',
  );
}
