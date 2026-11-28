import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { timedPolicyParams, type BagHallDto } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { createAnnFixture, loginClient, type AnnFixture } from './helpers/announcements-fixtures';
import { addHallDay, createAnnouncement, createManyDrivers, runAllocation } from './helpers/queue-world';
import { DriverQueueService } from '../src/modules/queue/driver-queue.service';

let t: TestApp;
let server: Server;
let queue: DriverQueueService;
const worlds: AnnFixture[] = [];

const MIN = 60_000;

beforeAll(async () => {
  t = await createTestApp();
  server = t.app.getHttpServer() as Server;
  queue = t.app.get(DriverQueueService);
});

afterAll(async () => {
  for (const w of worlds) await w.dispose();
  await t?.close();
});

/** A fresh tenant per scenario so only one BAG hall has a day "today" (unambiguous selection). */
async function freshWorld(): Promise<AnnFixture> {
  const fx = await createAnnFixture(t);
  worlds.push(fx);
  return fx;
}

function base() {
  return t.clock.now();
}

describe('bag turn registration', () => {
  it('rejects before T0, allows once inside the window, then TURN_EXISTS', async () => {
    const fx = await freshWorld();
    const b = base();
    const day = await addHallDay(t, fx, fx.bagHallId, {
      t0At: new Date(b.getTime() + 10 * MIN),
      priorityEndAt: new Date(b.getTime() + 40 * MIN),
      hallEndAt: new Date(b.getTime() + 8 * 60 * MIN),
    });
    const [drv] = await createManyDrivers(t, fx, 1);
    const client = await loginClient(server, drv!.mobile);

    const early = await client.post('/driver/bag/turn', {});
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('HALL_NOT_OPEN');

    await t.prisma.hallDay.update({
      where: { id: day.id },
      data: { t0At: new Date(b.getTime() - MIN), priorityEndAt: new Date(b.getTime() + 30 * MIN) },
    });

    const ok = await client.post('/driver/bag/turn', {});
    expect(ok.status).toBe(200);
    expect((ok.body as { turn: { turnNo: number } }).turn.turnNo).toBe(1);

    const again = await client.post('/driver/bag/turn', {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TURN_EXISTS');

    const body = (await client.get('/driver/bag')).body as BagHallDto;
    expect(body.canRegister).toBe(false);
    expect(body.registerBlock).toBe('TURN_EXISTS');
    expect(body.canSetPriorities).toBe(true);
    expect(body.turn?.turnNo).toBe(1);
  });
});

describe('bag turn concurrency (AC-2)', () => {
  it('200 concurrent registrations get unique contiguous turn numbers', async () => {
    const fx = await freshWorld();
    const b = base();
    const day = await addHallDay(t, fx, fx.bagHallId, {
      t0At: new Date(b.getTime() - 5 * MIN),
      priorityEndAt: new Date(b.getTime() + 30 * MIN),
      hallEndAt: new Date(b.getTime() + 8 * 60 * MIN),
    });
    const drivers = await createManyDrivers(t, fx, 200);
    const results = await Promise.all(drivers.map((d) => queue.registerTurn(d.user)));
    const numbers = results.map((r) => r.turn.turnNo).sort((a, b) => a - b);
    expect(numbers).toHaveLength(200);
    expect(new Set(numbers).size).toBe(200);
    expect(numbers[0]).toBe(1);
    expect(numbers[199]).toBe(200);
    expect(await t.prisma.bagTurn.count({ where: { hallDayId: day.id } })).toBe(200);
  });
});

describe('bag priorities validation', () => {
  it('rejects loader mismatch, more than three, and the closed window', async () => {
    const fx = await freshWorld();
    const b = base();
    const day = await addHallDay(t, fx, fx.bagHallId, {
      t0At: new Date(b.getTime() - 5 * MIN),
      priorityEndAt: new Date(b.getTime() + 30 * MIN),
      hallEndAt: new Date(b.getTime() + 8 * 60 * MIN),
    });
    const [drv] = await createManyDrivers(t, fx, 1);
    const client = await loginClient(server, drv!.mobile);
    await client.post('/driver/bag/turn', {});

    const okAnn = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: day.id, allocation: 'TIMED', units: 1 });
    const otherLoader = await t.prisma.loaderType.create({ data: { tenantId: fx.tenantId, code: `OTH_${randomUUID().slice(0, 6)}`, title: 'کمپرسی' } });
    const mismatchAnn = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: day.id, allocation: 'TIMED', units: 1, loaderTypeId: otherLoader.id });

    const good = await client.put('/driver/bag/priorities', { announcementIds: [okAnn.id] });
    expect(good.status).toBe(200);
    expect((good.body as { priorities: { rank: number }[] }).priorities[0]?.rank).toBe(1);

    const mismatch = await client.put('/driver/bag/priorities', { announcementIds: [mismatchAnn.id] });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('LOADER_MISMATCH');

    const tooMany = await client.put('/driver/bag/priorities', {
      announcementIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    });
    expect(tooMany.status).toBe(400);

    // Close the window relative to the server clock (do not advance FakeClock: it would expire the JWT).
    await t.prisma.hallDay.update({ where: { id: day.id }, data: { priorityEndAt: new Date(base().getTime() - 1) } });
    const closed = await client.put('/driver/bag/priorities', { announcementIds: [okAnn.id] });
    expect(closed.status).toBe(403);
    expect(closed.body.error.code).toBe('PRIORITY_WINDOW_CLOSED');
  });
});

describe('bag allocation', () => {
  it('allocates by turn order and priorities, idempotently, and keeps leftovers (KEEP)', async () => {
    const fx = await freshWorld();
    const b = base();
    const day = await addHallDay(t, fx, fx.bagHallId, {
      t0At: new Date(b.getTime() - 5 * MIN),
      priorityEndAt: new Date(b.getTime() + 20 * MIN),
      hallEndAt: new Date(b.getTime() + 8 * 60 * MIN),
    });
    const annA = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: day.id, allocation: 'TIMED', units: 1, description: 'A' });
    const annB = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: day.id, allocation: 'TIMED', units: 1, description: 'B' });
    const annC = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: day.id, allocation: 'TIMED', units: 1, description: 'leftover' });

    const [c, d, e] = await createManyDrivers(t, fx, 3);
    const clientC = await loginClient(server, c!.mobile);
    const clientD = await loginClient(server, d!.mobile);
    const clientE = await loginClient(server, e!.mobile);
    await clientC.post('/driver/bag/turn', {}); // turn 1
    await clientD.post('/driver/bag/turn', {}); // turn 2
    await clientE.post('/driver/bag/turn', {}); // turn 3
    await clientC.put('/driver/bag/priorities', { announcementIds: [annA.id] });
    await clientD.put('/driver/bag/priorities', { announcementIds: [annA.id, annB.id] });

    await runAllocation(t, day.id, day.priorityEndAt!);

    const turns = await t.prisma.bagTurn.findMany({ where: { hallDayId: day.id }, orderBy: { turnNo: 'asc' } });
    expect(turns.map((x) => x.status)).toEqual(['ALLOCATED', 'ALLOCATED', 'NOT_ALLOCATED']);
    const resC = await t.prisma.reservation.findFirst({ where: { driverId: c!.driverId, hallDayId: day.id } });
    const resD = await t.prisma.reservation.findFirst({ where: { driverId: d!.driverId, hallDayId: day.id } });
    expect(resC?.unitId).toBe((await t.prisma.loadUnit.findFirst({ where: { announcementId: annA.id } }))!.id);
    expect(resD?.unitId).toBe((await t.prisma.loadUnit.findFirst({ where: { announcementId: annB.id } }))!.id);
    expect(resC?.source).toBe('TIMED');

    await runAllocation(t, day.id, day.priorityEndAt!);
    expect(await t.prisma.allocationRun.count({ where: { hallDayId: day.id } })).toBe(1);
    expect(await t.prisma.reservation.count({ where: { hallDayId: day.id } })).toBe(2);

    const leftover = await t.prisma.loadUnit.findFirstOrThrow({ where: { announcementId: annC.id } });
    expect(leftover.state).toBe('OPEN');
    expect(leftover.allocation).toBe('TIMED');
  });

  it('AUTO_FREE converts leftover TIMED units to FREE', async () => {
    const fx = await freshWorld();
    const b = base();
    await t.prisma.queuePolicy.create({
      data: { tenantId: fx.tenantId, hallId: fx.bagHallId, strategy: 'TIMED_PRIORITY_RESERVATION', version: 1, params: timedPolicyParams.parse({ leftoverAfterAllocation: 'AUTO_FREE' }), activeFrom: b },
    });
    const day = await addHallDay(t, fx, fx.bagHallId, {
      t0At: new Date(b.getTime() - 5 * MIN),
      priorityEndAt: new Date(b.getTime() + 20 * MIN),
      hallEndAt: new Date(b.getTime() + 8 * 60 * MIN),
    });
    const ann = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: day.id, allocation: 'TIMED', units: 2, description: 'auto-free' });
    const [drv] = await createManyDrivers(t, fx, 1);
    const client = await loginClient(server, drv!.mobile);
    await client.post('/driver/bag/turn', {});
    await client.put('/driver/bag/priorities', { announcementIds: [ann.id] });

    await runAllocation(t, day.id, day.priorityEndAt!);
    const units = await t.prisma.loadUnit.findMany({ where: { announcementId: ann.id }, orderBy: { seq: 'asc' } });
    expect(units.map((u) => u.allocation)).toEqual(['TIMED', 'FREE']);
    expect(units.map((u) => u.state)).toEqual(['RESERVED', 'OPEN']);
    expect(await t.prisma.loadUnitAllocationChange.count({ where: { unitId: units[1]!.id, from: 'TIMED', to: 'FREE' } })).toBe(1);
    expect(await t.prisma.queueEvent.count({ where: { tenantId: fx.tenantId, type: 'UNIT_FREED', payload: { path: ['unitId'], equals: units[1]!.id } } })).toBe(1);
  });
});
