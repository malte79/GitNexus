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

  const backend = new LocalBackend();
  const ready = await backend.init();

  if (!ready) {
    console.error('GitNexus: No usable local .codenexus index for the current repo boundary.');
    console.error('GitNexus: Create .codenexus/config.toml and run `gitnexus analyze` first.');
    process.exitCode = 1;
    return;
  }

  const repo = await backend.resolveRepo();
  console.error(`GitNexus: MCP server starting for ${repo.repoPath}`);

  await startMCPServer(backend);
};
