import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriverReservationDto, QueueSseEvent } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { createAnnFixture, loginClient, type AnnFixture } from './helpers/announcements-fixtures';
import { addHallDay, createAnnouncement, createManyDrivers } from './helpers/queue-world';
import { QUEUE_EVENT_CHANNEL } from '../src/modules/realtime/realtime.publisher';

let t: TestApp;
let fx: AnnFixture;
let server: Server;
let sub: Redis;
const received: QueueSseEvent[] = [];
const MIN = 60_000;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createAnnFixture(t);
  server = t.app.getHttpServer() as Server;
  sub = t.redis.client.duplicate();
  sub.on('message', (_channel: string, message: string) => {
    try {
      received.push(JSON.parse(message) as QueueSseEvent);
    } catch {
      // ignore
    }
  });
  await sub.subscribe(QUEUE_EVENT_CHANNEL);
});

afterAll(async () => {
  sub?.disconnect();
  await fx?.dispose();
  await t?.close();
});

async function waitFor(predicate: (e: QueueSseEvent) => boolean): Promise<QueueSseEvent> {
  for (let i = 0; i < 120; i += 1) {
    const idx = received.findIndex(predicate);
    if (idx >= 0) return received.splice(idx, 1)[0]!;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`event timeout; got ${JSON.stringify(received)}`);
}

describe('SSE queue events', () => {
  it('publishes unit.reserved after commit and unit.freed after a cancel approval', async () => {
    const base = t.clock.now();
    const bagHall = await t.prisma.hall.create({ data: { tenantId: fx.tenantId, title: 'سالن SSE', category: 'BAG', defaultAllocation: 'FREE' } });
    const day = await addHallDay(t, fx, bagHall.id, { t0At: new Date(base.getTime() - MIN), priorityEndAt: null, hallEndAt: new Date(base.getTime() + 8 * 60 * MIN) });
    const ann = await createAnnouncement(t, fx, { hallId: bagHall.id, hallDayId: day.id, allocation: 'FREE', units: 1 });
    const [d] = await createManyDrivers(t, fx, 1);
    const client = await loginClient(server, d!.mobile);
    const reserved = await client.post('/driver/reservations', { announcementId: ann.id, idempotencyKey: randomUUID() });
    expect(reserved.status).toBe(201);
    const reservation = reserved.body as DriverReservationDto;

    const ev = await waitFor((e) => e.type === 'unit.reserved' && e.tenantId === fx.tenantId && e.payload.unitId === reservation.unitId);
    expect(ev.hallId).toBe(bagHall.id);
    expect(ev.payload.announcementId).toBe(ann.id);
    expect(ev.payload.carrierId).toBe(fx.carrierId);

    const carrier = await loginClient(server, fx.carrierOp.username);
    await client.post(`/driver/reservations/${reservation.id}/cancel-request`, { reason: 'لغو' });
    const cr = (await carrier.get('/carrier/cancel-requests?status=PENDING')).body as { id: string; reservation: { id: string } }[];
    const mine = cr.find((x) => x.reservation.id === reservation.id)!;
    const approve = await carrier.post(`/carrier/cancel-requests/${mine.id}/approve`, {});
    expect(approve.status).toBe(200);
    const freed = await waitFor((e) => e.type === 'unit.freed' && e.tenantId === fx.tenantId && e.payload.unitId === reservation.unitId);
    expect(freed.hallId).toBe(bagHall.id);
  });
});
