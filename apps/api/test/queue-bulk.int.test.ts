import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BulkWindow } from '@prisma/client';
import { addDaysIso, localDate } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { createAnnFixture, loginClient, type AnnFixture } from './helpers/announcements-fixtures';
import { addHallDay, advanceBulk, createAnnouncement, createGroup, createManyDrivers, todayIso, type CreatedDriver } from './helpers/queue-world';

let t: TestApp;
let fx: AnnFixture;
let server: Server;
let drivers: CreatedDriver[] = [];
let hallId: string;
let groupIds: string[] = [];

const MIN = 60_000;
const HOUR = 60 * MIN;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createAnnFixture(t);
  server = t.app.getHttpServer() as Server;
  hallId = fx.bulkHallId;
  drivers = await createManyDrivers(t, fx, 120);
  groupIds = [];
  for (let g = 0; g < 20; g += 1) {
    const members = drivers.slice(g * 6, g * 6 + 6).map((d) => d.driverId);
    const grp = await createGroup(t, fx, hallId, `گروه ${g + 1}`, g, members);
    groupIds.push(grp.id);
  }
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

async function nextPermits(count: number): Promise<number[]> {
  if (count <= 0) return [];
  const c = await t.prisma.counter.upsert({
    where: { tenantId_name: { tenantId: fx.tenantId, name: 'permit' } },
    create: { tenantId: fx.tenantId, name: 'permit', value: count },
    update: { value: { increment: count } },
  });
  const end = c.value;
  return Array.from({ length: count }, (_, i) => end - count + 1 + i);
}

async function countOpenGroupUnits(tenantId: string, carrierId: string, hall: string): Promise<number> {
  return t.prisma.loadUnit.count({
    where: { allocation: 'GROUP', state: 'OPEN', tenantId, announcement: { is: { carrierId, hallId: hall, status: 'ACTIVE', deletedAt: null } } },
  });
}

async function reserveWindow(tenantId: string, carrierId: string, hall: string, hallDayId: string, open: BulkWindow, take: string[]): Promise<void> {
  const units = await t.prisma.loadUnit.findMany({
    where: { allocation: 'GROUP', state: 'OPEN', tenantId, announcement: { is: { carrierId, hallId: hall, status: 'ACTIVE', deletedAt: null } } },
    orderBy: { seq: 'asc' },
    take: take.length,
  });
  const permits = await nextPermits(take.length);
  for (const [i, driverId] of take.entries()) {
    const unit = units[i]!;
    const r = await t.prisma.reservation.create({
      data: {
        tenantId,
        permitNo: permits[i]!,
        unitId: unit.id,
        driverId,
        carrierId,
        source: 'GROUP',
        hallDayId,
        bulkWindowId: open.id,
        status: 'RESERVED',
        reservedAt: t.clock.now(),
      },
    });
    await t.prisma.loadUnit.update({ where: { id: unit.id }, data: { state: 'RESERVED', currentReservationId: r.id, version: { increment: 1 } } });
  }
}

/** Mirrors the harness: open→every eligible driver reserves→close→next, until the state machine idles. */
async function simulateDay(dayId: string): Promise<void> {
  const tenantId = fx.tenantId;
  const carrierId = fx.carrierId;
  for (let guard = 0; guard < 400; guard += 1) {
    await advanceBulk(t, carrierId, dayId, t.clock.now());
    const bulkDay = await t.prisma.bulkDay.findUnique({ where: { carrierId_hallDayId: { carrierId, hallDayId: dayId } } });
    if (!bulkDay) return;
    const open = await t.prisma.bulkWindow.findFirst({ where: { bulkDayId: bulkDay.id, closedAt: null }, orderBy: { seq: 'desc' } });
    if (!open) return;
    const openUnits = await countOpenGroupUnits(tenantId, carrierId, hallId);
    if (openUnits <= 0) continue;
    const take = open.eligible.slice(0, openUnits);
    if (take.length === 0) continue;
    await reserveWindow(tenantId, carrierId, hallId, dayId, open, take);
  }
  throw new Error('simulation did not settle');
}

async function newBulkDay(t0: Date, units: number): Promise<{ dayId: string; t0: Date }> {
  const date = localDate(t0);
  const day = await addHallDay(t, fx, hallId, { t0At: t0, priorityEndAt: null, hallEndAt: new Date(t0.getTime() + 8 * HOUR) }, date);
  await createAnnouncement(t, fx, { hallId, hallDayId: day.id, allocation: 'GROUP', units, description: `day ${date}` });
  return { dayId: day.id, t0 };
}

async function closeDay(dayId: string, t0: Date): Promise<void> {
  t.clock.set(new Date(t0.getTime() + 8 * HOUR));
  await advanceBulk(t, fx.carrierId, dayId, t.clock.now());
}

async function cursorOf(dayId: string) {
  const bulkDay = await t.prisma.bulkDay.findUniqueOrThrow({ where: { carrierId_hallDayId: { carrierId: fx.carrierId, hallDayId: dayId } } });
  const rotation = await t.prisma.bulkRotationState.findUniqueOrThrow({ where: { carrierId_hallId: { carrierId: fx.carrierId, hallId } } });
  return { bulkDay, rotation };
}

describe('bulk reference scenario (20 groups × 6 drivers)', () => {
  it('reproduces days 1/2/3 and the overflow day, persisting windows and cursor (AC-4/AC-5)', async () => {
    const base = t.clock.now();
    // Day 1: 48 loads, head = group 1 (initialised), cursor → group 9.
    const d1 = await newBulkDay(base, 48);
    t.clock.set(d1.t0);
    await simulateDay(d1.dayId);
    await closeDay(d1.dayId, d1.t0);
    let c = await cursorOf(d1.dayId);
    expect(c.bulkDay.status).toBe('CLOSED');
    expect(c.rotation.cursorGroupId).toBe(groupIds[8]); // group 9
    expect(c.rotation.cursorRemaining).toHaveLength(6);
    expect(c.rotation.nextHeadGroupId).toBe(groupIds[1]); // group 2
    expect(await t.prisma.bulkWindow.count({ where: { bulkDayId: c.bulkDay.id } })).toBe(8); // head + 7 free

    // Day 2: 43 loads, head = group 2, cursor → group 15 with 5 remaining.
    const d2 = await newBulkDay(new Date(d1.t0.getTime() + 24 * HOUR), 43);
    t.clock.set(d2.t0);
    await simulateDay(d2.dayId);
    await closeDay(d2.dayId, d2.t0);
    c = await cursorOf(d2.dayId);
    expect(c.bulkDay.headGroupId).toBe(groupIds[1]);
    expect(c.rotation.cursorGroupId).toBe(groupIds[14]); // group 15
    expect(c.rotation.cursorRemaining).toHaveLength(5);
    expect(c.rotation.nextHeadGroupId).toBe(groupIds[2]);

    // Day 3: 41 loads, head = group 3, cursor wraps to group 1.
    const d3 = await newBulkDay(new Date(d2.t0.getTime() + 24 * HOUR), 41);
    t.clock.set(d3.t0);
    await simulateDay(d3.dayId);
    await closeDay(d3.dayId, d3.t0);
    c = await cursorOf(d3.dayId);
    expect(c.bulkDay.headGroupId).toBe(groupIds[2]);
    expect(c.rotation.cursorGroupId).toBe(groupIds[0]); // group 1
    expect(c.rotation.cursorRemaining).toHaveLength(6);
    expect(c.rotation.nextHeadGroupId).toBe(groupIds[3]);

    // Overflow day (standalone): head group 1, cursor group 2, 130 loads / 120 drivers.
    const rotation = await t.prisma.bulkRotationState.findUniqueOrThrow({ where: { carrierId_hallId: { carrierId: fx.carrierId, hallId } } });
    const group2Members = drivers.slice(6, 12).map((d) => d.driverId);
    await t.prisma.bulkRotationState.update({
      where: { id: rotation.id },
      data: { nextHeadGroupId: groupIds[0], cursorGroupId: groupIds[1], cursorRemaining: group2Members, cursorInitialized: true },
    });
    const d4 = await newBulkDay(new Date(d3.t0.getTime() + 24 * HOUR), 130);
    t.clock.set(d4.t0);
    await simulateDay(d4.dayId);
    await closeDay(d4.dayId, d4.t0);
    c = await cursorOf(d4.dayId);
    expect(c.bulkDay.headGroupId).toBe(groupIds[0]);
    expect(c.rotation.nextHeadGroupId).toBe(groupIds[1]);
    expect(c.rotation.cursorGroupId).toBe(groupIds[2]); // group 3
    expect(c.rotation.cursorRemaining).toHaveLength(2); // 4 took loads, 2 remain
    expect(await t.prisma.reservation.count({ where: { tenantId: fx.tenantId, source: 'GROUP' } })).toBe(48 + 43 + 41 + 130);
  });

  it('advancing twice at the same instant creates no duplicate window and the cursor is stable (AC-5)', async () => {
    const t0 = new Date(t.clock.now().getTime() + 5 * 24 * HOUR);
    const day = await addHallDay(t, fx, hallId, { t0At: t0, priorityEndAt: null, hallEndAt: new Date(t0.getTime() + 8 * HOUR) }, localDate(t0));
    await createAnnouncement(t, fx, { hallId, hallDayId: day.id, allocation: 'GROUP', units: 5, description: 'idem' });
    t.clock.set(t0);
    await advanceBulk(t, fx.carrierId, day.id, t.clock.now());
    const bulkDay = await t.prisma.bulkDay.findUniqueOrThrow({ where: { carrierId_hallDayId: { carrierId: fx.carrierId, hallDayId: day.id } } });
    const before = await t.prisma.bulkWindow.count({ where: { bulkDayId: bulkDay.id } });
    await advanceBulk(t, fx.carrierId, day.id, t.clock.now());
    await advanceBulk(t, fx.carrierId, day.id, t.clock.now());
    expect(await t.prisma.bulkWindow.count({ where: { bulkDayId: bulkDay.id } })).toBe(before);
  });
});

describe('bulk reservation guards', () => {
  it('a GROUP unit published after the window closed leaves members skipped, not burned', async () => {
    const base = t.clock.now();
    const t0 = new Date(base.getTime() + 24 * HOUR);
    // Dedicated hall so no OPEN unit from other scenarios pollutes the compatibility count.
    const burnHall = await t.prisma.hall.create({ data: { tenantId: fx.tenantId, title: 'سالن سوخت آزمون', category: 'BULK', defaultAllocation: 'GROUP' } });
    const members = await createManyDrivers(t, fx, 6);
    const headGroup = await createGroup(t, fx, burnHall.id, 'سرنوبت سوخت', 0, members.map((d) => d.driverId));
    await t.prisma.bulkRotationState.upsert({
      where: { carrierId_hallId: { carrierId: fx.carrierId, hallId: burnHall.id } },
      create: { tenantId: fx.tenantId, carrierId: fx.carrierId, hallId: burnHall.id, cursorRemaining: [], nextHeadGroupId: headGroup.id },
      update: { nextHeadGroupId: headGroup.id },
    });
    const day = await addHallDay(t, fx, burnHall.id, { t0At: t0, priorityEndAt: null, hallEndAt: new Date(t0.getTime() + 8 * HOUR) }, localDate(t0));
    // No loads at T0; the unit is published at T0+20m (after the 10m head window).
    t.clock.set(new Date(t0.getTime() + 20 * MIN));
    const ann = await createAnnouncement(t, fx, { hallId: burnHall.id, hallDayId: day.id, allocation: 'GROUP', units: 1, description: 'late' });
    const late = new Date(t0.getTime() + 20 * MIN);
    await t.prisma.loadUnit.updateMany({ where: { announcementId: ann.id }, data: { createdAt: late } });
    const lateUnit = await t.prisma.loadUnit.findFirstOrThrow({ where: { announcementId: ann.id } });
    expect(lateUnit.createdAt.getTime()).toBe(late.getTime());
    await advanceBulk(t, fx.carrierId, day.id, t.clock.now());
    const bulkDay = await t.prisma.bulkDay.findUniqueOrThrow({ where: { carrierId_hallDayId: { carrierId: fx.carrierId, hallDayId: day.id } } });
    const head = await t.prisma.bulkWindow.findFirstOrThrow({ where: { bulkDayId: bulkDay.id, kind: 'HEAD' } });
    expect(head.closeReason).toBe('TIME');
    expect(head.burned).toEqual([]);
    expect(head.skipped.sort()).toEqual(head.eligible.sort());
  });

  it('rejects reservation before T0 with WINDOW_CLOSED', async () => {
    const base = t.clock.now();
    const t0 = new Date(base.getTime() + 60 * MIN);
    const day = await addHallDay(t, fx, hallId, { t0At: t0, priorityEndAt: null, hallEndAt: new Date(t0.getTime() + 8 * HOUR) }, addDaysIso(todayIso(t), 30));
    const ann = await createAnnouncement(t, fx, { hallId, hallDayId: day.id, allocation: 'GROUP', units: 2, description: 'future' });
    const drv = drivers[0]!;
    const client = await loginClient(server, drv.mobile);
    const res = await client.post('/driver/reservations', { announcementId: ann.id, idempotencyKey: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WINDOW_CLOSED');
  });

  it('rejects a driver without a group with NOT_IN_GROUP while a window is open', async () => {
    const base = t.clock.now();
    const day = await addHallDay(t, fx, hallId, { t0At: new Date(base.getTime() - MIN), priorityEndAt: null, hallEndAt: new Date(base.getTime() + 8 * HOUR) }, addDaysIso(todayIso(t), 31));
    const ann = await createAnnouncement(t, fx, { hallId, hallDayId: day.id, allocation: 'GROUP', units: 3, description: 'nogroup' });
    // Open a window for the (existing) head group so a window exists.
    await advanceBulk(t, fx.carrierId, day.id, t.clock.now());
    // A fresh driver that belongs to no group.
    const [outsider] = await createManyDrivers(t, fx, 1);
    const client = await loginClient(server, outsider!.mobile);
    const res = await client.post('/driver/reservations', { announcementId: ann.id, idempotencyKey: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_IN_GROUP');
  });

  it('rejects loader mismatch on a direct unit reservation (AC-1)', async () => {
    const base = t.clock.now();
    const bagHall = await t.prisma.hall.create({ data: { tenantId: fx.tenantId, title: 'سالن آزاد آزمون', category: 'BAG', defaultAllocation: 'FREE' } });
    const day = await addHallDay(t, fx, bagHall.id, { t0At: new Date(base.getTime() - MIN), priorityEndAt: null, hallEndAt: new Date(base.getTime() + 8 * HOUR) });
    const otherLoader = await t.prisma.loaderType.create({ data: { tenantId: fx.tenantId, code: `MM_${randomUUID().slice(0, 6)}`, title: 'بنکر دیگر' } });
    const ann = await createAnnouncement(t, fx, { hallId: bagHall.id, hallDayId: day.id, allocation: 'FREE', units: 1, loaderTypeId: otherLoader.id, description: 'mismatch' });
    const unit = await t.prisma.loadUnit.findFirstOrThrow({ where: { announcementId: ann.id } });
    const drv = drivers[1]!;
    const client = await loginClient(server, drv.mobile);
    const res = await client.post('/driver/reservations', { unitId: unit.id, idempotencyKey: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOADER_MISMATCH');
  });

  it('50 concurrent reservations for one FREE unit → exactly one success, the rest 409 (AC-6)', async () => {
    const base = t.clock.now();
    const hall = await t.prisma.hall.create({ data: { tenantId: fx.tenantId, title: 'سالن رقابتی', category: 'BAG', defaultAllocation: 'FREE' } });
    const day = await addHallDay(t, fx, hall.id, { t0At: new Date(base.getTime() - MIN), priorityEndAt: null, hallEndAt: new Date(base.getTime() + 8 * HOUR) });
    const ann = await createAnnouncement(t, fx, { hallId: hall.id, hallDayId: day.id, allocation: 'FREE', units: 1, description: 'race' });
    const contenders = drivers.slice(60, 110);
    const clients = await Promise.all(contenders.map((d) => loginClient(server, d.mobile)));
    const results = await Promise.all(
      clients.map((c) => c.post('/driver/reservations', { announcementId: ann.id, idempotencyKey: randomUUID() })),
    );
    const ok = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(49);
    expect(await t.prisma.reservation.count({ where: { unit: { announcementId: ann.id }, status: { not: 'CANCELLED' } } })).toBe(1);
  });
});
