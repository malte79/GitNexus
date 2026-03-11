import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { waitForRepoLocalService, DuplicateServiceError, ServiceStartupError } from '../server/service-runtime.js';

export const startCommand = async () => {
  try {
    const cliEntrypoint = fileURLToPath(new URL('./index.js', import.meta.url));
    const child = spawn(process.execPath, [cliEntrypoint, 'serve'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CODENEXUS_SERVICE_MODE: 'background',
      },
    });

    child.unref();

    const health = await waitForRepoLocalService(process.cwd());
    console.log(`CodeNexus service started in background (pid ${health.pid})`);
    console.log(`Listening on http://127.0.0.1:${health.port}`);
  } catch (error) {
    if (error instanceof DuplicateServiceError || error instanceof ServiceStartupError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};
