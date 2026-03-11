import { ServiceStartupError, stopRepoLocalService } from '../server/service-runtime.js';

export const stopCommand = async () => {
  try {
    const result = await stopRepoLocalService(process.cwd());
    if (result.stopped && result.health) {
      console.log(`Stopped CodeNexus service (pid ${result.health.pid})`);
      return;
    }
    if (result.cleanedStaleRuntime) {
      console.log('Removed stale CodeNexus runtime metadata; no live service was running.');
      return;
    }
    console.log('No live CodeNexus service was running for this repo.');
  } catch (error) {
    if (error instanceof ServiceStartupError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};
