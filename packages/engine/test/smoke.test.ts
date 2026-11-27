import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index';

// Placeholder until Phase 3 adds the reference tests (BULK_GROUP_ROTATION_SPEC §11).
describe('engine package', () => {
  it('exposes a version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
