import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysIso, localDate } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { createFactoryWorld, type FactoryWorld } from './helpers/factory-helpers';

let t: TestApp;
let w: FactoryWorld;
let bagHall: string;
let bulkHall: string;
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, t0: '08:00', priorityEnd: '08:30', hallEnd: '12:00' }));

beforeAll(async () => {
  t = await createTestApp();
  w = await createFactoryWorld(t);
});

afterAll(async () => {
  await w?.dispose();
  await t?.close();
});

describe('factory halls', () => {
  it('creates halls; incompatible category/allocation → 400', async () => {
    const bag = await w.factory.post('/api/factory/halls', { title: 'سالن کیسه', category: 'BAG', defaultAllocation: 'TIMED' });
    expect(bag.status).toBe(201);
    expect(bag.body).toMatchObject({ category: 'BAG', active: true, schedules: [] });
    bagHall = bag.body.id;
    const bulk = await w.factory.post('/api/factory/halls', { title: 'سالن فله', category: 'BULK', defaultAllocation: 'GROUP' });
    bulkHall = bulk.body.id;
    expect((await w.factory.post('/api/factory/halls', { title: 'x', category: 'BAG', defaultAllocation: 'GROUP' })).status).toBe(400);
    const list = await w.factory.get('/api/factory/halls');
    expect(list.body.map((h: { id: string }) => h.id).sort()).toEqual([bagHall, bulkHall].sort());
    expect((await w.otherFactory.get('/api/factory/halls')).body).toEqual([]);
  });

  it('PATCH only changes sent keys (no default leakage); IDOR → 404', async () => {
    await w.factory.patch(`/api/factory/halls/${bulkHall}`, { active: false });
    const r = await w.factory.patch(`/api/factory/halls/${bulkHall}`, { title: 'فله ۱' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: 'فله ۱', active: false });
    await w.factory.patch(`/api/factory/halls/${bulkHall}`, { active: true });
    expect((await w.factory.patch(`/api/factory/halls/${bulkHall}`, { defaultAllocation: 'TIMED' })).status).toBe(400);
    expect((await w.otherFactory.patch(`/api/factory/halls/${bulkHall}`, { title: 'x' })).status).toBe(404);
    expect((await w.otherFactory.get(`/api/factory/halls/${bulkHall}`)).status).toBe(404);
  });

  it('replaces the weekly schedule atomically; TIMED halls need priorityEnd; bad order → 400', async () => {
    const r = await w.factory.put(`/api/factory/halls/${bagHall}/schedules`, { items: ALL_WEEK });
    expect(r.status).toBe(200);
    expect(r.body.schedules).toHaveLength(7);
    const r2 = await w.factory.put(`/api/factory/halls/${bagHall}/schedules`, { items: ALL_WEEK.slice(0, 5) });
    expect(r2.body.schedules).toHaveLength(5);
    const noPrio = await w.factory.put(`/api/factory/halls/${bagHall}/schedules`, { items: [{ weekday: 0, t0: '08:00', hallEnd: '12:00' }] });
    expect(noPrio.status).toBe(400);
    const bad = await w.factory.put(`/api/factory/halls/${bagHall}/schedules`, { items: [{ weekday: 0, t0: '12:00', priorityEnd: '12:30', hallEnd: '09:00' }] });
    expect(bad.status).toBe(400);
    const dup = await w.factory.put(`/api/factory/halls/${bagHall}/schedules`, { items: [ALL_WEEK[0], ALL_WEEK[0]] });
    expect(dup.status).toBe(400);
    expect((await w.factory.get(`/api/factory/halls/${bagHall}`)).body.schedules).toHaveLength(5); // failed calls changed nothing
    expect((await w.otherFactory.put(`/api/factory/halls/${bagHall}/schedules`, { items: [] })).status).toBe(404);
    // bulk hall: headMinutes/freeMinutes, no priority end needed
    const bulk = await w.factory.put(`/api/factory/halls/${bulkHall}/schedules`, {
      items: [{ weekday: 1, t0: '09:00', hallEnd: '13:00', headMinutes: 10, freeMinutes: 5 }],
    });
    expect(bulk.status).toBe(200);
  });
});

describe('factory hall days', () => {
  const tomorrow = () => addDaysIso(localDate(t.clock.now()), 1);

  it('generates days from the schedule; re-run creates nothing (idempotent)', async () => {
    await w.factory.put(`/api/factory/halls/${bagHall}/schedules`, { items: ALL_WEEK });
    const g = await w.factory.post(`/api/factory/halls/${bagHall}/days/generate`, { from: tomorrow(), days: 7 });
    expect(g.status).toBe(201);
    expect(g.body.created).toHaveLength(7);
    const again = await w.factory.post(`/api/factory/halls/${bagHall}/days/generate`, { from: tomorrow(), days: 7 });
    expect(again.body.created).toEqual([]);
    expect(again.body.skipped.every((s: { reason: string }) => s.reason === 'EXISTS')).toBe(true);
    expect(await t.prisma.hallDay.count({ where: { hallId: bagHall } })).toBe(7);
    expect((await w.factory.post(`/api/factory/halls/${bagHall}/days/generate`, { from: tomorrow(), days: 99 })).status).toBe(400);
    expect((await w.otherFactory.post(`/api/factory/halls/${bagHall}/days/generate`, { from: tomorrow(), days: 1 })).status).toBe(404);
  });

  it('lists days in a range', async () => {
    const r = await w.factory.get(`/api/factory/halls/${bagHall}/days?from=${tomorrow()}&to=${addDaysIso(tomorrow(), 2)}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(3);
    expect(r.body[0]).toMatchObject({ date: tomorrow(), status: 'SCHEDULED' });
    expect((await w.factory.get(`/api/factory/halls/${bagHall}/days?from=bad`)).status).toBe(400);
    expect((await w.otherFactory.get(`/api/factory/halls/${bagHall}/days`)).status).toBe(404);
  });

  it('one-off day: duplicate → 409, past T0 → 409, TIMED without priorityEnd → 400', async () => {
    const date = addDaysIso(tomorrow(), 20);
    const ok = await w.factory.post(`/api/factory/halls/${bagHall}/days`, { date, t0: '07:00', priorityEnd: '07:20', hallEnd: '10:00' });
    expect(ok.status).toBe(201);
    expect(ok.body.t0At).toBe(new Date(`${date}T03:30:00.000Z`).toISOString());
    expect((await w.factory.post(`/api/factory/halls/${bagHall}/days`, { date, t0: '07:00', priorityEnd: '07:20', hallEnd: '10:00' })).status).toBe(409);
    const past = await w.factory.post(`/api/factory/halls/${bagHall}/days`, { date: '2020-01-01', t0: '07:00', priorityEnd: '07:20', hallEnd: '10:00' });
    expect(past.status).toBe(409);
    expect((await w.factory.post(`/api/factory/halls/${bagHall}/days`, { date: addDaysIso(date, 1), t0: '07:00', hallEnd: '10:00' })).status).toBe(400);
  });

  it('re-times a scheduled day with a reason; IDOR → 404', async () => {
    const [day] = (await w.factory.get(`/api/factory/halls/${bagHall}/days?from=${tomorrow()}&to=${tomorrow()}`)).body;
    const r = await w.factory.patch(`/api/factory/halls/${bagHall}/days/${day.id}`, { t0: '09:00', priorityEnd: '09:30', hallEnd: '13:00', reason: 'تأخیر بارگیری' });
    expect(r.status).toBe(200);
    expect(r.body.t0At).not.toBe(day.t0At);
    expect((await w.factory.patch(`/api/factory/halls/${bagHall}/days/${day.id}`, { t0: '09:00', hallEnd: '13:00' })).status).toBe(400);
    expect((await w.otherFactory.patch(`/api/factory/halls/${bagHall}/days/${day.id}`, { t0: '09:00', priorityEnd: '09:30', hallEnd: '13:00', reason: 'x' })).status).toBe(404);
    expect((await w.factory.patch(`/api/factory/halls/${bulkHall}/days/${day.id}`, { t0: '09:00', hallEnd: '13:00', reason: 'x' })).status).toBe(404);
    expect(await t.prisma.auditLog.count({ where: { entityId: day.id, action: 'hall_day.updated', reason: 'تأخیر بارگیری' } })).toBe(1);
  });

  it('halts a day (queue event + audit); second halt and re-time after halt → 409', async () => {
    const [, day] = (await w.factory.get(`/api/factory/halls/${bagHall}/days?from=${tomorrow()}&to=${addDaysIso(tomorrow(), 1)}`)).body;
    expect((await w.otherFactory.post(`/api/factory/halls/${bagHall}/days/${day.id}/halt`, { reason: 'x' })).status).toBe(404);
    expect((await w.factory.post(`/api/factory/halls/${bagHall}/days/${day.id}/halt`, {})).status).toBe(400);
    const r = await w.factory.post(`/api/factory/halls/${bagHall}/days/${day.id}/halt`, { reason: 'خرابی باسکول' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'HALTED', haltedReason: 'خرابی باسکول' });
    expect(await t.prisma.queueEvent.count({ where: { hallDayId: day.id, type: 'HALL_HALTED' } })).toBe(1);
    expect((await w.factory.post(`/api/factory/halls/${bagHall}/days/${day.id}/halt`, { reason: 'again' })).status).toBe(409);
    const retime = await w.factory.patch(`/api/factory/halls/${bagHall}/days/${day.id}`, { t0: '09:00', priorityEnd: '09:30', hallEnd: '13:00', reason: 'x' });
    expect(retime.status).toBe(409);
  });
});

describe('factory policies (versioned)', () => {
  it('POST creates version 1, 2 … with defaults filled; history is kept', async () => {
    const v1 = await w.factory.post('/api/factory/policies', { hallId: bagHall, strategy: 'TIMED_PRIORITY_RESERVATION', params: {} });
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({ version: 1, current: true, params: { maxPriorities: 3, cancelPenaltyHours: 24 } });
    const v2 = await w.factory.post('/api/factory/policies', { hallId: bagHall, strategy: 'TIMED_PRIORITY_RESERVATION', params: { maxPriorities: 2 }, note: 'کاهش' });
    expect(v2.body.version).toBe(2);
    const list = await w.factory.get(`/api/factory/policies?hallId=${bagHall}`);
    expect(list.body.map((p: { version: number; current: boolean }) => [p.version, p.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect((await t.prisma.queuePolicy.findUnique({ where: { id: v1.body.id } }))?.params).toMatchObject({ maxPriorities: 3 });
  });

  it('rejects unknown params, wrong types, incompatible strategy (400) and foreign halls (404)', async () => {
    expect((await w.factory.post('/api/factory/policies', { hallId: bagHall, strategy: 'TIMED_PRIORITY_RESERVATION', params: { evil: 1 } })).status).toBe(400);
    expect((await w.factory.post('/api/factory/policies', { hallId: bagHall, strategy: 'TIMED_PRIORITY_RESERVATION', params: { maxPriorities: 9 } })).status).toBe(400);
    expect((await w.factory.post('/api/factory/policies', { hallId: bagHall, strategy: 'BULK_GROUP_ROTATION', params: {} })).status).toBe(400);
    expect((await w.otherFactory.post('/api/factory/policies', { hallId: bagHall, strategy: 'FREE_FIRST_COME', params: {} })).status).toBe(404);
    expect((await w.otherFactory.get(`/api/factory/policies?hallId=${bagHall}`)).body).toEqual([]);
    const ok = await w.factory.post('/api/factory/policies', { hallId: bulkHall, strategy: 'BULK_GROUP_ROTATION', params: { headMinutes: 15 } });
    expect(ok.body).toMatchObject({ version: 1, params: { headMinutes: 15, freeMinutes: 5 } });
  });

  it('concurrent POSTs get distinct consecutive versions', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => w.factory.post('/api/factory/policies', { hallId: bulkHall, strategy: 'FREE_FIRST_COME', params: {} })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(results.map((r) => r.body.version).sort()).toEqual([1, 2, 3]);
  });
});

describe('factory master data', () => {
  it('destinations: create, duplicate city → 409, unknown city → 400, patch, IDOR', async () => {
    const d = await w.factory.post('/api/factory/destinations', { cityId: w.a.cityId, title: 'شیراز' });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ cityName: 'شهر آزمون', active: true, sortOrder: 0 });
    expect((await w.factory.post('/api/factory/destinations', { cityId: w.a.cityId, title: 'دوباره' })).status).toBe(409);
    expect((await w.factory.post('/api/factory/destinations', { cityId: 123456789, title: 'x' })).status).toBe(400);
    const p = await w.factory.patch(`/api/factory/destinations/${d.body.id}`, { active: false });
    expect(p.body).toMatchObject({ active: false, title: 'شیراز' });
    expect((await w.factory.get('/api/factory/destinations')).body).toHaveLength(1);
    expect((await w.otherFactory.get('/api/factory/destinations')).body).toEqual([]);
    expect((await w.otherFactory.patch(`/api/factory/destinations/${d.body.id}`, { active: true })).status).toBe(404);
  });

  it('loader types: code format + uniqueness', async () => {
    const c = `TR_${tag()}`;
    const r = await w.factory.post('/api/factory/loader-types', { code: c, title: 'تریلی کفی' });
    expect(r.status).toBe(201);
    expect((await w.factory.post('/api/factory/loader-types', { code: c, title: 'x' })).status).toBe(409);
    expect((await w.factory.post('/api/factory/loader-types', { code: 'bad code', title: 'x' })).status).toBe(400);
    const p = await w.factory.patch(`/api/factory/loader-types/${r.body.id}`, { sortOrder: 3 });
    expect(p.body).toMatchObject({ sortOrder: 3, active: true, code: c });
    expect((await w.factory.get('/api/factory/loader-types')).body.length).toBe(2); // fixture + new
    expect((await w.otherFactory.patch(`/api/factory/loader-types/${r.body.id}`, { title: 'x' })).status).toBe(404);
  });

  it('packaging types and products: create, deactivate, IDOR', async () => {
    const pk = await w.factory.post('/api/factory/packaging-types', { title: 'کیسه ۵۰ کیلویی', category: 'BAG' });
    expect(pk.status).toBe(201);
    expect((await w.factory.post('/api/factory/packaging-types', { title: 'x', category: 'LIQUID' })).status).toBe(400);
    expect((await w.factory.patch(`/api/factory/packaging-types/${pk.body.id}`, { category: 'BULK' })).body.category).toBe('BULK');
    expect((await w.otherFactory.patch(`/api/factory/packaging-types/${pk.body.id}`, { active: false })).status).toBe(404);

    const pr = await w.factory.post('/api/factory/products', { title: 'سیمان تیپ ۲' });
    expect(pr.status).toBe(201);
    expect((await w.factory.post('/api/factory/products', { title: '' })).status).toBe(400);
    expect((await w.factory.patch(`/api/factory/products/${pr.body.id}`, { active: false })).body).toMatchObject({ active: false, title: 'سیمان تیپ ۲' });
    expect((await w.factory.get('/api/factory/products')).body).toHaveLength(1);
    expect((await w.otherFactory.get('/api/factory/products')).body).toEqual([]);
    expect(await t.prisma.auditLog.count({ where: { tenantId: w.a.tenantId, action: { in: ['product.created', 'product.updated'] } } })).toBe(2);
  });
});
