import { describe, expect, it } from 'vitest';
import { allowedPermitActions, isPermitAction, nextPermitStatus } from './permit-state';

describe('permit state machine (PRD §5.5)', () => {
  it('walks the happy path RESERVED → ARRIVED → LOADED → EXITED', () => {
    expect(nextPermitStatus('arrive', 'RESERVED')).toBe('ARRIVED');
    expect(nextPermitStatus('load', 'ARRIVED')).toBe('LOADED');
    expect(nextPermitStatus('exit', 'LOADED')).toBe('EXITED');
  });

  it('supports the no-show and return branches', () => {
    expect(nextPermitStatus('no-show', 'RESERVED')).toBe('NO_SHOW');
    expect(nextPermitStatus('return', 'LOADED')).toBe('RETURNED');
  });

  it('rejects illegal transitions', () => {
    expect(nextPermitStatus('load', 'RESERVED')).toBeNull();
    expect(nextPermitStatus('exit', 'ARRIVED')).toBeNull();
    expect(nextPermitStatus('arrive', 'ARRIVED')).toBeNull();
    expect(nextPermitStatus('no-show', 'ARRIVED')).toBeNull();
    expect(nextPermitStatus('return', 'EXITED')).toBeNull();
    // a pending cancel request freezes operational actions
    for (const a of ['arrive', 'load', 'exit', 'no-show', 'return'] as const) {
      expect(nextPermitStatus(a, 'CANCEL_REQUESTED')).toBeNull();
      expect(nextPermitStatus(a, 'CANCELLED')).toBeNull();
    }
  });

  it('terminal statuses allow no action', () => {
    for (const s of ['EXITED', 'CANCELLED', 'NO_SHOW', 'RETURNED'] as const) expect(allowedPermitActions(s)).toEqual([]);
    expect(allowedPermitActions('RESERVED').sort()).toEqual(['arrive', 'no-show']);
    expect(allowedPermitActions('LOADED').sort()).toEqual(['exit', 'return']);
  });

  it('recognises action names', () => {
    expect(isPermitAction('no-show')).toBe(true);
    expect(isPermitAction('cancel')).toBe(false);
  });
});
