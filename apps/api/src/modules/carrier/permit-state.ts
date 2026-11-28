import { PERMIT_TRANSITIONS, type PermitAction, type ReservationStatus } from '@cb/shared';

export const PERMIT_ACTIONS = Object.keys(PERMIT_TRANSITIONS) as PermitAction[];

export function isPermitAction(v: string): v is PermitAction {
  return (PERMIT_ACTIONS as string[]).includes(v);
}

/** Pure state machine (PRD §5.5): the target status, or null when `from` does not allow `action`. */
export function nextPermitStatus(action: PermitAction, from: ReservationStatus): ReservationStatus | null {
  const t = PERMIT_TRANSITIONS[action];
  return (t.from as readonly ReservationStatus[]).includes(from) ? t.to : null;
}

/** Actions currently allowed for a permit in `status` (drives the UI action menu). */
export function allowedPermitActions(status: ReservationStatus): PermitAction[] {
  return PERMIT_ACTIONS.filter((a) => nextPermitStatus(a, status) !== null);
}

/** Timestamp column stamped by each action (server clock). */
export const PERMIT_ACTION_TIMESTAMP: Partial<Record<PermitAction, 'arrivedAt' | 'loadedAt' | 'exitedAt'>> = {
  arrive: 'arrivedAt',
  load: 'loadedAt',
  exit: 'exitedAt',
};
