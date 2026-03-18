/**
 * Serve Command
 *
 * Starts the real repo-local HTTP service for the current GNexus repo
 * boundary and keeps the process alive until it is interrupted.
 */

import { DuplicateServiceError, ServiceStartupError, startRepoLocalService } from '../server/service-runtime.js';

export const serveCommand = async () => {
  try {
    const runtime = await startRepoLocalService(process.cwd());

    console.log(`GNexus service started for ${runtime.repoRoot}`);
    console.log(`Mode: ${runtime.mode}`);
    console.log(`Listening on http://127.0.0.1:${runtime.port}`);
    if (runtime.degraded) {
      console.warn('Service started in degraded mode because the local index is stale.');
    }

    await runtime.waitUntilClosed();
  } catch (error) {
    if (error instanceof DuplicateServiceError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    if (error instanceof ServiceStartupError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start GNexus service: ${message}`);
    process.exitCode = 1;
  }
};
