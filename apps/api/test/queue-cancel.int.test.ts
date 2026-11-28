import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriverReservationDto } from '@cb/shared';
import { addDaysIso } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { createAnnFixture, loginClient, type AnnFixture, type Client } from './helpers/announcements-fixtures';
import { addHallDay, createAnnouncement, createManyDrivers, todayIso } from './helpers/queue-world';

let t: TestApp;
let fx: AnnFixture;
let server: Server;
let carrier: Client;
let carrierB: Client;
let hallId: string;
const MIN = 60_000;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createAnnFixture(t);
  server = t.app.getHttpServer() as Server;
  carrier = await loginClient(server, fx.carrierOp.username);
  carrierB = await loginClient(server, fx.carrierB.username);
  const bagHall = await t.prisma.hall.create({ data: { tenantId: fx.tenantId, title: 'سالن لغو', category: 'BAG', defaultAllocation: 'FREE' } });
  hallId = bagHall.id;
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

async function setupDriver(): Promise<{ client: Client; driverId: string }> {
  const [d] = await createManyDrivers(t, fx, 1);
  const client = await loginClient(server, d!.mobile);
  return { client, driverId: d!.driverId };
}

let daySeq = 0;
async function newFreeDay(): Promise<{ dayId: string; announcementId: string; unitId: string }> {
  const base = t.clock.now();
  daySeq += 1;
  const day = await addHallDay(
    t,
    fx,
    hallId,
    {
      t0At: new Date(base.getTime() - MIN),
      priorityEndAt: null,
      hallEndAt: new Date(base.getTime() + 8 * 60 * MIN),
    },
    addDaysIso(todayIso(t), 100 + daySeq),
  );
  const ann = await createAnnouncement(t, fx, { hallId, hallDayId: day.id, allocation: 'FREE', units: 1 });
  const unit = await t.prisma.loadUnit.findFirstOrThrow({ where: { announcementId: ann.id } });
  return { dayId: day.id, announcementId: ann.id, unitId: unit.id };
}

async function reserve(client: Client, announcementId: string): Promise<DriverReservationDto> {
  const res = await client.post('/driver/reservations', { announcementId, idempotencyKey: randomUUID() });
  if (res.status !== 201) throw new Error(`reserve failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as DriverReservationDto;
}

describe('cancel request lifecycle (AC-8)', () => {
  it('keeps the reservation until approval, then returns the unit to its allocation and adds a 24h penalty', async () => {
    const { announcementId, unitId } = await newFreeDay();
    const { client, driverId } = await setupDriver();
    const reservation = await reserve(client, announcementId);
    expect(reservation.source).toBe('FREE');

    const req = await client.post(`/driver/reservations/${reservation.id}/cancel-request`, { reason: 'نمی‌توانم بیایم' });
    expect(req.status).toBe(200);
    expect((req.body as DriverReservationDto).status).toBe('CANCEL_REQUESTED');

    // Until approval the unit stays RESERVED and the reservation is active.
    expect((await t.prisma.loadUnit.findUniqueOrThrow({ where: { id: unitId } })).state).toBe('RESERVED');
    expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe('CANCEL_REQUESTED');

    // A second request is rejected by the partial unique index.
    const dup = await client.post(`/driver/reservations/${reservation.id}/cancel-request`, { reason: 'دوباره' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CANCEL_PENDING');

    const list = await carrier.get('/carrier/cancel-requests?status=PENDING');
    const cr = (list.body as { id: string; reservation: { id: string } }[]).find((x) => x.reservation.id === reservation.id);
    expect(cr).toBeTruthy();

    const before = t.clock.now();
    const approve = await carrier.post(`/carrier/cancel-requests/${cr!.id}/approve`, { note: 'تأیید شد' });
    expect(approve.status).toBe(200);

    const res = await t.prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(res.status).toBe('CANCELLED');
    expect(res.cancelledAt).not.toBeNull();
    const unit = await t.prisma.loadUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.state).toBe('OPEN');
    expect(unit.allocation).toBe('FREE'); // allocation unchanged
    expect(unit.currentReservationId).toBeNull();

    const penalty = await t.prisma.driverPenalty.findFirstOrThrow({ where: { driverId, reason: 'CANCEL_APPROVED' } });
    const hours = (penalty.until.getTime() - before.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);

    expect(await t.prisma.queueEvent.count({ where: { tenantId: fx.tenantId, type: 'CANCEL_APPROVED', payload: { path: ['reservationId'], equals: reservation.id } } })).toBe(1);
    expect(await t.prisma.queueEvent.count({ where: { tenantId: fx.tenantId, type: 'UNIT_FREED', payload: { path: ['reservationId'], equals: reservation.id } } })).toBe(1);
  });

  it('reject restores the previous reservation status', async () => {
    const { announcementId, unitId } = await newFreeDay();
    const { client } = await setupDriver();
    const reservation = await reserve(client, announcementId);
    await client.post(`/driver/reservations/${reservation.id}/cancel-request`, { reason: 'اشتباه' });
    const cr = (await carrier.get('/carrier/cancel-requests?status=PENDING')).body as { id: string; reservation: { id: string } }[];
    const mine = cr.find((x) => x.reservation.id === reservation.id)!;
    const reject = await carrier.post(`/carrier/cancel-requests/${mine.id}/reject`, { note: 'رد شد' });
    expect(reject.status).toBe(200);
    const res = await t.prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(res.status).toBe('RESERVED');
    expect(res.statusBeforeCancelRequest).toBeNull();
    expect((await t.prisma.loadUnit.findUniqueOrThrow({ where: { id: unitId } })).state).toBe('RESERVED');
  });

  it('IDOR: another carrier cannot decide my cancel request (AC-9)', async () => {
    const { announcementId } = await newFreeDay();
    const { client } = await setupDriver();
    const reservation = await reserve(client, announcementId);
    await client.post(`/driver/reservations/${reservation.id}/cancel-request`, { reason: 'لغو' });
    const cr = (await carrier.get('/carrier/cancel-requests?status=PENDING')).body as { id: string; reservation: { id: string } }[];
    const mine = cr.find((x) => x.reservation.id === reservation.id)!;
    const foreign = await carrierB.post(`/carrier/cancel-requests/${mine.id}/approve`, {});
    expect(foreign.status).toBe(404);
    // It is still pending for the owner.
    expect((await t.prisma.cancelRequest.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('PENDING');
  });
});
