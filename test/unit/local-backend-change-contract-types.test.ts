import { describe, expect, it } from 'vitest';

import { isTestLikePath } from '../../src/mcp/local/local-backend-change-contract-types.js';

describe('isTestLikePath', () => {
  it('treats Luau spec and test files as test-like paths', () => {
    expect(isTestLikePath('test/unit/death_laser_ambient_motion_runtime_spec.luau')).toBe(true);
    expect(isTestLikePath('test/unit/death_laser_ambient_motion_runtime.test.luau')).toBe(true);
    expect(isTestLikePath('src/server/Game/DeathLaserRuntime/AmbientMotionRuntime.luau')).toBe(false);
  });
});
