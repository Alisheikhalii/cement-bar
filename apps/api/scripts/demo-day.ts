/**
 * `pnpm demo:day` — a full virtual hall day on the seeded dev database, driven through the real
 * services with a FakeClock (PLAN §P3 acceptance). Fast and repeatable: the demo uses tomorrow's
 * date and removes only hall days it created itself (`policy_snapshot.demo = true`).
 *
 *  1. BAG: 120 drivers register a turn, choose one priority, then the allocation job runs.
 *  2. BULK: the 20×6 rotation of the demo carrier runs window by window; eligible drivers reserve
 *     a compatible load until the loads run out.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { addDaysIso, localDate, localDateTimeToUtc } from '@cb/shared';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/common/auth/auth.decorators';
import { ClockService, FakeClock } from '../src/common/clock/clock.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { loadDotEnv } from '../src/config/app-config';
import { DriverQueueService } from '../src/modules/queue/driver-queue.service';
import { DriverReservationsService } from '../src/modules/queue/driver-reservations.service';
import { QueueEngineService } from '../src/modules/queue/queue-engine.service';

loadDotEnv();
// The 5s scheduler would race the simulation; the demo drives the engine explicitly.
process.env.NODE_ENV = 'test';

interface DemoDriver {
  driverId: string;
  userId: string;
  loaderTypeId: string;
}

interface DemoAnnouncement {
  id: string;
  loaderTypeId: string;
}

interface Master {
  cityId: number;
  productId: string;
  bagPackagingTypeId: string;
  bulkPackagingTypeId: string;
  loadingLocationId: string;
  loaderIds: string[];
}

interface DayArgs {
  tenantId: string;
  carrierId: string;
  hallId: string;
  date: string;
  drivers: DemoDriver[];
  master: Master;
}

function userOf(tenantId: string, d: DemoDriver): AuthUser {
  return { id: d.userId, role: 'DRIVER', tenantId, driverId: d.driverId, sid: 'demo' };
}

async function nextCounter(prisma: PrismaService, tenantId: string, name: string): Promise<number> {
  const c = await prisma.counter.upsert({
    where: { tenantId_name: { tenantId, name } },
    create: { tenantId, name, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return c.value;
}

interface AnnouncementSeed {
  tenantId: string;
  carrierId: string;
  hallId: string;
  hallDayId: string;
  date: string;
  loaderTypeId: string;
  packagingTypeId: string;
  cityId: number;
  productId: string;
  loadingLocationId: string;
  allocation: 'TIMED' | 'GROUP';
  units: number;
  description: string;
}

async function createAnnouncement(prisma: PrismaService, s: AnnouncementSeed): Promise<DemoAnnouncement> {
  const number = await nextCounter(prisma, s.tenantId, 'announcement');
  const a = await prisma.announcement.create({
    data: {
      tenantId: s.tenantId,
      carrierId: s.carrierId,
      hallId: s.hallId,
      hallDayId: s.hallDayId,
      number,
      status: 'ACTIVE',
      announceDate: s.date,
      announceTime: '08:00',
      destCityId: s.cityId,
      productId: s.productId,
      packagingTypeId: s.packagingTypeId,
      cargoValue: 0n,
      loadingLocationId: s.loadingLocationId,
      fareCalc: 'PER_TRUCK',
      loaderTypeId: s.loaderTypeId,
      truckCount: s.units,
      weightFromKg: 0,
      weightToKg: 0,
      destFareType: 'عادی',
      farePerTruck: 100n,
      description: s.description,
    },
  });
  await prisma.loadUnit.createMany({
    data: Array.from({ length: s.units }, (_, i) => ({
      tenantId: s.tenantId,
      announcementId: a.id,
      seq: i + 1,
      allocation: s.allocation,
    })),
  });
  return { id: a.id, loaderTypeId: s.loaderTypeId };
}

async function createAnnouncementsFor(
  prisma: PrismaService,
  args: DayArgs,
  hallDayId: string,
  allocation: 'TIMED' | 'GROUP',
  packagingTypeId: string,
): Promise<Map<string, DemoAnnouncement>> {
  const out = new Map<string, DemoAnnouncement>();
  for (const [i, loaderTypeId] of args.master.loaderIds.entries()) {
    const units = args.drivers.filter((d) => d.loaderTypeId === loaderTypeId).length;
    if (units === 0) continue;
    const ann = await createAnnouncement(prisma, {
      tenantId: args.tenantId,
      carrierId: args.carrierId,
      hallId: args.hallId,
      hallDayId,
      date: args.date,
      loaderTypeId,
      packagingTypeId,
      cityId: args.master.cityId,
      productId: args.master.productId,
      loadingLocationId: args.master.loadingLocationId,
      allocation,
      units,
      description: `${allocation === 'TIMED' ? 'بار کیسه‌ای' : 'بار فله'} ${i + 1}`,
    });
    out.set(loaderTypeId, ann);
  }
  return out;
}

/** Removes only the hall days this script created (`policy_snapshot.demo = true`) for `date`. */
async function clearDemoDays(prisma: PrismaService, hallIds: string[], date: string): Promise<void> {
  const days = await prisma.hallDay.findMany({
    where: { hallId: { in: hallIds }, date, policySnapshot: { path: ['demo'], equals: true } },
    select: { id: true },
  });
  const ids = days.map((d) => d.id);
  if (ids.length === 0) return;
  const reservations = await prisma.reservation.findMany({ where: { hallDayId: { in: ids } }, select: { id: true } });
  const rIds = reservations.map((r) => r.id);
  if (rIds.length > 0) {
    await prisma.cancelRequest.deleteMany({ where: { reservationId: { in: rIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: rIds } } });
  }
  await prisma.bagTurn.deleteMany({ where: { hallDayId: { in: ids } } });
  await prisma.bulkWindow.deleteMany({ where: { bulkDay: { is: { hallDayId: { in: ids } } } } });
  await prisma.bulkDay.deleteMany({ where: { hallDayId: { in: ids } } });
  await prisma.allocationRun.deleteMany({ where: { hallDayId: { in: ids } } });
  const announcements = await prisma.announcement.findMany({ where: { hallDayId: { in: ids } }, select: { id: true } });
  const aIds = announcements.map((a) => a.id);
  if (aIds.length > 0) {
    const units = await prisma.loadUnit.findMany({ where: { announcementId: { in: aIds } }, select: { id: true } });
    await prisma.loadUnitAllocationChange.deleteMany({ where: { unitId: { in: units.map((u) => u.id) } } });
    await prisma.loadUnit.deleteMany({ where: { announcementId: { in: aIds } } });
    await prisma.announcement.deleteMany({ where: { id: { in: aIds } } });
  }
  await prisma.hallDay.deleteMany({ where: { id: { in: ids } } });
}

async function runBagDay(prisma: PrismaService, clock: FakeClock, queue: DriverQueueService, args: DayArgs): Promise<void> {
  const t0 = localDateTimeToUtc(args.date, '06:30');
  const priorityEnd = localDateTimeToUtc(args.date, '06:46');
  const hallEnd = localDateTimeToUtc(args.date, '14:00');
  clock.set(t0);
  const day = await prisma.hallDay.create({
    data: {
      tenantId: args.tenantId,
      hallId: args.hallId,
      date: args.date,
      t0At: t0,
      priorityEndAt: priorityEnd,
      hallEndAt: hallEnd,
      status: 'OPEN',
      policySnapshot: { demo: true },
    },
  });
  const byLoader = await createAnnouncementsFor(prisma, args, day.id, 'TIMED', args.master.bagPackagingTypeId);
  let registered = 0;
  for (const d of args.drivers) {
    const user = userOf(args.tenantId, d);
    try {
      await queue.registerTurn(user);
      const ann = byLoader.get(d.loaderTypeId);
      if (ann) await queue.setPriorities(user, { announcementIds: [ann.id] });
      registered += 1;
    } catch (e) {
      console.warn(`  bag turn skipped: ${(e as Error).message}`);
    }
  }
  clock.set(new Date(priorityEnd.getTime() + 1000));
  await queue.bag(userOf(args.tenantId, args.drivers[0]!)); // lazy fallback runs the allocation job
  const [allocated, notAllocated, openTimed] = await Promise.all([
    prisma.bagTurn.count({ where: { hallDayId: day.id, status: 'ALLOCATED' } }),
    prisma.bagTurn.count({ where: { hallDayId: day.id, status: 'NOT_ALLOCATED' } }),
    prisma.loadUnit.count({
      where: { allocation: 'TIMED', state: 'OPEN', announcement: { is: { hallId: args.hallId, status: 'ACTIVE' } } },
    }),
  ]);
  console.log(`\n📦 سالن کیسه‌ای — ${args.date}`);
  console.log(`  ثبت نوبت: ${registered} | تخصیص‌یافته: ${allocated} | تخصیص‌نیافته: ${notAllocated} | مانده TIMED: ${openTimed}`);
}

async function runBulkDay(
  prisma: PrismaService,
  clock: FakeClock,
  engine: QueueEngineService,
  reservations: DriverReservationsService,
  args: DayArgs,
): Promise<void> {
  const t0 = localDateTimeToUtc(args.date, '07:00');
  const hallEnd = localDateTimeToUtc(args.date, '14:00');
  clock.set(t0);
  const day = await prisma.hallDay.create({
    data: {
      tenantId: args.tenantId,
      hallId: args.hallId,
      date: args.date,
      t0At: t0,
      priorityEndAt: null,
      hallEndAt: hallEnd,
      status: 'OPEN',
      policySnapshot: { demo: true },
    },
  });
  const groupAnn = await createAnnouncementsFor(prisma, args, day.id, 'GROUP', args.master.bulkPackagingTypeId);
  const driverUser = new Map(args.drivers.map((d) => [d.driverId, userOf(args.tenantId, d)]));
  const driverLoader = new Map(args.drivers.map((d) => [d.driverId, d.loaderTypeId]));

  let reservedTotal = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.hallDay.findUniqueOrThrow({ where: { id: day.id } });
      await engine.advanceBulkTx(tx, args.carrierId, fresh, clock.now());
    });
    const bulkDay = await prisma.bulkDay.findFirst({ where: { carrierId: args.carrierId, hallDayId: day.id }, select: { id: true } });
    if (!bulkDay) break;
    const window = await prisma.bulkWindow.findFirst({
      where: { bulkDayId: bulkDay.id, closedAt: null },
      orderBy: { seq: 'desc' },
    });
    if (!window || clock.now() >= day.hallEndAt) break;
    let took = 0;
    for (const driverId of window.eligible) {
      const loaderTypeId = driverLoader.get(driverId);
      const ann = loaderTypeId ? groupAnn.get(loaderTypeId) : undefined;
      const user = driverUser.get(driverId);
      if (!ann || !user) continue;
      try {
        await reservations.create(user, { announcementId: ann.id, idempotencyKey: randomUUID() });
        took += 1;
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (
          code === 'NO_UNIT_AVAILABLE' ||
          code === 'UNIT_TAKEN' ||
          code === 'WINDOW_CLOSED' ||
          code === 'DAILY_LIMIT_REACHED'
        )
          break;
      }
    }
    reservedTotal += took;
    if (took === 0) clock.set(new Date(Math.max(clock.now().getTime(), window.closesAt.getTime() + 1000)));
  }

  const bulkDay = await prisma.bulkDay.findFirst({ where: { carrierId: args.carrierId, hallDayId: day.id }, select: { id: true } });
  const windows = bulkDay
    ? await prisma.bulkWindow.findMany({
        where: { bulkDayId: bulkDay.id },
        orderBy: { seq: 'asc' },
        select: { kind: true, round: true, burned: true },
      })
    : [];
  const cursor = await prisma.bulkRotationState.findFirst({ where: { carrierId: args.carrierId, hallId: args.hallId } });
  const openUnits = await prisma.loadUnit.count({
    where: { allocation: 'GROUP', state: 'OPEN', announcement: { is: { hallId: args.hallId, status: 'ACTIVE' } } },
  });
  const burned = windows.reduce((n, w) => n + w.burned.length, 0);
  console.log(`\n🚛 سالن فله — ${args.date}`);
  console.log(`  پنجره‌ها: ${windows.length} | رزروها: ${reservedTotal} | دور پایانی: ${windows.at(-1)?.round ?? 1} | مانده GROUP: ${openUnits}`);
  console.log(`  نوبت‌های سوخته: ${burned} | نشانگر پایان روز: ${cursor?.cursorGroupId ?? '—'} با ${cursor?.cursorRemaining.length ?? 0} عضو باقی‌مانده`);
  console.log(`  (شبیه‌سازی با FakeClock؛ بدون انتظار واقعی)`);
}

async function main(): Promise<void> {
  const realNow = new Date();
  const date = addDaysIso(localDate(realNow), 1);
  const clock = new FakeClock(realNow);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ClockService)
    .useValue(clock)
    .compile();
  await moduleRef.init();
  const prisma = moduleRef.get(PrismaService);
  try {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: 'سیمان خاکستری نی‌ریز' } });
    const [bagHall, bulkHall] = await Promise.all([
      prisma.hall.findFirstOrThrow({ where: { tenantId: tenant.id, category: 'BAG', active: true } }),
      prisma.hall.findFirstOrThrow({ where: { tenantId: tenant.id, category: 'BULK', active: true } }),
    ]);
    const carrier = await prisma.carrier.findFirstOrThrow({ where: { tenantId: tenant.id, code: '101' } });
    const [city, product, bagPackaging, bulkPackaging, location] = await Promise.all([
      prisma.city.findFirstOrThrow({ where: { name: 'نی‌ریز' } }),
      prisma.product.findFirstOrThrow({ where: { tenantId: tenant.id } }),
      prisma.packagingType.findFirstOrThrow({ where: { tenantId: tenant.id, category: 'BAG' } }),
      prisma.packagingType.findFirstOrThrow({ where: { tenantId: tenant.id, category: 'BULK' } }),
      prisma.loadingLocation.findFirstOrThrow({ where: { tenantId: tenant.id } }),
    ]);
    const loaderIds = (
      await prisma.loaderType.findMany({ where: { tenantId: tenant.id, code: { in: ['FLATBED', 'BUNKER'] } }, select: { id: true } })
    ).map((l) => l.id);

    const rows = await prisma.driver.findMany({
      where: { tenantId: tenant.id, carrierId: carrier.id, status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, vehicles: { where: { active: true }, select: { loaderTypeId: true }, take: 1 } },
    });
    const drivers: DemoDriver[] = rows
      .filter((d) => d.vehicles[0])
      .map((d) => ({ driverId: d.id, userId: d.userId, loaderTypeId: d.vehicles[0]!.loaderTypeId }));
    if (drivers.length === 0) throw new Error('seed data missing: run `pnpm db:seed` first');

    const master: Master = {
      cityId: city.id,
      productId: product.id,
      bagPackagingTypeId: bagPackaging.id,
      bulkPackagingTypeId: bulkPackaging.id,
      loadingLocationId: location.id,
      loaderIds,
    };
    await clearDemoDays(prisma, [bagHall.id, bulkHall.id], date);
    console.log(`🌅 شبیه‌سازی یک روز سالن اعلام بار — ${date} (${drivers.length} راننده)`);

    const queue = moduleRef.get(DriverQueueService);
    const reservations = moduleRef.get(DriverReservationsService);
    const engine = moduleRef.get(QueueEngineService);
    await runBagDay(prisma, clock, queue, {
      tenantId: tenant.id,
      carrierId: carrier.id,
      hallId: bagHall.id,
      date,
      drivers,
      master,
    });
    await runBulkDay(prisma, clock, engine, reservations, {
      tenantId: tenant.id,
      carrierId: carrier.id,
      hallId: bulkHall.id,
      date,
      drivers,
      master,
    });
  } finally {
    await moduleRef.close();
  }
}

main().catch((err: unknown) => {
  console.error('demo:day failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
