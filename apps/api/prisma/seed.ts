/* Idempotent development seed: `pnpm --filter @cb/api db:seed` (re-runnable). */
import { PrismaClient, type Strategy } from '@prisma/client';
import { bulkCarrierSettings, bulkPolicyParams, freePolicyParams, jalaliYearMonth, localDate, timedPolicyParams } from '@cb/shared';
import { loadConfig, loadDotEnv } from '../src/config/app-config';
import { FieldCrypto } from '../src/common/crypto/field-crypto';
import { hashPassword } from '../src/modules/auth/password.service';
import * as D from './seed/data';

loadDotEnv();
const config = loadConfig();
const prisma = new PrismaClient();
const crypto = new FieldCrypto(config.fieldEncryptionKey, config.fieldHashKey);

const isoDay = (d: Date): Date => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
const addYears = (d: Date, n: number): Date => new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));

/** Deterministic national id with a valid checksum for index i. */
function nationalIdFor(i: number): string {
  const base = String(100_000_000 + i * 7_919).slice(-9).padStart(9, '0');
  const digits = base.split('').map(Number);
  const sum = digits.reduce((acc, d, k) => acc + d * (10 - k), 0);
  const r = sum % 11;
  return `${base}${r < 2 ? r : 11 - r}`;
}

async function seedTenant(): Promise<string> {
  const existing = await prisma.tenant.findFirst({ where: { name: D.TENANT_NAME }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;
  return (await prisma.tenant.create({ data: { name: D.TENANT_NAME, timezone: 'Asia/Tehran' } })).id;
}

async function seedGeo(tenantId: string): Promise<Map<string, number>> {
  const cityIds = new Map<string, number>();
  for (const p of D.PROVINCES) {
    await prisma.province.upsert({ where: { id: p.id }, update: { name: p.name }, create: { id: p.id, name: p.name } });
    for (const [n, name] of p.cities.entries()) {
      const id = p.id * 100 + n + 1;
      await prisma.city.upsert({ where: { id }, update: { name }, create: { id, provinceId: p.id, name } });
      cityIds.set(name, id);
    }
  }
  for (const [sortOrder, title] of D.DESTINATIONS.entries()) {
    const cityId = cityIds.get(title);
    if (!cityId) throw new Error(`destination city missing: ${title}`);
    await prisma.destination.upsert({
      where: { tenantId_cityId: { tenantId, cityId } },
      update: {},
      create: { tenantId, cityId, title, sortOrder },
    });
  }
  return cityIds;
}

async function seedMasterData(tenantId: string): Promise<Record<string, string>> {
  const loaderIds: Record<string, string> = {};
  for (const [sortOrder, lt] of D.LOADER_TYPES.entries()) {
    const row = await prisma.loaderType.upsert({
      where: { tenantId_code: { tenantId, code: lt.code } },
      update: {},
      create: { tenantId, code: lt.code, title: lt.title, sortOrder },
    });
    loaderIds[lt.code] = row.id;
  }
  for (const p of D.PACKAGING_TYPES) {
    const found = await prisma.packagingType.findFirst({ where: { tenantId, title: p.title } });
    if (!found) await prisma.packagingType.create({ data: { tenantId, title: p.title, category: p.category } });
  }
  for (const title of D.PRODUCTS) {
    const found = await prisma.product.findFirst({ where: { tenantId, title } });
    if (!found) await prisma.product.create({ data: { tenantId, title } });
  }
  return loaderIds;
}

async function upsertPolicy(tenantId: string, hallId: string, strategy: Strategy, params: object): Promise<void> {
  await prisma.queuePolicy.upsert({
    where: { hallId_strategy_version: { hallId, strategy, version: 1 } },
    update: {},
    create: { tenantId, hallId, strategy, version: 1, params, activeFrom: new Date('2026-01-01T00:00:00.000Z') },
  });
}

async function seedHalls(tenantId: string): Promise<void> {
  const ensureHall = async (h: (typeof D.HALLS)[keyof typeof D.HALLS]): Promise<string> => {
    const found = await prisma.hall.findFirst({ where: { tenantId, title: h.title } });
    if (found) return found.id;
    return (await prisma.hall.create({ data: { tenantId, ...h } })).id;
  };
  const bagId = await ensureHall(D.HALLS.bag);
  const bulkId = await ensureHall(D.HALLS.bulk);
  for (const weekday of D.WORKING_WEEKDAYS) {
    await prisma.hallSchedule.upsert({
      where: { hallId_weekday: { hallId: bagId, weekday } },
      update: {},
      create: { tenantId, hallId: bagId, weekday, ...D.BAG_SCHEDULE },
    });
    await prisma.hallSchedule.upsert({
      where: { hallId_weekday: { hallId: bulkId, weekday } },
      update: {},
      create: { tenantId, hallId: bulkId, weekday, ...D.BULK_SCHEDULE },
    });
  }
  await upsertPolicy(tenantId, bagId, 'TIMED_PRIORITY_RESERVATION', timedPolicyParams.parse({}));
  await upsertPolicy(tenantId, bagId, 'FREE_FIRST_COME', freePolicyParams.parse({}));
  await upsertPolicy(tenantId, bulkId, 'BULK_GROUP_ROTATION', bulkPolicyParams.parse({}));
  await upsertPolicy(tenantId, bulkId, 'FREE_FIRST_COME', freePolicyParams.parse({}));
}

async function seedOperators(tenantId: string, hashes: { factory: string; carrier: string }): Promise<string[]> {
  await prisma.user.upsert({
    where: { username: 'factory' },
    update: {},
    create: { tenantId, role: 'FACTORY_OPERATOR', username: 'factory', displayName: 'اپراتور کارخانه', passwordHash: hashes.factory },
  });
  const carrierIds: string[] = [];
  for (const c of D.CARRIERS) {
    const carrier = await prisma.carrier.upsert({
      where: { tenantId_code: { tenantId, code: c.code } },
      update: {},
      create: { tenantId, code: c.code, name: c.name },
    });
    carrierIds.push(carrier.id);
    await prisma.user.upsert({
      where: { username: c.username },
      update: {},
      create: {
        tenantId,
        role: 'CARRIER_OPERATOR',
        username: c.username,
        displayName: `اپراتور ${c.name}`,
        passwordHash: hashes.carrier,
        carrierId: carrier.id,
      },
    });
  }
  return carrierIds;
}

interface DriverCtx {
  tenantId: string;
  carrierIds: string[];
  loaderIds: Record<string, string>;
  birthCityId: number;
  passwordHash: string;
  today: Date;
}

async function seedDriver(ctx: DriverCtx, i: number, status: 'APPROVED' | 'PENDING'): Promise<void> {
  const { tenantId, today } = ctx;
  const mobile = `0912000${String(i).padStart(4, '0')}`;
  const nid = nationalIdFor(i);
  const firstName = D.FIRST_NAMES[i % D.FIRST_NAMES.length]!;
  const lastName = D.LAST_NAMES[Math.floor(i / D.FIRST_NAMES.length) % D.LAST_NAMES.length]!;
  const carrierId = ctx.carrierIds[0]!;
  const loaderTypeId = i % 3 === 0 ? ctx.loaderIds.FLATBED! : ctx.loaderIds.BUNKER!;
  const yearLater = addYears(today, 1);

  const user = await prisma.user.upsert({
    where: { mobile },
    update: {},
    create: { tenantId, role: 'DRIVER', mobile, displayName: `${firstName} ${lastName}`, passwordHash: ctx.passwordHash },
  });
  const driver = await prisma.driver.upsert({
    where: { userId: user.id },
    // Demo data: all seeded drivers belong to the first carrier so the 20×6 bulk rotation exists.
    update: { carrierId },
    create: {
      tenantId,
      userId: user.id,
      carrierId,
      status,
      firstName,
      lastName,
      nationalIdEnc: crypto.encrypt(nid),
      nationalIdHash: crypto.hash(nid),
      licenseNo: `LIC-${String(i).padStart(5, '0')}`,
      licenseIssueDate: new Date('2015-01-01T00:00:00.000Z'),
      birthCityId: ctx.birthCityId,
      healthCardExpiry: yearLater,
      decidedAt: status === 'APPROVED' ? today : null,
    },
  });
  const letter = D.PLATE_LETTERS_CYCLE[i % D.PLATE_LETTERS_CYCLE.length]!;
  await prisma.vehicle.upsert({
    where: { smartCardNo: `5${String(i).padStart(7, '0')}` },
    update: {},
    create: {
      tenantId,
      driverId: driver.id,
      smartCardNo: `5${String(i).padStart(7, '0')}`,
      plate: `${String(10 + (i % 89)).padStart(2, '0')}${letter}${String(100 + i).padStart(3, '0')}-63`,
      loaderTypeId,
      smartCardExpiry: yearLater,
      inspectionExpiry: yearLater,
      active: true,
    },
  });
}

/** Monthly quotas for this and next Jalali month (quota is mandatory — DECISIONS D12) + a shared loading location. */
async function seedCarrierOps(tenantId: string, carrierIds: string[], cityId: number): Promise<void> {
  const now = new Date();
  const months = [jalaliYearMonth(now), jalaliYearMonth(new Date(now.getTime() + 32 * 86_400_000))];
  for (const carrierId of carrierIds) {
    for (const yearMonth of months) {
      await prisma.carrierQuota.upsert({
        where: { carrierId_yearMonth: { carrierId, yearMonth } },
        update: {},
        create: { tenantId, carrierId, yearMonth, tonnageLimitKg: BigInt(D.MONTHLY_QUOTA_KG) },
      });
    }
  }
  const found = await prisma.loadingLocation.findFirst({ where: { tenantId, carrierId: null, name: D.FACTORY_LOADING_LOCATION.name } });
  if (!found) await prisma.loadingLocation.create({ data: { tenantId, carrierId: null, cityId, ...D.FACTORY_LOADING_LOCATION } });
}

/**
 * 20 groups × 6 drivers of the demo carrier (GUIDELINES §2) plus the rotation state of the
 * reference scenario (§11 of the bulk spec): head = group 1, free cursor = group 2.
 */
async function seedBulkRotation(tenantId: string, carrierId: string): Promise<void> {
  const hall = await prisma.hall.findFirst({ where: { tenantId, title: D.HALLS.bulk.title } });
  if (!hall) return;
  const drivers = await prisma.driver.findMany({
    where: { tenantId, carrierId, status: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const needed = D.BULK_GROUPS * D.BULK_GROUP_SIZE;
  if (drivers.length < needed) return;
  const today = isoDay(new Date(`${localDate(new Date())}T00:00:00.000Z`));
  const groups: { id: string; memberIds: string[] }[] = [];
  for (let g = 1; g <= D.BULK_GROUPS; g += 1) {
    const title = `${D.BULK_GROUP_TITLE_PREFIX} ${g}`;
    const found = await prisma.bulkGroup.findFirst({ where: { tenantId, carrierId, hallId: hall.id, title } });
    const group =
      found ??
      (await prisma.bulkGroup.create({
        data: { tenantId, carrierId, hallId: hall.id, title, sortOrder: g - 1 },
      }));
    const memberIds = drivers.slice((g - 1) * D.BULK_GROUP_SIZE, g * D.BULK_GROUP_SIZE).map((d) => d.id);
    for (const driverId of memberIds) {
      const exists = await prisma.bulkGroupMember.findFirst({ where: { groupId: group.id, driverId } });
      if (!exists) {
        await prisma.bulkGroupMember.create({ data: { tenantId, groupId: group.id, driverId, effectiveFrom: today } });
      }
    }
    groups.push({ id: group.id, memberIds });
  }
  const state = await prisma.bulkRotationState.findUnique({
    where: { carrierId_hallId: { carrierId, hallId: hall.id } },
  });
  if (!state) {
    const head = groups[0];
    const cursor = groups[1];
    if (head && cursor) {
      await prisma.bulkRotationState.create({
        data: {
          tenantId,
          carrierId,
          hallId: hall.id,
          nextHeadGroupId: head.id,
          cursorGroupId: cursor.id,
          cursorRemaining: cursor.memberIds,
          cursorInitialized: true,
          settings: bulkCarrierSettings.parse({}),
        },
      });
    }
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  // Hash each distinct password once (argon2id is intentionally slow).
  const [factory, carrier, driver] = await Promise.all([
    hashPassword(D.PASSWORDS.factory),
    hashPassword(D.PASSWORDS.carrier),
    hashPassword(D.PASSWORDS.driver),
  ]);
  const tenantId = await seedTenant();
  const cityIds = await seedGeo(tenantId);
  const loaderIds = await seedMasterData(tenantId);
  await seedHalls(tenantId);
  const carrierIds = await seedOperators(tenantId, { factory, carrier });
  await seedCarrierOps(tenantId, carrierIds, cityIds.get('نی‌ریز')!);
  const ctx: DriverCtx = {
    tenantId,
    carrierIds,
    loaderIds,
    birthCityId: cityIds.get('نی‌ریز')!,
    passwordHash: driver,
    today: isoDay(new Date()),
  };
  for (let i = 1; i <= D.DRIVER_COUNT; i += 1) await seedDriver(ctx, i, 'APPROVED');
  await seedDriver(ctx, D.DRIVER_COUNT + 1, 'PENDING');
  await seedBulkRotation(tenantId, carrierIds[0]!);
  const drivers = await prisma.driver.count({ where: { tenantId } });
  const groups = await prisma.bulkGroup.count({ where: { tenantId } });
  console.log(
    `seed ok: tenant=${tenantId} drivers=${drivers} groups=${groups} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main()
  .catch((e: unknown) => {
    console.error('seed failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
