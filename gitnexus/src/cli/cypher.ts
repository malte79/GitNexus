import { runRepoToolCommand } from './mcp-command-client.js';

export async function cypherCommand(terms: string[] | undefined): Promise<void> {
  const query = terms?.join(' ').trim();
  if (!query) {
    console.error('Cypher text is required. Usage: `codenexus cypher <query...>`.');
    process.exitCode = 1;
    return;
  }

  await runRepoToolCommand('cypher', { query });
}
