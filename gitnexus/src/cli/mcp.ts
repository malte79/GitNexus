/**
 * MCP Command
 *
 * Starts the current standalone MCP server.
 * This remains the temporary transport seam until the repo-local
 * HTTP runtime replaces it in later epics.
 */

import { startMCPServer } from '../mcp/server.js';
import { LocalBackend } from '../mcp/local/local-backend.js';

export const mcpCommand = async () => {
  // Prevent unhandled errors from crashing the MCP server process.
  // KuzuDB lock conflicts and transient errors should degrade gracefully.
  process.on('uncaughtException', (err) => {
    console.error(`GitNexus MCP: uncaught exception — ${err.message}`);
    // Process is in an undefined state after uncaughtException — exit after flushing
    setTimeout(() => process.exit(1), 100);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`GitNexus MCP: unhandled rejection — ${msg}`);
  });

  // Initialize the current registry-backed backend.
  const backend = new LocalBackend();
  await backend.init();

  const repos = await backend.listRepos();
  if (repos.length === 0) {
    console.error('GitNexus: No indexed repos yet. Run `gitnexus analyze` in a git repo — the server will pick it up automatically.');
  } else {
    console.error(`GitNexus: MCP server starting with ${repos.length} repo(s): ${repos.map(r => r.name).join(', ')}`);
  }

  // Start the current stdio MCP server.
  await startMCPServer(backend);
};
