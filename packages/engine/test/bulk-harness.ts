import {
  stepBulk,
  type BulkClosePlan,
  type BulkConfig,
  type BulkCursor,
  type BulkGroup,
  type BulkIdleReason,
  type BulkOpenWindow,
  type BulkStepInput,
  type BulkWindowPlan,
} from '../src/bulk';

/** Fixed hall clock for every simulation: 06:00 Asia/Tehran. */
export const T0 = Date.UTC(2026, 0, 1, 2, 30, 0);

export function config(overrides: Partial<BulkConfig> = {}): BulkConfig {
  return {
    t0: T0,
    hallEnd: T0 + 8 * 60 * 60_000,
    headMinutes: 10,
    freeMinutes: 5,
    maxLoadsPerDriverPerDay: 2,
    ...overrides,
  };
}

export const memberId = (groupNo: number, index: number): string => `g${groupNo}-${index}`;

/** 20 groups × 6 drivers, operator order 1..20. */
export function groups20x6(): BulkGroup[] {
  return Array.from({ length: 20 }, (_, g) => ({
    id: `g${g + 1}`,
    memberIds: Array.from({ length: 6 }, (_, i) => memberId(g + 1, i + 1)),
  }));
}

export interface SimDay {
  groups: BulkGroup[];
  /** 1-based group number the cursor sits on (null = uninitialized). */
  cursorGroup: number | null;
  /** How many members of the cursor group are still remaining (default: everybody). */
  cursorRemaining?: number;
  /** 1-based head group number (null = no head). */
  headGroup: number | null;
  loads: number;
  now?: number;
  maxLoads?: number;
  initialLoads?: Record<string, number>;
  /** Reserve one unit per eligible driver as soon as a window opens (default true). */
  autoReserve?: boolean;
  /** Burn-side view of compatible units: 'all' (default) or 'none'. */
  compatible?: 'all' | 'none';
  haltOnFirstWindow?: boolean;
  manualCloseFirstWindow?: boolean;
  addUnitsOnIdle?: number;
  jumpToHallEndAfterOpen?: boolean;
}

export interface SimResult {
  windows: BulkWindowPlan[];
  closes: BulkClosePlan[];
  burns: BulkClosePlan[];
  reservations: { seq: number; driverIds: string[] }[];
  /** Windows opened after the first idle period (loads re-appeared). */
  windowsAfterIdle: BulkWindowPlan[];
  cursor: BulkCursor;
  idle: BulkIdleReason | null;
  steps: number;
  openUnits: number;
}

interface SimState {
  now: number;
  cursor: BulkCursor;
  loadsToday: Record<string, number>;
  openUnits: number;
  lastWindowSeq: number;
  window: BulkOpenWindow | null;
  halted: boolean;
  forcedClose: { reason: 'MANUAL'; at: number } | null;
}

const MAX_STEPS = 10_000;

/** In-memory driver of the pure state machine; the API runner mirrors this loop. */
export function simulate(day: SimDay): SimResult {
  const cfg = config({ maxLoadsPerDriverPerDay: day.maxLoads ?? 2 });
  const autoReserve = day.autoReserve ?? true;
  const headGroupId = day.headGroup ? (day.groups[day.headGroup - 1]?.id ?? null) : null;
  const state: SimState = {
    now: day.now ?? T0,
    cursor: initialCursor(day),
    loadsToday: { ...(day.initialLoads ?? {}) },
    openUnits: day.loads,
    lastWindowSeq: 0,
    window: null,
    halted: false,
    forcedClose: null,
  };
  const result: SimResult = {
    windows: [],
    closes: [],
    burns: [],
    reservations: [],
    windowsAfterIdle: [],
    cursor: state.cursor,
    idle: null,
    steps: 0,
    openUnits: 0,
  };
  let addedUnits = false;
  let idleSeen = false;

  for (let steps = 0; steps < MAX_STEPS; steps += 1) {
    result.steps = steps + 1;
    const step = stepBulk(buildInput(day, state, headGroupId, cfg));

    if (step.open) {
      result.windows.push(step.open);
      if (idleSeen) result.windowsAfterIdle.push(step.open);
      state.window = { ...step.open, reserved: [] };
      state.cursor = step.cursor;
      state.lastWindowSeq = step.open.seq;
      state.forcedClose =
        day.manualCloseFirstWindow && step.open.seq === 1 ? { reason: 'MANUAL', at: state.now } : null;
      const reserved = autoReserve ? reserveAll(state) : [];
      result.reservations.push({ seq: step.open.seq, driverIds: reserved });
      if (day.jumpToHallEndAfterOpen) state.now = cfg.hallEnd;
      if (day.haltOnFirstWindow) state.halted = true;
      continue;
    }

    if (step.close) {
      result.closes.push(step.close);
      if (step.close.burned.length > 0 || step.close.skipped.length > 0) result.burns.push(step.close);
      state.cursor = step.cursor;
      state.window = null;
      state.forcedClose = null;
      state.now = Math.max(state.now, step.close.closedAt);
      continue;
    }

    result.idle = step.idle;
    result.cursor = state.cursor;
    result.openUnits = state.openUnits;
    idleSeen = true;
    if (step.idle === 'NO_UNITS' && day.addUnitsOnIdle && !addedUnits) {
      addedUnits = true;
      state.openUnits += day.addUnitsOnIdle;
      result.idle = null;
      continue;
    }
    break;
  }
  result.cursor = state.cursor;
  result.openUnits = state.openUnits;
  if (result.idle === null) throw new Error('simulation did not settle');
  return result;
}

function initialCursor(day: SimDay): BulkCursor {
  if (day.cursorGroup === null) return { groupId: null, remaining: [], round: 1 };
  const group = day.groups[day.cursorGroup - 1];
  return {
    groupId: group?.id ?? null,
    remaining: group ? group.memberIds.slice(0, day.cursorRemaining ?? group.memberIds.length) : [],
    round: 1,
  };
}

function buildInput(day: SimDay, state: SimState, headGroupId: string | null, cfg: BulkConfig): BulkStepInput {
  return {
    now: state.now,
    groups: day.groups,
    headGroupId,
    cursor: state.cursor,
    config: cfg,
    window: state.window,
    loadsToday: state.loadsToday,
    compatibleByDriver: compatibleMap(day, state),
    openUnits: state.openUnits,
    halted: state.halted,
    lastWindowSeq: state.lastWindowSeq,
    forcedClose: state.forcedClose,
  };
}

function reserveAll(state: SimState): string[] {
  const window = state.window;
  if (!window) return [];
  const reserved: string[] = [];
  for (const driverId of window.eligible) {
    if (state.openUnits <= 0) break;
    state.openUnits -= 1;
    state.loadsToday[driverId] = (state.loadsToday[driverId] ?? 0) + 1;
    reserved.push(driverId);
  }
  state.window = { ...window, reserved };
  return reserved;
}

function compatibleMap(day: SimDay, state: SimState): Record<string, number> {
  if (day.compatible === 'none') return {};
  const out: Record<string, number> = {};
  for (const group of day.groups) for (const id of group.memberIds) out[id] = state.openUnits;
  return out;
}

export interface DaySummary {
  windows: BulkWindowPlan[];
  closes: BulkClosePlan[];
  burns: BulkClosePlan[];
  headLoads: number;
  windowsConsumed: { group: number; reserved: number }[];
  cursor: { group: string | null; remaining: number; round: number };
  idle: BulkIdleReason | null;
  /** Re-running the tick on the final (applied) state: must be a no-op. */
  replay: { open: BulkWindowPlan | null; close: BulkClosePlan | null; idle: BulkIdleReason | null };
  resumedWindow: BulkWindowPlan | null;
  resumedReserved: number;
}

/** Convenience wrapper used by the reference-table tests. */
export function bulkDaySimulator(day: SimDay): DaySummary {
  const sim = simulate(day);
  const headWindow = sim.windows.find((w) => w.kind === 'HEAD');
  const resumed = sim.windowsAfterIdle[0] ?? null;
  return {
    windows: sim.windows,
    closes: sim.closes,
    burns: sim.burns,
    headLoads: sim.reservations.find((r) => r.seq === headWindow?.seq)?.driverIds.length ?? 0,
    windowsConsumed: sim.windows
      .filter((w) => w.kind === 'FREE')
      .map((w) => ({
        group: Number(w.groupId.replace('g', '')),
        reserved: sim.reservations.find((r) => r.seq === w.seq)?.driverIds.length ?? 0,
      })),
    cursor: {
      group: sim.cursor.groupId,
      remaining: sim.cursor.remaining.length,
      round: sim.cursor.round,
    },
    idle: sim.idle,
    replay: replayTick(day, sim),
    resumedWindow: resumed,
    resumedReserved: resumed ? (sim.reservations.find((r) => r.seq === resumed.seq)?.driverIds.length ?? 0) : 0,
  };
}

/** One more tick with the final cursor, no window and no new loads. */
function replayTick(day: SimDay, sim: SimResult): DaySummary['replay'] {
  const step = stepBulk({
    now: T0 + 60 * 60_000,
    groups: day.groups,
    headGroupId: day.headGroup ? (day.groups[day.headGroup - 1]?.id ?? null) : null,
    cursor: sim.cursor,
    config: config({ maxLoadsPerDriverPerDay: day.maxLoads ?? 2 }),
    window: null,
    loadsToday: {},
    compatibleByDriver: {},
    openUnits: sim.openUnits,
    halted: false,
    lastWindowSeq: sim.windows.length,
  });
  return { open: step.open, close: step.close, idle: step.idle };
}
