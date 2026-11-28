/**
 * Pure bulk-rotation state machine (`BULK_GROUP_ROTATION`). No I/O, no Date.now.
 *
 * The runtime (API) feeds the persisted state and the observable inputs (reservations made,
 * open compatible units, server time) into {@link stepBulk} and persists the returned transition.
 * Calling it again with the applied state is a no-op, which makes ticks/restarts idempotent.
 */

export type BulkWindowKind = 'HEAD' | 'FREE';
export type BulkCloseReason =
  | 'TIME'
  | 'EXHAUSTED'
  | 'ALL_RESERVED'
  | 'MANUAL'
  | 'HALL_END'
  | 'HALTED';

export interface BulkGroup {
  id: string;
  /** Members in the operator's order; the order only groups drivers, it grants no individual turn. */
  memberIds: readonly string[];
}

export interface BulkConfig {
  /** Hall opening time (epoch ms). */
  t0: number;
  /** Hall closing time (epoch ms). */
  hallEnd: number;
  headMinutes: number;
  freeMinutes: number;
  maxLoadsPerDriverPerDay: number;
}

export interface BulkCursor {
  /** Group the free-queue cursor sits on (null before initialization). */
  groupId: string | null;
  /** Members of `groupId` whose turn is not consumed yet. */
  remaining: readonly string[];
  /** 1-based free-queue round. */
  round: number;
}

export interface BulkOpenWindow {
  seq: number;
  kind: BulkWindowKind;
  round: number;
  groupId: string;
  eligible: readonly string[];
  opensAt: number;
  closesAt: number;
  /** Drivers that reserved while this window was open. */
  reserved: readonly string[];
}

export interface BulkWindowPlan {
  seq: number;
  kind: BulkWindowKind;
  round: number;
  groupId: string;
  eligible: readonly string[];
  opensAt: number;
  closesAt: number;
}

export interface BulkClosePlan {
  seq: number;
  closedAt: number;
  reason: BulkCloseReason;
  burned: readonly string[];
  carried: readonly string[];
  skipped: readonly string[];
}

export type BulkIdleReason = 'WAITING' | 'NO_UNITS' | 'HALL_END' | 'HALTED' | 'NO_ELIGIBLE';

export interface BulkStepInput {
  /** Server clock (epoch ms). */
  now: number;
  /** Active groups of this carrier, in operator order. */
  groups: readonly BulkGroup[];
  /** Today's head group (null when no group is active). */
  headGroupId: string | null;
  cursor: BulkCursor;
  config: BulkConfig;
  /** The window that is currently open, or null. */
  window: BulkOpenWindow | null;
  /** GROUP reservations already consumed today, per driver. */
  loadsToday: Readonly<Record<string, number>>;
  /** OPEN GROUP units of this carrier compatible with each driver right now (absent = 0). */
  compatibleByDriver: Readonly<Record<string, number>>;
  /** Total OPEN GROUP units of this carrier right now. */
  openUnits: number;
  /** Hall day or bulk rotation halted by the operator. */
  halted: boolean;
  /** `seq` of the last window created today (0 = none yet). */
  lastWindowSeq: number;
  /** Operator action: close the open window now with this reason. */
  forcedClose?: { reason: 'MANUAL'; at: number } | null;
}

export interface BulkStep {
  close: BulkClosePlan | null;
  open: BulkWindowPlan | null;
  cursor: BulkCursor;
  idle: BulkIdleReason | null;
}

const MS_PER_MINUTE = 60_000;
const MAX_WALKS = 2;

interface Position {
  index: number;
  round: number;
}

function moveNext(groups: readonly BulkGroup[], position: Position): Position {
  const index = (position.index + 1) % groups.length;
  return { index, round: index === 0 ? position.round + 1 : position.round };
}

function idle(reason: BulkIdleReason, cursor: BulkCursor): BulkStep {
  return { close: null, open: null, cursor, idle: reason };
}

/** Group after the current head (wraps); null when no group is active. */
export function nextHeadGroup(groups: readonly BulkGroup[], currentHeadId: string | null): string | null {
  if (groups.length === 0) return null;
  if (!currentHeadId) return groups[0]!.id;
  const index = groups.findIndex((g) => g.id === currentHeadId);
  return groups[index < 0 ? 0 : (index + 1) % groups.length]!.id;
}

/** Cursor for a fresh carrier: the group right after the chosen start head, complete members. */
export function initialBulkCursor(groups: readonly BulkGroup[], startHeadGroupId: string | null): BulkCursor {
  if (groups.length === 0) return { groupId: null, remaining: [], round: 1 };
  const headIndex = startHeadGroupId ? groups.findIndex((g) => g.id === startHeadGroupId) : -1;
  const group = groups[headIndex < 0 ? 0 : (headIndex + 1) % groups.length]!;
  return { groupId: group.id, remaining: group.memberIds, round: 1 };
}

/** True when no GROUP reservation may be made right now (BR-F4/F8 window semantics). */
export function isWindowOpen(window: BulkOpenWindow, driverId: string, now: number): boolean {
  return now >= window.opensAt && now < window.closesAt && window.eligible.includes(driverId) && !window.reserved.includes(driverId);
}

export function stepBulk(input: BulkStepInput): BulkStep {
  return input.window ? closeStep(input, input.window) : openStep(input);
}

interface CloseDecision {
  reason: BulkCloseReason;
  closedAt: number;
}

function decideClose(
  input: BulkStepInput,
  window: BulkOpenWindow,
  unresolved: readonly string[],
): CloseDecision | null {
  const { now, config, forcedClose } = input;
  const earliest = Math.min(now, window.closesAt);
  if (forcedClose && now >= forcedClose.at) return { reason: 'MANUAL', closedAt: forcedClose.at };
  if (input.openUnits <= 0) return { reason: 'EXHAUSTED', closedAt: earliest };
  if (now >= config.hallEnd) return { reason: 'HALL_END', closedAt: now };
  if (unresolved.length === 0) return { reason: 'ALL_RESERVED', closedAt: earliest };
  if (now >= window.closesAt) return { reason: 'TIME', closedAt: window.closesAt };
  if (input.halted) return { reason: 'HALTED', closedAt: now };
  return null;
}

/** Moving off an exhausted group lands on the next active group; the open step skips today's head. */
function advanceFromGroup(input: BulkStepInput): BulkCursor {
  const { groups, cursor } = input;
  const current = cursor.groupId ? groups.findIndex((g) => g.id === cursor.groupId) : -1;
  if (groups.length === 0) return cursor;
  const position =
    current < 0
      ? { index: 0, round: Math.max(1, cursor.round) }
      : moveNext(groups, { index: current, round: cursor.round });
  const group = groups[position.index]!;
  return { groupId: group.id, remaining: group.memberIds, round: position.round };
}

function closeStep(input: BulkStepInput, window: BulkOpenWindow): BulkStep {
  const reserved = new Set(window.reserved);
  const unresolved = window.eligible.filter((driverId) => !reserved.has(driverId));
  const decision = decideClose(input, window, unresolved);
  if (!decision) return idle('WAITING', input.cursor);

  // TIME/MANUAL punish a member that still had a compatible load; a member with none only loses
  // this round's turn (skipped, no penalty, T4). EXHAUSTED/HALL_END/HALTED never punish (BR-F5b).
  const punishes = decision.reason === 'TIME' || decision.reason === 'MANUAL';
  const burned = punishes ? unresolved.filter((d) => (input.compatibleByDriver[d] ?? 0) > 0) : [];
  const skipped = punishes ? unresolved.filter((d) => (input.compatibleByDriver[d] ?? 0) <= 0) : [];
  const carried = punishes ? [] : unresolved;

  let cursor = input.cursor;
  if (window.kind === 'FREE') {
    const removed = new Set<string>([...window.reserved, ...burned, ...skipped]);
    const remaining = input.cursor.remaining.filter((driverId) => !removed.has(driverId));
    cursor = remaining.length > 0 ? { ...input.cursor, remaining } : advanceFromGroup(input);
  }
  return {
    close: { seq: window.seq, closedAt: decision.closedAt, reason: decision.reason, burned, carried, skipped },
    open: null,
    cursor,
    idle: null,
  };
}

function headWindow(input: BulkStepInput, head: BulkGroup): BulkStep {
  const max = input.config.maxLoadsPerDriverPerDay;
  const eligible = head.memberIds.filter((driverId) => (input.loadsToday[driverId] ?? 0) < max);
  return {
    close: null,
    idle: null,
    cursor: input.cursor,
    open: {
      seq: 1,
      kind: 'HEAD',
      round: 1,
      groupId: head.id,
      eligible,
      opensAt: input.config.t0,
      closesAt: input.config.t0 + input.config.headMinutes * MS_PER_MINUTE,
    },
  };
}

function openStep(input: BulkStepInput): BulkStep {
  const { now, config, groups, headGroupId, openUnits, halted, lastWindowSeq, cursor } = input;
  if (halted) return idle('HALTED', cursor);
  if (now < config.t0) return idle('WAITING', cursor);
  if (now >= config.hallEnd) return idle('HALL_END', cursor);
  if (openUnits <= 0) return idle('NO_UNITS', cursor);
  if (lastWindowSeq === 0 && headGroupId) {
    const head = groups.find((g) => g.id === headGroupId);
    return head ? headWindow(input, head) : idle('NO_ELIGIBLE', cursor);
  }
  return openFreeWindow(input);
}

function openFreeWindow(input: BulkStepInput): BulkStep {
  const { groups, headGroupId, cursor, config } = input;
  if (groups.length === 0) return idle('NO_ELIGIBLE', cursor);

  let position: Position;
  let remaining: readonly string[];
  if (!cursor.groupId) {
    const headIndex = headGroupId ? groups.findIndex((g) => g.id === headGroupId) : -1;
    position =
      headIndex < 0
        ? { index: 0, round: Math.max(1, cursor.round) }
        : moveNext(groups, { index: headIndex, round: Math.max(1, cursor.round) });
    remaining = groups[position.index]!.memberIds;
  } else {
    const found = groups.findIndex((g) => g.id === cursor.groupId);
    position = { index: found < 0 ? 0 : found, round: Math.max(1, cursor.round) };
    remaining = found < 0 ? groups[0]!.memberIds : cursor.remaining;
  }

  // Walk the rotation until a group with at least one eligible member is found; today's head is
  // skipped in every round (BR-F7). The guard stops a carrier whose drivers are all at the daily cap.
  for (let guard = 0; guard < groups.length * MAX_WALKS; guard += 1) {
    const group = groups[position.index]!;
    if (group.id !== headGroupId) {
      const eligible = remaining.filter((d) => (input.loadsToday[d] ?? 0) < config.maxLoadsPerDriverPerDay);
      if (eligible.length > 0) {
        return {
          close: null,
          idle: null,
          cursor: { groupId: group.id, remaining: eligible, round: position.round },
          open: {
            seq: input.lastWindowSeq + 1,
            kind: 'FREE',
            round: position.round,
            groupId: group.id,
            eligible,
            opensAt: input.now,
            closesAt: input.now + config.freeMinutes * MS_PER_MINUTE,
          },
        };
      }
    }
    position = moveNext(groups, position);
    remaining = groups[position.index]!.memberIds;
  }
  return idle('NO_ELIGIBLE', cursor);
}
