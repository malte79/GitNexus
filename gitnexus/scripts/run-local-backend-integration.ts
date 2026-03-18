import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LOCAL_BACKEND_OWNER_FILE,
  LOCAL_BACKEND_INTEGRATION_CASES,
  cleanupLocalBackendIntegration,
  setupLocalBackendIntegration,
} from '../test/integration/local-backend-suite.js';
const reallyExit = (process as NodeJS.Process & { reallyExit?: (code?: number) => never }).reallyExit;
const STALE_BACKEND_TEST_DIR_MS = 10 * 60 * 1000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function purgeStaleBackendTestDirs(): Promise<void> {
  const tmpRoot = os.tmpdir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(tmpRoot);
  } catch {
    return;
  }

  await Promise.all(entries
    .filter((entry) => entry.startsWith('backend-test-'))
    .map(async (entry) => {
      const dirPath = path.join(tmpRoot, entry);
      const ownerFilePath = path.join(dirPath, LOCAL_BACKEND_OWNER_FILE);
      try {
        const [dirStat, ownerFile] = await Promise.all([
          fs.stat(dirPath),
          fs.readFile(ownerFilePath, 'utf8').catch(() => null),
        ]);
        const ageMs = Date.now() - dirStat.mtimeMs;

        if (ownerFile) {
          const owner = JSON.parse(ownerFile) as { pid?: number; startedAt?: number };
          if (typeof owner.pid === 'number' && isProcessAlive(owner.pid)) {
            return;
          }
          if (ageMs < STALE_BACKEND_TEST_DIR_MS) {
            return;
          }
        } else if (ageMs < STALE_BACKEND_TEST_DIR_MS) {
          return;
        }

        await fs.rm(dirPath, { recursive: true, force: true });
      } catch {
        // best-effort purge
      }
    }));
}

async function main(): Promise<void> {
  await purgeStaleBackendTestDirs();
  let ctx: Awaited<ReturnType<typeof setupLocalBackendIntegration>> | null = null;
  let passed = 0;

  try {
    ctx = await setupLocalBackendIntegration();

    for (const testCase of LOCAL_BACKEND_INTEGRATION_CASES) {
      await testCase.run(ctx);
      passed += 1;
      console.log(`ok ${passed} - ${testCase.name}`);
    }

    console.log(`1..${LOCAL_BACKEND_INTEGRATION_CASES.length}`);
    console.log(`# local-backend integration: ${passed}/${LOCAL_BACKEND_INTEGRATION_CASES.length} passed`);
  } finally {
    if (ctx) {
      await cleanupLocalBackendIntegration(ctx, { closePool: true });
    }
  }
}

main()
  .then(() => {
    // Kuzu native teardown is still unstable under normal Node shutdown, even after explicit pool cleanup.
    if (reallyExit) {
      reallyExit(0);
      return;
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    if (reallyExit) {
      reallyExit(1);
      return;
    }
    process.exit(1);
  });
