import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { createAnnFixture, loginClient, type AnnFixture } from './helpers/announcements-fixtures';
import {
  addHallDay,
  createAnnouncement,
  createGroup,
  createManyDrivers,
  type CreatedDriver,
} from './helpers/queue-world';

/**
 * Phase 3 acceptance (PLAN §P3): a full bulk day and a full bag day driven through the HTTP API,
 * plus the per-driver rate limit on the hot endpoints (SPEC §6).
 */
let t: TestApp;
let fx: AnnFixture;
let server: Server;
let drivers: CreatedDriver[] = [];
let bulkDayId = '';
let bulkAnnId = '';
const MIN = 60_000;
const HOUR = 60 * MIN;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createAnnFixture(t);
  server = t.app.getHttpServer() as Server;
  drivers = await createManyDrivers(t, fx, 4);

  const t0 = new Date(t.clock.now().getTime() - MIN);
  const day = await addHallDay(t, fx, fx.bulkHallId, {
    t0At: t0,
    priorityEndAt: null,
    hallEndAt: new Date(t0.getTime() + 8 * HOUR),
  });
  bulkDayId = day.id;
  const ann = await createAnnouncement(t, fx, { hallId: fx.bulkHallId, hallDayId: day.id, allocation: 'GROUP', units: 3 });
  bulkAnnId = ann.id;
  const head = await createGroup(t, fx, fx.bulkHallId, 'گروه سرنوبت', 0, [drivers[0]!.driverId, drivers[1]!.driverId]);
  const next = await createGroup(t, fx, fx.bulkHallId, 'گروه دوم', 1, [drivers[2]!.driverId, drivers[3]!.driverId]);
  await t.prisma.bulkRotationState.create({
    data: {
      tenantId: fx.tenantId,
      carrierId: fx.carrierId,
      hallId: fx.bulkHallId,
      nextHeadGroupId: head.id,
      cursorGroupId: next.id,
      cursorRemaining: [drivers[2]!.driverId, drivers[3]!.driverId],
      cursorInitialized: true,
      settings: { maxLoadsPerDriverPerDay: 2, leftoverAtHallEnd: 'CARRY' },
    },
  });
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

describe('P3 acceptance — full bulk day over HTTP', () => {
  it('lazy-opens the head window, reserves atomically, rotates to the next group, and cancels with a penalty', async () => {
    const head1 = drivers[0]!;
    const next1 = drivers[2]!;
    const head1Client = await loginClient(server, head1.mobile);
    const next1Client = await loginClient(server, next1.mobile);

    const state = await head1Client.get('/driver/bulk');
    expect(state.status).toBe(200);
    expect(state.body.canReserveNow).toBe(true);
    expect(state.body.window.groupId).toBe((await t.prisma.bulkGroup.findFirstOrThrow({ where: { title: 'گروه سرنوبت' } })).id);

    const key = randomUUID();
    const first = await head1Client.post('/driver/reservations', { announcementId: bulkAnnId, idempotencyKey: key });
    expect(first.status).toBe(201);
    const permitId = first.body.id as string;
    expect(first.body.source).toBe('GROUP');

    // Idempotent retry returns the same permit.
    const retry = await head1Client.post('/driver/reservations', { announcementId: bulkAnnId, idempotencyKey: key });
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(permitId);

    // A member of the next group has no business while the head window is still open.
    const outsider = await next1Client.post('/driver/reservations', { announcementId: bulkAnnId, idempotencyKey: randomUUID() });
    expect(outsider.status).toBe(403);
    expect(outsider.body.error.code).toBe('WINDOW_CLOSED');

    // Head window closes at T0+10m; the head member without a reservation burns (a compatible load
    // was available), and the free cursor moves to group 2.
    t.clock.advance(10 * MIN);
    // Access tokens live 10 minutes; refresh the session as a driver would.
    const next1Session = await loginClient(server, next1.mobile);
    const head1Session = await loginClient(server, head1.mobile);
    const carrierSession = await loginClient(server, fx.carrierOp.username);
    const nextState = await next1Session.get('/driver/bulk');
    expect(nextState.status).toBe(200);
    expect(nextState.body.canReserveNow).toBe(true);

    const second = await next1Session.post('/driver/reservations', { announcementId: bulkAnnId, idempotencyKey: randomUUID() });
    expect(second.status).toBe(201);

    // Cancel flow (BR-09/AC-8).
    const requested = await head1Session.post(`/driver/reservations/${permitId}/cancel-request`, { reason: 'تغییر برنامه بارگیری' });
    expect(requested.status).toBe(200);
    expect(requested.body.status).toBe('CANCEL_REQUESTED');
    const cancelRequests = await carrierSession.get('/carrier/cancel-requests?status=PENDING');
    expect(cancelRequests.status).toBe(200);
    const pending = (cancelRequests.body as { id: string; reservation: { id: string } }[]).find((r) => r.reservation.id === permitId);
    expect(pending).toBeTruthy();
    const approved = await carrierSession.post(`/carrier/cancel-requests/${pending!.id}/approve`, { note: 'تأیید شد' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');

    const reservation = await t.prisma.reservation.findUniqueOrThrow({ where: { id: permitId } });
    expect(reservation.status).toBe('CANCELLED');
    const unit = await t.prisma.loadUnit.findUniqueOrThrow({ where: { id: reservation.unitId } });
    expect(unit.state).toBe('OPEN');
    expect(unit.allocation).toBe('GROUP');
    const penalty = await t.prisma.driverPenalty.findFirst({
      where: { driverId: head1.driverId, reason: 'CANCEL_APPROVED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(penalty).not.toBeNull();
    expect(penalty!.until.getTime() - t.clock.now().getTime()).toBeGreaterThan(23 * HOUR);

    // A penalised driver cannot reserve again (BR-09).
    const blocked = await head1Session.post('/driver/reservations', { announcementId: bulkAnnId, idempotencyKey: randomUUID() });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('DRIVER_PENALIZED');

    // The day's windows and events are persisted.
    const bulkDay = await t.prisma.bulkDay.findFirstOrThrow({
      where: { hallDayId: bulkDayId, carrierId: fx.carrierId },
    });
    const windows = await t.prisma.bulkWindow.findMany({ where: { bulkDayId: bulkDay.id }, orderBy: { seq: 'asc' } });
    expect(windows.map((w) => w.kind)).toEqual(['HEAD', 'FREE']);
    expect(windows[0]?.closeReason).toBe('TIME');
    expect(windows[0]?.burned).toEqual([drivers[1]!.driverId]);
    const events = await t.prisma.queueEvent.findMany({
      where: { hallDayId: bulkDayId },
      orderBy: { seq: 'asc' },
      select: { type: true },
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('WINDOW_OPENED');
    expect(types).toContain('RESERVED');
    expect(types).toContain('CANCEL_APPROVED');
  });

  it('rate-limits reservations and turns per driver (5/s) with 429 RATE_LIMITED', async () => {
    // Clock is frozen by the FakeClock, so the fixed window key is stable.
    const drv = drivers[3]!;
    const client = await loginClient(server, drv.mobile);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await client.post('/driver/reservations', { announcementId: bulkAnnId, idempotencyKey: randomUUID() });
      statuses.push(res.status);
      if (res.status === 429) expect(res.body.error.code).toBe('RATE_LIMITED');
    }
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);

    const turnClient = await loginClient(server, drivers[3]!.mobile);
    const turnStatuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await turnClient.post('/driver/bag/turn', {});
      turnStatuses.push(res.status);
    }
    expect(turnStatuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(turnStatuses[5]).toBe(429);
  });
});

describe('P3 acceptance — full bag day over HTTP', () => {
  it('registers a turn, sets priorities, allocates lazily at priorityEnd, and stays idempotent', async () => {
    const now = t.clock.now();
    const t0 = new Date(now.getTime() - 5 * MIN);
    const priorityEnd = new Date(now.getTime() + 5 * MIN);
    const day = await addHallDay(t, fx, fx.bagHallId, {
      t0At: t0,
      priorityEndAt: priorityEnd,
      hallEndAt: new Date(now.getTime() + 8 * HOUR),
    });
    const ann = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: day.id, allocation: 'TIMED', units: 2 });
    const drv = drivers[1]!;
    const client = await loginClient(server, drv.mobile);

    const registered = await client.post('/driver/bag/turn', {});
    expect(registered.status).toBe(200);
    expect(registered.body.turn.turnNo).toBe(1);
    const priorities = await client.put('/driver/bag/priorities', { announcementIds: [ann.id] });
    expect(priorities.status).toBe(200);
    expect(priorities.body.priorities).toHaveLength(1);

    t.clock.set(new Date(priorityEnd.getTime() + 1000));
    const bag = await client.get('/driver/bag');
    expect(bag.status).toBe(200);
    expect(bag.body.turn.status).toBe('ALLOCATED');
    expect(bag.body.result.status).toBe('ALLOCATED');
    expect(bag.body.result.assignment.announcementId).toBe(ann.id);

    const again = await client.get('/driver/bag');
    expect(again.body.result.assignment.permitNo).toBe(bag.body.result.assignment.permitNo);
    expect(await t.prisma.allocationRun.count({ where: { hallDayId: day.id } })).toBe(1);
    const run = await t.prisma.allocationRun.findUniqueOrThrow({ where: { hallDayId: day.id } });
    expect(run.engineVersion).toMatch(/^0\.2\.0$/);
    expect(run.inputHash).toHaveLength(64);
  });
});
