/**
 * P0 Integration Tests: Local Backend
 *
 * The integration wrapper runs the same shared suite via a plain tsx harness
 * because native Kuzu teardown is unstable under Vitest worker shutdown.
 * This Vitest file remains for direct local debugging of the assertions.
 */
import { beforeAll, afterAll, describe, it } from 'vitest';
import {
  LOCAL_BACKEND_INTEGRATION_CASES,
  cleanupLocalBackendIntegration,
  setupLocalBackendIntegration,
  type LocalBackendIntegrationContext,
} from './local-backend-suite.js';

let ctx: LocalBackendIntegrationContext;

beforeAll(async () => {
  ctx = await setupLocalBackendIntegration();
}, 30000);

afterAll(async () => {
  await cleanupLocalBackendIntegration(ctx, { closePool: false });
});

describe('local backend integration', () => {
  for (const testCase of LOCAL_BACKEND_INTEGRATION_CASES) {
    it(testCase.name, async () => {
      await testCase.run(ctx);
    });
  }
});
