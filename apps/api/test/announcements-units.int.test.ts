import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnnouncementDetailDto, AllocationChangeResultDto } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { annInput, createAnnFixture, loginClient, type AnnFixture, type Client } from './helpers/announcements-fixtures';

/** BR-10 / US-B4: allocation changes of load units (single + bulk). */
let t: TestApp;
let fx: AnnFixture;
let server: Server;
let carrier: Client;
let carrierB: Client;
let factory: Client;

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

async function create(o: Parameters<typeof annInput>[1] = {}): Promise<AnnouncementDetailDto> {
  const res = await carrier.post('/carrier/announcements', annInput(fx, o));
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as AnnouncementDetailDto;
}

const unitPath = (a: AnnouncementDetailDto, i: number) => `/carrier/announcements/${a.id}/units/${a.units[i]!.id}/allocation`;

describe('single unit allocation change', () => {
  it('TIMED → FREE writes history, queue_events UNIT_FREED and audit; FREE → TIMED reverts (UNIT_REGROUPED)', async () => {
    const a = await create({ truckCount: 2 });
    const res = await carrier.patch(unitPath(a, 0), { to: 'FREE', reason: 'بار مانده' });
    expect(res.status).toBe(200);
    const body = res.body as AllocationChangeResultDto;
    expect(body.changed).toBe(1);
    expect(body.units[0]).toMatchObject({ allocation: 'FREE', baseAllocation: 'TIMED', revertTo: 'TIMED', allowedTargets: ['TIMED'] });
    expect(body.units[1]).toMatchObject({ allocation: 'TIMED', allowedTargets: ['FREE'] });
    const unitId = a.units[0]!.id;
    expect(await t.prisma.loadUnitAllocationChange.count({ where: { unitId } })).toBe(1);
    const ev = await t.prisma.queueEvent.findFirst({ where: { tenantId: fx.tenantId, type: 'UNIT_FREED', payload: { path: ['unitId'], equals: unitId } } });
    expect(ev).toMatchObject({ carrierId: fx.carrierId, actorId: fx.carrierOp.id });
    expect(await t.prisma.auditLog.count({ where: { entityId: a.id, action: 'load_unit.allocation_change' } })).toBe(1);

    const back = await carrier.patch(unitPath(a, 0), { to: 'TIMED', reason: 'برگشت' });
    expect(back.status).toBe(200);
    expect(back.body.units[0]).toMatchObject({ allocation: 'TIMED', revertTo: null });
    expect(
      await t.prisma.queueEvent.count({ where: { tenantId: fx.tenantId, type: 'UNIT_REGROUPED', payload: { path: ['unitId'], equals: unitId } } }),
    ).toBe(1);
  });

  it('repeat to the same allocation is a no-op (no new history)', async () => {
    const a = await create({ truckCount: 1 });
    await carrier.patch(unitPath(a, 0), { to: 'FREE', reason: 'یک' });
    const again = await carrier.patch(unitPath(a, 0), { to: 'FREE', reason: 'دو' });
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(0);
    expect(await t.prisma.loadUnitAllocationChange.count({ where: { unitId: a.units[0]!.id } })).toBe(1);
  });

  it('rejects GROUP for a bag unit, promotion of created-FREE units, reserved units and missing reason', async () => {
    const a = await create({ truckCount: 2 });
    const bad = await carrier.patch(unitPath(a, 0), { to: 'GROUP', reason: 'x' });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('INVALID_STATE');
    expect((await carrier.patch(unitPath(a, 0), { to: 'FREE' })).status).toBe(400);
    await t.prisma.loadUnit.update({ where: { id: a.units[1]!.id }, data: { state: 'RESERVED' } });
    const reserved = await carrier.patch(unitPath(a, 1), { to: 'FREE', reason: 'x' });
    expect(reserved.status).toBe(409);
    expect(reserved.body.error.details.units[0].reason).toBe('UNIT_NOT_OPEN');

    const free = await create({ allocation: 'FREE', truckCount: 1 });
    expect((await carrier.patch(unitPath(free, 0), { to: 'TIMED', reason: 'x' })).status).toBe(409);
  });

  it('IDOR: another carrier, a unit of another announcement, unknown ids → 404; factory → 403', async () => {
    const a = await create({ truckCount: 1 });
    const b = await create({ truckCount: 1 });
    expect((await carrierB.patch(unitPath(a, 0), { to: 'FREE', reason: 'x' })).status).toBe(404);
    const mixed = await carrier.patch(`/carrier/announcements/${a.id}/units/${b.units[0]!.id}/allocation`, { to: 'FREE', reason: 'x' });
    expect(mixed.status).toBe(404);
    expect((await carrier.patch(`/carrier/announcements/${a.id}/units/${randomUUID()}/allocation`, { to: 'FREE', reason: 'x' })).status).toBe(404);
    expect((await factory.patch(unitPath(a, 0), { to: 'FREE', reason: 'x' })).status).toBe(403);
    expect((await t.prisma.loadUnit.findUniqueOrThrow({ where: { id: b.units[0]!.id } })).allocation).toBe('TIMED');
  });

  it('a cancelled announcement cannot change units', async () => {
    const a = await create({ truckCount: 1 });
    await carrier.post(`/carrier/announcements/${a.id}/cancel`, { reason: 'لغو' });
    expect((await carrier.patch(unitPath(a, 0), { to: 'FREE', reason: 'x' })).status).toBe(409);
  });
});

describe('bulk allocation change', () => {
  it('changes several GROUP units of a bulk announcement at once', async () => {
    const a = await create({ hallId: fx.bulkHallId, packagingTypeId: fx.bulkPackagingId, truckCount: 4 });
    const ids = a.units.slice(0, 3).map((u) => u.id);
    const res = await carrier.patch(`/carrier/announcements/${a.id}/units/allocation`, { unitIds: ids, to: 'FREE', reason: 'آزادسازی گروهی' });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(3);
    expect((res.body as AllocationChangeResultDto).units.map((u) => u.allocation)).toEqual(['FREE', 'FREE', 'FREE', 'GROUP']);
    expect(await t.prisma.queueEvent.count({ where: { tenantId: fx.tenantId, type: 'UNIT_FREED', payload: { path: ['announcementId'], equals: a.id } } })).toBe(3);
    const back = await carrier.patch(`/carrier/announcements/${a.id}/units/allocation`, { unitIds: ids, to: 'GROUP', reason: 'برگشت' });
    expect(back.body.changed).toBe(3);
  });

  it('is all-or-nothing: one reserved unit rejects the whole batch', async () => {
    const a = await create({ truckCount: 3 });
    await t.prisma.loadUnit.update({ where: { id: a.units[2]!.id }, data: { state: 'RESERVED' } });
    const res = await carrier.patch(`/carrier/announcements/${a.id}/units/allocation`, {
      unitIds: a.units.map((u) => u.id),
      to: 'FREE',
      reason: 'x',
    });
    expect(res.status).toBe(409);
    expect(await t.prisma.loadUnit.count({ where: { announcementId: a.id, allocation: 'FREE' } })).toBe(0);
    expect((await carrier.patch(`/carrier/announcements/${a.id}/units/allocation`, { unitIds: [], to: 'FREE', reason: 'x' })).status).toBe(400);
  });
});
