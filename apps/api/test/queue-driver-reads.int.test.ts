import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriverBulkStateDto, DriverLoadCityDto, DriverLoadDto, DriverQueueHallsDto, DriverReservationDto } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { createAnnFixture, loginClient, type AnnFixture, type Client } from './helpers/announcements-fixtures';
import { addHallDay, createAnnouncement, createGroup, createManyDrivers } from './helpers/queue-world';

let t: TestApp;
let fx: AnnFixture;
let server: Server;
let client: Client;
let driver: { driverId: string; mobile: string };
let freeAnnId: string;
let timedUnitId: string;
const MIN = 60_000;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createAnnFixture(t);
  server = t.app.getHttpServer() as Server;
  const base = t.clock.now();
  const [d] = await createManyDrivers(t, fx, 1);
  driver = d!;
  client = await loginClient(server, d!.mobile);

  // BAG hall today: one FREE announcement (2 units) + one TIMED announcement.
  const bagDay = await addHallDay(t, fx, fx.bagHallId, {
    t0At: new Date(base.getTime() - MIN),
    priorityEndAt: new Date(base.getTime() + 30 * MIN),
    hallEndAt: new Date(base.getTime() + 8 * 60 * MIN),
  });
  const free = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: bagDay.id, allocation: 'FREE', units: 2 });
  freeAnnId = free.id;
  const timed = await createAnnouncement(t, fx, { hallId: fx.bagHallId, hallDayId: bagDay.id, allocation: 'TIMED', units: 1, description: 'timed' });
  timedUnitId = (await t.prisma.loadUnit.findFirstOrThrow({ where: { announcementId: timed.id } })).id;

  // BULK hall today: a GROUP announcement + a group containing the driver.
  const bulkDay = await addHallDay(t, fx, fx.bulkHallId, {
    t0At: new Date(base.getTime() - MIN),
    priorityEndAt: null,
    hallEndAt: new Date(base.getTime() + 8 * 60 * MIN),
  });
  await createAnnouncement(t, fx, { hallId: fx.bulkHallId, hallDayId: bulkDay.id, allocation: 'GROUP', units: 3 });
  await createGroup(t, fx, fx.bulkHallId, 'گروه راننده', 0, [driver.driverId]);
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

describe('driver queue reads', () => {
  it('lists today halls, cities, loads and detail; exposes bulk state', async () => {
    const halls = (await client.get('/driver/queue/halls')).body as DriverQueueHallsDto;
    expect(halls.halls.map((h) => h.category).sort()).toEqual(['BAG', 'BULK']);
    expect(halls.halls.every((h) => h.day !== null)).toBe(true);

    const cities = (await client.get('/driver/loads/cities?hallCategory=BAG')).body as DriverLoadCityDto[];
    expect(cities.some((c) => c.total >= 1 && c.open >= 1)).toBe(true);

    const loads = (await client.get('/driver/loads?hallCategory=BAG')).body as DriverLoadDto[];
    const free = loads.find((l) => l.id === freeAnnId)!;
    expect(free).toBeTruthy();
    expect(free.allocation).toBe('FREE');
    expect(free.openUnits).toBe(2);
    expect(free.isReservable).toBe(true);
    expect(free.blockReason).toBeNull();

    const detail = (await client.get(`/driver/loads/${freeAnnId}`)).body as DriverLoadDto;
    expect(detail.units?.length).toBe(2);

    const bulk = (await client.get('/driver/bulk')).body as DriverBulkStateDto;
    expect(bulk.hall?.id).toBe(fx.bulkHallId);
    expect(bulk.myGroup?.id).toBeTruthy();
    expect(bulk.window?.isMine).toBe(true);
    expect(bulk.canReserveNow).toBe(true);
  });

  it('reserves idempotently, enforces the free cap and rejects a direct TIMED reservation', async () => {
    const key = randomUUID();
    const first = await client.post('/driver/reservations', { announcementId: freeAnnId, idempotencyKey: key });
    expect(first.status).toBe(201);
    const r1 = first.body as DriverReservationDto;
    const retry = await client.post('/driver/reservations', { announcementId: freeAnnId, idempotencyKey: key });
    expect(retry.body).toMatchObject({ id: r1.id });
    expect(await t.prisma.reservation.count({ where: { driverId: driver.driverId } })).toBe(1);

    const active = (await client.get('/driver/reservations?view=active')).body as DriverReservationDto[];
    expect(active.map((r) => r.id)).toContain(r1.id);

    const history = (await client.get('/driver/history')).body as { reservations: DriverReservationDto[] };
    expect(history.reservations.map((r) => r.id)).toContain(r1.id);

    // A second FREE unit hits the default maxActiveFreeReservations = 1.
    const cap = await client.post('/driver/reservations', { announcementId: freeAnnId, idempotencyKey: randomUUID() });
    expect(cap.status).toBe(403);
    expect(cap.body.error.code).toBe('ACTIVE_FREE_LIMIT');

    // Direct reservation of a TIMED unit is not allowed.
    const timed = await client.post('/driver/reservations', { unitId: timedUnitId, idempotencyKey: randomUUID() });
    expect(timed.status).toBe(403);
    expect(timed.body.error.code).toBe('WINDOW_CLOSED');
  });
});
