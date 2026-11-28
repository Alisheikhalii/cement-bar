import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CarrierBulkGroupDto, CarrierBulkLiveDto, CarrierBulkSettingsDto, FactoryMonitorDto } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { createAnnFixture, loginClient, type AnnFixture, type Client } from './helpers/announcements-fixtures';
import { addHallDay, createAnnouncement, createManyDrivers } from './helpers/queue-world';

let t: TestApp;
let fx: AnnFixture;
let server: Server;
let carrier: Client;
let carrierB: Client;
let factory: Client;
let gA: CarrierBulkGroupDto;
let gB: CarrierBulkGroupDto;
let drivers: Awaited<ReturnType<typeof createManyDrivers>> = [];
const MIN = 60_000;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createAnnFixture(t);
  server = t.app.getHttpServer() as Server;
  carrier = await loginClient(server, fx.carrierOp.username);
  carrierB = await loginClient(server, fx.carrierB.username);
  factory = await loginClient(server, fx.factory.username);
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

describe('carrier bulk management + factory monitor', () => {
  it('creates groups, sets members, reorders, configures settings and start-head', async () => {
    const a = await carrier.post('/carrier/groups', { title: 'گروه الف' });
    const b = await carrier.post('/carrier/groups', { title: 'گروه ب' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    gA = a.body as CarrierBulkGroupDto;
    gB = b.body as CarrierBulkGroupDto;
    expect(gA.sortOrder).toBe(0);
    expect(gB.sortOrder).toBe(1);

    drivers = await createManyDrivers(t, fx, 4);
    const membersA = await carrier.put(`/carrier/groups/${gA.id}/members`, {
      driverIds: drivers.slice(0, 2).map((d) => d.driverId),
      applyNow: true,
      reason: 'آزمون',
    });
    expect(membersA.status).toBe(200);
    expect((membersA.body as CarrierBulkGroupDto).memberCount).toBe(2);
    const membersB = await carrier.put(`/carrier/groups/${gB.id}/members`, {
      driverIds: drivers.slice(2, 4).map((d) => d.driverId),
      applyNow: true,
      reason: 'آزمون',
    });
    expect((membersB.body as CarrierBulkGroupDto).memberCount).toBe(2);

    const reorder = await carrier.patch('/carrier/groups/reorder', { ids: [gB.id, gA.id] });
    expect(reorder.status).toBe(200);
    expect((reorder.body as CarrierBulkGroupDto[]).map((g) => g.id)).toEqual([gB.id, gA.id]);

    const settings = (await carrier.get('/carrier/bulk/settings')).body as CarrierBulkSettingsDto;
    expect(settings.maxLoadsPerDriverPerDay).toBe(2);
    expect(settings.leftoverAtHallEnd).toBe('CARRY');
    expect(settings.headMinutes).toBe(10);
    expect(settings.freeMinutes).toBe(5);
    expect(settings.startHeadGroupId).toBeNull();

    const updated = (await carrier.put('/carrier/bulk/settings', { maxLoadsPerDriverPerDay: 3 })).body as CarrierBulkSettingsDto;
    expect(updated.maxLoadsPerDriverPerDay).toBe(3);

    // start-head before the first bulk day sets the next head.
    const head = (await carrier.post('/carrier/bulk/start-head', { headGroupId: gA.id, reason: 'شروع' })).body as CarrierBulkSettingsDto;
    expect(head.startHeadGroupId).toBe(gA.id);
  });

  it('opens the head window lazily, closes it manually (next window opens), then halts', async () => {
    const base = t.clock.now();
    const day = await addHallDay(t, fx, fx.bulkHallId, {
      t0At: new Date(base.getTime() - MIN),
      priorityEndAt: null,
      hallEndAt: new Date(base.getTime() + 8 * 60 * MIN),
    });
    await createAnnouncement(t, fx, { hallId: fx.bulkHallId, hallDayId: day.id, allocation: 'GROUP', units: 3 });

    const live = (await carrier.get('/carrier/bulk/live')).body as CarrierBulkLiveDto;
    expect(live.day?.status).toBe('OPEN');
    expect(live.headGroup?.id).toBe(gA.id);
    expect(live.activeWindow?.kind).toBe('HEAD');
    expect(live.activeWindow?.seq).toBe(1);
    expect(live.activeWindow?.eligibleCount).toBe(2);
    expect(live.settings.maxLoadsPerDriverPerDay).toBe(3);

    const windowId = live.activeWindow!.id;
    const closed = (await carrier.post(`/carrier/bulk/windows/${windowId}/close`, { reason: 'بستن دستی' })).body as CarrierBulkLiveDto;
    expect(closed.activeWindow?.seq).toBe(2);
    expect(closed.activeWindow?.groupId).toBe(gB.id);
    const first = await t.prisma.bulkWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(first.closeReason).toBe('MANUAL');
    expect(await t.prisma.queueEvent.count({ where: { tenantId: fx.tenantId, type: 'MANUAL_CLOSE' } })).toBe(1);

    const halted = (await carrier.post('/carrier/bulk/halt', { reason: 'توقف اضطراری' })).body as CarrierBulkLiveDto;
    expect(halted.halted).toBe(true);
    expect(halted.activeWindow).toBeNull();
    expect((await t.prisma.bulkDay.findFirstOrThrow({ where: { hallDayId: day.id } })).status).toBe('HALTED');

    // Factory monitor reflects the hall and the halted bulk day.
    const monitor = (await factory.get('/factory/monitor')).body as FactoryMonitorDto;
    const hall = monitor.halls.find((h) => h.hallId === fx.bulkHallId)!;
    expect(hall.category).toBe('BULK');
    expect(hall.bulk.some((b) => b.carrierId === fx.carrierId)).toBe(true);

    const fairness = await factory.get('/factory/reports/bulk-fairness');
    expect(fairness.status).toBe(200);
    expect(Array.isArray(fairness.body)).toBe(true);
  });

  it('enforces roles and carrier scoping (AC-9)', async () => {
    const driver = await loginClient(server, fx.driver.mobile);
    expect((await driver.get('/carrier/groups')).status).toBe(403);
    expect((await factory.get('/carrier/groups')).status).toBe(403);
    // Carrier B sees none of carrier A's groups.
    const bGroups = (await carrierB.get('/carrier/groups')).body as CarrierBulkGroupDto[];
    expect(bGroups).toHaveLength(0);
    expect((await carrierB.post(`/carrier/groups/${gA.id}/members`, { driverIds: [] })).status).toBe(404);
  });
});
