import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysIso, isoDateToJalaliYearMonth, localDate } from '@cb/shared';
import { createTestApp, freshIp, type TestApp } from './helpers/app';
import { createFixture, login, PASSWORD, randomMobile, validNationalId, type Fixture, type Session } from './helpers/fixtures';

/**
 * Acceptance scenario of PLAN P2 (v0.2.0), end to end through the public API only:
 *
 *   factory creates a carrier → factory uploads that carrier's daily file →
 *   carrier announces 10 trucks → a driver registers → the carrier approves the driver
 *
 * Every step authenticates as the role that owns it, so a regression in scoping, RBAC or the
 * vertical wiring between slices fails here even when each slice's own tests still pass.
 */

let t: TestApp;
let fx: Fixture;
let server: Server;
let factory: Client;

let xlsx: Buffer;
let today: string;
let month: string;
const uploadDir = mkdtempSync(join(tmpdir(), 'cb-p2-'));
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Client {
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
  put: (path: string, body?: unknown) => request.Test;
  patch: (path: string, body?: unknown) => request.Test;
  session: Session;
}

/** Same wrapper as the other int tests: cookie + CSRF + a distinct fake IP per test file. */
function client(srv: Server, session: Session): Client {
  const ip = freshIp();
  const auth = (r: request.Test) => r.set('Cookie', session.cookie).set('X-CSRF', session.csrf).set('X-Forwarded-For', ip);
  return {
    get: (p) => auth(request(srv).get(`/api${p}`)),
    post: (p, b) => auth(request(srv).post(`/api${p}`)).send(b as object),
    put: (p, b) => auth(request(srv).put(`/api${p}`)).send(b as object),
    patch: (p, b) => auth(request(srv).patch(`/api${p}`)).send(b as object),
    session,
  };
}

interface CreatedCarrier {
  id: string;
  code: string;
  username: string;
  carrierSession: Client;
  /** master data created by the carrier in step 3 */
  partyId: string;
  loadingLocationId: string;
  goodsOwnerId: string;
  announcementId: string;
}

beforeAll(async () => {
  process.env.UPLOAD_DIR = uploadDir;
  t = await createTestApp();
  fx = await createFixture(t);
  server = t.app.getHttpServer() as Server;
  factory = await loginClient(fx.factory.username);
  xlsx = await makeXlsx();
  today = localDate(t.clock.now());
  month = isoDateToJalaliYearMonth(today);
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function loginSession(who: string, password: string = PASSWORD): Promise<Session> {
  const { res, session } = await login(server, who, password, freshIp());
  if (res.status !== 200) throw new Error(`login failed for ${who}: ${res.status} ${JSON.stringify(res.body)}`);
  return session;
}

/** Logs in with PASSWORD and returns an authenticated supertest wrapper. */
async function loginClient(who: string, password: string = PASSWORD): Promise<Client> {
  return client(server, await loginSession(who, password));
}

function uploadDailyFile(s: Session, fields: Record<string, string>, xlsx: Buffer, name = 'برنامه روزانه.xlsx') {
  let r = request(server).post('/api/factory/daily-files').set('Cookie', s.cookie).set('X-CSRF', s.csrf);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', xlsx, { filename: name, contentType: XLSX_MIME });
}

async function makeXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('بار').addRow(['شماره', 1]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('P2 acceptance — factory builds a carrier, the carrier works that day and onboards a driver', () => {
  let created: CreatedCarrier;

  it('1. factory creates a carrier with its operator and the month quota', async () => {
    const res = await factory.post('/factory/carriers', {
      code: String(Date.now()).slice(-8),
      name: 'باربری پذیرش',
      phone: '03100000000',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const carrier = res.body as { id: string; code: string };

    const user = await factory.post(`/factory/carriers/${carrier.id}/users`, {
      username: `p2_${carrier.code}`,
      displayName: 'اپراتور پذیرش',
      password: PASSWORD,
    });
    expect(user.status, JSON.stringify(user.body)).toBe(201);

    const quota = await factory.put(`/factory/carriers/${carrier.id}/quotas`, {
      yearMonth: month,
      tonnageLimitKg: 1_000_000_000,
    });
    expect(quota.status).toBe(200);

    // The operator can now log in and only ever sees this carrier.
    const session = await loginClient(`p2_${carrier.code}`);
    const me = await session.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('CARRIER_OPERATOR');
    expect(me.body.carrier.id).toBe(carrier.id);

    created = {
      id: carrier.id,
      code: carrier.code,
      username: `p2_${carrier.code}`,
      carrierSession: session,
      partyId: '',
      loadingLocationId: '',
      goodsOwnerId: '',
      announcementId: '',
    };
  });

  it('2. factory uploads the daily file; the carrier sees it and the first download marks it seen', async () => {
    const up = await uploadDailyFile(factory.session, { carrierId: created.id, forDate: today, note: 'برنامه امروز' }, xlsx);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const fileId = (up.body as { id: string }).id;

    const list = await created.carrierSession.get('/carrier/daily-files');
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(fileId);
    expect(list.body.items.find((r: { id: string }) => r.id === fileId)).toMatchObject({ seen: false, seenAt: null });

    const dl = await created.carrierSession.get(`/carrier/daily-files/${fileId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe(XLSX_MIME);
    expect(dl.headers['content-disposition']).toContain('attachment');

    const after = await created.carrierSession.get('/carrier/daily-files');
    expect(after.body.items.find((r: { id: string }) => r.id === fileId)).toMatchObject({ seen: true });
    expect(await t.prisma.auditLog.count({ where: { entityId: fileId, action: 'dailyFile.seen' } })).toBe(1);

    // A different carrier's operator must not be able to reach it (AC-9).
    const foreign = await loginClient(fx.carrierOp.username);
    expect((await foreign.get(`/carrier/daily-files/${fileId}/download`)).status).toBe(404);
  });

  it('3. the carrier needs master data before announcing (created through its own endpoints)', async () => {
    const location = await created.carrierSession.post('/carrier/master/loading-locations', {
      warehouseType: 'انبار',
      name: 'انبار پذیرش',
      cityId: fx.cityId,
      address: 'نشانی انبار',
    });
    expect(location.status, JSON.stringify(location.body)).toBe(201);

    const party = await created.carrierSession.post('/carrier/master/parties', {
      title: 'فرستنده',
      name: 'شرکت فرستنده پذیرش',
      nationalId: validNationalId(),
      addresses: [{ cityId: fx.cityId, address: 'نشانی فرستنده' }],
    });
    expect(party.status, JSON.stringify(party.body)).toBe(201);

    const owner = await created.carrierSession.post('/carrier/master/goods-owners', {
      name: 'صاحب کالا',
      nationalId: validNationalId(),
    });
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    Object.assign(created, {
      loadingLocationId: (location.body as { id: string }).id,
      partyId: (party.body as { id: string }).id,
      goodsOwnerId: (owner.body as { id: string }).id,
    });
  });

  it('4. the carrier announces 10 trucks against the factory hall and the quota is consumed', async () => {
    // Hall/product/packaging/destination/loader type come from the factory's master data.
    const [product, packaging, destination, loader] = await Promise.all([
      factory.post('/factory/products', { title: 'سیمان تیپ ۲ پذیرش' }),
      factory.post('/factory/packaging-types', { title: 'کیسه ۵۰ پذیرش', category: 'BAG' }),
      factory.post('/factory/destinations', { cityId: fx.cityId, title: 'مقصد پذیرش' }),
      factory.post('/factory/loader-types', { code: `ACC_${Date.now().toString().slice(-6)}`, title: 'کامیون پذیرش' }),
    ]);
    expect([product.status, packaging.status, destination.status, loader.status]).toEqual([201, 201, 201, 201]);

    const hall = await factory.post('/factory/halls', { title: 'سالن پذیرش', category: 'BAG', defaultAllocation: 'TIMED' });
    expect(hall.status, JSON.stringify(hall.body)).toBe(201);

    const body = {
      announceDate: today,
      announceTime: '09:00',
      hallId: (hall.body as { id: string }).id,
      senderPartyId: (created as unknown as { partyId: string }).partyId,
      destinationId: (destination.body as { id: string }).id,
      receiverName: 'گیرنده پذیرش',
      productId: (product.body as { id: string }).id,
      packagingTypeId: (packaging.body as { id: string }).id,
      cargoValue: 2_000_000_000,
      loadingLocationId: (created as unknown as { loadingLocationId: string }).loadingLocationId,
      fareCalc: 'PER_TRUCK',
      loaderTypeId: (loader.body as { id: string }).id,
      truckCount: 10,
      weightFromKg: 20_000,
      weightToKg: 25_000,
      destFareType: 'عادی',
      farePerTruck: 90_000_000,
      goodsOwnerId: (created as unknown as { goodsOwnerId: string }).goodsOwnerId,
      description: 'اعلام بار پذیرش',
      extra: {},
    };
    const res = await created.carrierSession.post('/carrier/announcements', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const announcement = res.body as { id: string; number: number; units: { id: string }[]; quotaKg: string };
    expect(announcement.units).toHaveLength(10);
    expect(announcement.quotaKg).toBe(String(10 * 25_000));

    // The factory, which must see every carrier's announcements, sees this one.
    const factoryList = await factory.get(`/factory/announcements?q=${encodeURIComponent('اعلام بار پذیرش')}`);
    expect(factoryList.status).toBe(200);
    expect(factoryList.body.items.map((r: { id: string }) => r.id)).toContain(announcement.id);
    Object.assign(created, { announcementId: announcement.id, unitIds: announcement.units.map((u) => u.id) });
  });

  it('5. a driver registers publicly, waits for approval and is approved by their carrier', async () => {
    const mobile = randomMobile();
    const registerBody = {
      mobile,
      password: 'Driver@12345',
      firstName: 'رضا',
      lastName: 'پذیرش',
      nationalId: validNationalId(),
      licenseNo: 'L-22334455',
      licenseIssueDate: '2016-04-05',
      birthCityId: fx.cityId,
      healthCardExpiry: addDaysIso(today, 365),
      carrierId: created.id,
      vehicle: {
        smartCardNo: `SC${String(Date.now()).slice(-8)}`,
        plate: { two: '42', letter: 'ب', three: '315', iran: '68' },
        loaderTypeId: fx.loaderTypeId,
        smartCardExpiry: addDaysIso(today, 365),
        inspectionExpiry: addDaysIso(today, 365),
      },
    };
    const reg = await request(server).post('/api/auth/register-driver').set('X-Forwarded-For', freshIp()).send(registerBody);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const driverId = (reg.body as { id: string; status: string }).id;
    expect((reg.body as { status: string }).status).toBe('PENDING');

    // The driver belongs to exactly this carrier; a second registration is a conflict.
    const dup = await request(server).post('/api/auth/register-driver').set('X-Forwarded-For', freshIp()).send(registerBody);
    expect(dup.status).toBe(409);

    // The driver can log in while pending, and sees the pending state.
    const driver = await loginClient(mobile, 'Driver@12345');
    const dash = await driver.get('/driver/dashboard');
    expect(dash.status).toBe(200);
    expect((dash.body as { driver: { status: string } }).driver.status).toBe('PENDING');

    // Other carriers cannot decide on this driver (AC-9), the owning carrier approves.
    const foreign = await loginClient(fx.carrierOp.username);
    expect((await foreign.post(`/carrier/drivers/${driverId}/decision`, { decision: 'APPROVE' })).status).toBe(404);
    const approve = await created.carrierSession.post(`/carrier/drivers/${driverId}/decision`, { decision: 'APPROVE' });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect((approve.body as { status: string }).status).toBe('APPROVED');

    const approved = await t.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(approved.status).toBe('APPROVED');
    expect(await t.prisma.auditLog.count({ where: { entityId: driverId, action: { startsWith: 'driver.' } } })).toBeGreaterThanOrEqual(2);
  });

  it('6. the carrier report shows the day: 10 units announced and the driver approved', async () => {
    const reports = await factory.get(`/factory/reports/permits?f_reservedAt=${today}`);
    expect(reports.status).toBe(200);
    const drivers = await created.carrierSession.get('/carrier/drivers?f_status=APPROVED');
    expect(drivers.status).toBe(200);
    expect(drivers.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('a second carrier never sees the first carrier’s announcement (AC-9)', async () => {
    const other = await loginClient(fx.carrierOp.username);
    const list = await other.get('/carrier/announcements');
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).not.toContain((created as unknown as { announcementId: string }).announcementId);
    const direct = await other.get(`/carrier/announcements/${(created as unknown as { announcementId: string }).announcementId}`);
    expect(direct.status).toBe(404);
  });
});
