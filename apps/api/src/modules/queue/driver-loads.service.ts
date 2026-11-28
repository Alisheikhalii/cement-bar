/**
 * Driver load browsing (US-D5): cities → list → detail with live counts and a server-computed
 * `isReservable` / `blockReason`. The reservation endpoint re-checks everything atomically.
 */
import { Injectable } from '@nestjs/common';
import type { BulkWindow, Driver, Hall, HallDay, Prisma, Vehicle } from '@prisma/client';
import {
  localDate,
  type Allocation,
  type DriverLoadCityDto,
  type DriverLoadDto,
  type DriverLoadUnitDto,
  type HallCategory,
  type LoadBlockReason,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedDriver, type DriverScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { QueueEngineService } from './queue-engine.service';
import {
  dateOnlyIso,
  eligibilityError,
  freePolicy,
  hasActivePenalty,
  loaderGroupMatches,
  loadDriverContext,
  parseGroupsSnapshot,
  readBulkSettings,
  syncHallDayStatus,
  type EligibilityError,
} from './queue-support';

const ACTIVE_STATUSES = ['RESERVED', 'ARRIVED', 'LOADED', 'EXITED', 'CANCEL_REQUESTED'] as const;
const MAX_LOADS = 300;

interface EvalCtx {
  now: Date;
  driver: Driver;
  vehicle: Vehicle | null;
  eligibility: EligibilityError | null;
  penalized: boolean;
  hallById: Map<string, Hall>;
  dayByHall: Map<string, HallDay>;
  activeFreeCount: number;
  driverCarrierId: string;
  inGroup: boolean;
  window: BulkWindow | null;
  windowEligible: boolean;
  windowAlreadyReserved: boolean;
  groupLoadsToday: number;
  groupMaxLoads: number;
}

type AnnouncementWithUnits = Prisma.AnnouncementGetPayload<{ include: { units: true } }>;

@Injectable()
export class DriverLoadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly engine: QueueEngineService,
  ) {}

  private get db(): PrismaTx {
    return this.prisma;
  }

  // ───────────────────────── GET /driver/loads/cities ─────────────────────────
  async cities(user: AuthUser, hallCategory: HallCategory | undefined): Promise<DriverLoadCityDto[]> {
    const scope = scopedDriver(user);
    const ctx = await this.buildContext(scope);
    const today = localDate(ctx.now);
    const halls = [...ctx.hallById.values()].filter((h) => !hallCategory || h.category === hallCategory);
    const hallIds = halls.map((h) => h.id);
    if (hallIds.length === 0) return [];
    const loader = ctx.vehicle?.loaderTypeId;
    const rows = await this.prisma.announcement.findMany({
      where: {
        tenantId: scope.tenantId,
        status: 'ACTIVE',
        deletedAt: null,
        announceDate: today,
        hallId: { in: hallIds },
        ...(loader ? { OR: [{ loaderTypeId: loader }, { loaderType2Id: loader }] } : {}),
      },
      select: { id: true, destCityId: true, units: { select: { state: true } } },
    });
    const byCity = new Map<number, { total: number; open: number }>();
    for (const a of rows) {
      if (a.destCityId === null) continue;
      const agg = byCity.get(a.destCityId) ?? { total: 0, open: 0 };
      agg.total += 1;
      if (a.units.some((u) => u.state === 'OPEN')) agg.open += 1;
      byCity.set(a.destCityId, agg);
    }
    if (byCity.size === 0) return [];
    const cities = await this.prisma.city.findMany({
      where: { id: { in: [...byCity.keys()] } },
      select: { id: true, name: true, province: { select: { name: true } } },
    });
    return cities
      .map((c) => ({
        cityId: c.id,
        cityName: c.name,
        provinceName: c.province.name,
        total: byCity.get(c.id)?.total ?? 0,
        open: byCity.get(c.id)?.open ?? 0,
      }))
      .sort((a, b) => a.cityName.localeCompare(b.cityName, 'fa'));
  }

  // ───────────────────────── GET /driver/loads ─────────────────────────
  async list(
    user: AuthUser,
    filters: { cityId?: number; hallCategory?: HallCategory; allocation?: Allocation; carrierId?: string; q?: string; compatible: boolean },
  ): Promise<DriverLoadDto[]> {
    const scope = scopedDriver(user);
    const ctx = await this.buildContext(scope);
    const today = localDate(ctx.now);
    const halls = [...ctx.hallById.values()].filter((h) => !filters.hallCategory || h.category === filters.hallCategory);
    const hallIds = halls.map((h) => h.id);
    if (hallIds.length === 0) return [];

    const and: Prisma.AnnouncementWhereInput[] = [
      { tenantId: scope.tenantId, status: 'ACTIVE', deletedAt: null, announceDate: today, hallId: { in: hallIds } },
    ];
    if (filters.cityId !== undefined) and.push({ destCityId: filters.cityId });
    if (filters.carrierId) and.push({ carrierId: filters.carrierId });
    const loader = ctx.vehicle?.loaderTypeId;
    if (filters.compatible && loader) and.push({ OR: [{ loaderTypeId: loader }, { loaderType2Id: loader }] });
    if (filters.q) {
      const q = filters.q;
      const or: Prisma.AnnouncementWhereInput[] = [
        { description: { contains: q, mode: 'insensitive' } },
        { senderName: { contains: q, mode: 'insensitive' } },
        { receiverName: { contains: q, mode: 'insensitive' } },
      ];
      if (/^\d{1,9}$/.test(q)) or.push({ number: Number(q) });
      and.push({ OR: or });
    }
    if (filters.allocation) {
      and.push({ units: { some: { allocation: filters.allocation, state: { not: 'CANCELLED' } } } });
    }

    const anns = await this.prisma.announcement.findMany({
      where: { AND: and },
      include: { units: { orderBy: { seq: 'asc' } }, carrier: true },
      orderBy: [{ announceTime: 'desc' }, { number: 'desc' }],
      take: MAX_LOADS,
    });
    if (anns.length === 0) return [];
    const filled = await this.filledCounts(scope, anns.map((a) => a.id), ctx.driver.id);
    return this.toDtos(ctx, anns, filled);
  }

  // ───────────────────────── GET /driver/loads/:announcementId ─────────────────────────
  async detail(user: AuthUser, announcementId: string): Promise<DriverLoadDto> {
    const scope = scopedDriver(user);
    const ctx = await this.buildContext(scope);
    const a = await this.prisma.announcement.findFirst({
      where: { id: announcementId, tenantId: scope.tenantId, status: 'ACTIVE', deletedAt: null },
      include: { units: { orderBy: { seq: 'asc' } }, carrier: true },
    });
    if (!a) throw new DomainError('NOT_FOUND');
    const filled = await this.filledCounts(scope, [a.id], ctx.driver.id);
    const [dto] = await this.toDtos(ctx, [a], filled, true);
    return dto!;
  }

  // ───────────────────────── context & builders ─────────────────────────
  private async buildContext(scope: DriverScope): Promise<EvalCtx> {
    const now = this.clock.now();
    const today = localDate(now);
    const { driver, vehicle } = await loadDriverContext(this.db, scope.tenantId, scope.driverId);
    const eligibility = eligibilityError(driver, vehicle, true, today);
    const penalized = !eligibility && (await hasActivePenalty(this.db, scope.tenantId, scope.driverId, now));

    const halls = await this.prisma.hall.findMany({ where: { tenantId: scope.tenantId, active: true } });
    const hallById = new Map(halls.map((h) => [h.id, h]));
    const days = await this.prisma.hallDay.findMany({ where: { tenantId: scope.tenantId, date: today } });
    const dayByHall = new Map<string, HallDay>();
    for (const d of days) dayByHall.set(d.hallId, await syncHallDayStatus(this.db, d, now));

    // Fresh bulk windows for the driver's own carrier (lazy advance).
    let window: BulkWindow | null = null;
    let inGroup = false;
    let groupLoadsToday = 0;
    let groupMaxLoads = 2;
    const bulkHall = halls.find((h) => h.category === 'BULK');
    const bulkDayRow = bulkHall ? dayByHall.get(bulkHall.id) : undefined;
    if (bulkHall && bulkDayRow) {
      await this.prisma.$transaction(
        async (tx) => {
          const fresh = await tx.hallDay.findUniqueOrThrow({ where: { id: bulkDayRow.id } });
          await this.engine.advanceBulkTx(tx, driver.carrierId, fresh, now);
        },
        { timeout: TX_TIMEOUT_MS },
      );
      const updated = await this.prisma.hallDay.findUniqueOrThrow({ where: { id: bulkDayRow.id } });
      dayByHall.set(bulkHall.id, updated);
      const bulkDay = await this.prisma.bulkDay.findUnique({
        where: { carrierId_hallDayId: { carrierId: driver.carrierId, hallDayId: bulkDayRow.id } },
      });
      if (bulkDay) {
        const groups = parseGroupsSnapshot(bulkDay.membersSnapshot);
        inGroup = groups.some((g) => g.memberIds.includes(scope.driverId));
        window = await this.prisma.bulkWindow.findFirst({
          where: { bulkDayId: bulkDay.id, closedAt: null },
          orderBy: { seq: 'desc' },
        });
        groupLoadsToday = await this.prisma.reservation.count({
          where: { tenantId: scope.tenantId, driverId: scope.driverId, status: { not: 'CANCELLED' }, bulkWindow: { is: { bulkDayId: bulkDay.id } } },
        });
        const rotation = await this.prisma.bulkRotationState.findUnique({
          where: { carrierId_hallId: { carrierId: driver.carrierId, hallId: bulkHall.id } },
        });
        groupMaxLoads = rotation ? readBulkSettings(rotation.settings).maxLoadsPerDriverPerDay : 2;
      }
    }

    const activeFreeCount = await this.prisma.reservation.count({
      where: { tenantId: scope.tenantId, driverId: scope.driverId, source: 'FREE', status: { in: [...ACTIVE_STATUSES] } },
    });
    const windowAlreadyReserved = window
      ? (await this.prisma.reservation.count({ where: { bulkWindowId: window.id, driverId: scope.driverId, status: { not: 'CANCELLED' } } })) > 0
      : false;

    return {
      now,
      driver,
      vehicle,
      eligibility,
      penalized,
      hallById,
      dayByHall,
      activeFreeCount,
      driverCarrierId: driver.carrierId,
      inGroup,
      window,
      windowEligible: window ? window.eligible.includes(scope.driverId) : false,
      windowAlreadyReserved,
      groupLoadsToday,
      groupMaxLoads,
    };
  }

  private async filledCounts(
    scope: DriverScope,
    announcementIds: string[],
    driverId: string,
  ): Promise<Map<string, { reserved: number; mine: string | null }>> {
    const rows = await this.prisma.reservation.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] }, unit: { announcementId: { in: announcementIds } } },
      select: { unitId: true, driverId: true, unit: { select: { announcementId: true } } },
    });
    const out = new Map<string, { reserved: number; mine: string | null }>();
    for (const id of announcementIds) out.set(id, { reserved: 0, mine: null });
    for (const r of rows) {
      const agg = out.get(r.unit.announcementId)!;
      agg.reserved += 1;
      if (r.driverId === driverId) agg.mine = r.unitId;
    }
    return out;
  }

  private baseAllocation(units: AnnouncementWithUnits['units'], hall: Hall | undefined): Allocation {
    const nonCancelled = units.filter((u) => u.state !== 'CANCELLED');
    if (nonCancelled.length === 0) return hall?.defaultAllocation ?? 'FREE';
    // The announcement's allocation is its first unit's allocation; mixed manual releases show FREE.
    const first = units.find((u) => u.seq === 1) ?? units[0]!;
    return first.allocation;
  }

  private async toDtos(
    ctx: EvalCtx,
    anns: (AnnouncementWithUnits & { carrier: { name: string } })[],
    filled: Map<string, { reserved: number; mine: string | null }>,
    withUnits = false,
  ): Promise<DriverLoadDto[]> {
    const cache = {
      products: new Map<string, string>(),
      packagings: new Map<string, string>(),
      loaders: new Map<string, string>(),
      cities: new Map<number, string>(),
      destinations: new Map<string, string>(),
    };
    const out: DriverLoadDto[] = [];
    for (const a of anns) {
      const hall = ctx.hallById.get(a.hallId);
      const day = ctx.dayByHall.get(a.hallId) ?? null;
      const openUnits = a.units.filter((u) => u.state === 'OPEN').length;
      const nonCancelled = a.units.filter((u) => u.state !== 'CANCELLED');
      const reserved = filled.get(a.id)?.reserved ?? 0;
      const allocation = this.baseAllocation(a.units, hall);
      const fullyReserved = openUnits === 0 && nonCancelled.length > 0;
      const { isReservable, blockReason } = await this.evaluate(ctx, a, hall, day, allocation, openUnits);
      const unitDtos: DriverLoadUnitDto[] | undefined = withUnits
        ? a.units.map((u) => ({
            id: u.id,
            seq: u.seq,
            allocation: u.allocation,
            state: u.state,
            reservedByMe: u.id === filled.get(a.id)?.mine,
          }))
        : undefined;
      out.push({
        id: a.id,
        number: a.number,
        carrierId: a.carrierId,
        carrierName: a.carrier.name,
        hallId: a.hallId,
        hallTitle: hall?.title ?? '',
        hallCategory: hall?.category ?? 'BAG',
        productTitle: await titleOf(this.prisma, 'product', a.productId, cache.products),
        packagingTitle: await titleOf(this.prisma, 'packaging', a.packagingTypeId, cache.packagings),
        loaderTitles: [
          await titleOf(this.prisma, 'loader', a.loaderTypeId, cache.loaders),
          ...(a.loaderType2Id ? [await titleOf(this.prisma, 'loader', a.loaderType2Id, cache.loaders)] : []),
        ].filter((t) => t.length > 0),
        destinationTitle: await destinationOf(this.prisma, a, cache),
        originTitle: a.originCityId !== null ? await cityOf(this.prisma, a.originCityId, cache.cities) : '',
        announceDate: a.announceDate,
        announceTime: a.announceTime,
        truckCount: a.truckCount,
        weightFromKg: a.weightFromKg,
        weightToKg: a.weightToKg,
        fareRial: fareOf(a),
        allocation,
        totalUnits: a.units.length,
        openUnits,
        reservedUnits: reserved,
        fullyReserved,
        myReservedUnitId: filled.get(a.id)?.mine ?? null,
        isReservable,
        blockReason,
        ...(unitDtos ? { units: unitDtos } : {}),
      });
    }
    return out;
  }

  private async evaluate(
    ctx: EvalCtx,
    a: AnnouncementWithUnits,
    hall: Hall | undefined,
    day: HallDay | null,
    allocation: Allocation,
    openUnits: number,
  ): Promise<{ isReservable: boolean; blockReason: LoadBlockReason | null }> {
    if (ctx.eligibility) return { isReservable: false, blockReason: ctx.eligibility };
    if (ctx.penalized) return { isReservable: false, blockReason: 'DRIVER_PENALIZED' };
    if (!hall || !day) return { isReservable: false, blockReason: 'HALL_NOT_OPEN' };
    if (day.status === 'HALTED') return { isReservable: false, blockReason: 'HALL_HALTED' };
    if (day.status !== 'OPEN' && day.status !== 'ALLOCATING') return { isReservable: false, blockReason: 'HALL_NOT_OPEN' };
    if (ctx.now < day.t0At) return { isReservable: false, blockReason: 'HALL_NOT_OPEN' };
    if (ctx.now >= day.hallEndAt) return { isReservable: false, blockReason: 'HALL_NOT_OPEN' };
    if (openUnits <= 0) return { isReservable: false, blockReason: 'NO_UNIT_AVAILABLE' };

    const loader = ctx.vehicle?.loaderTypeId;
    const matches = loader ? loaderGroupMatches(a, loader) : false;

    if (allocation === 'TIMED') return { isReservable: false, blockReason: 'WINDOW_CLOSED' };
    if (allocation === 'FREE') {
      if (!matches) return { isReservable: false, blockReason: 'LOADER_MISMATCH' };
      const fp = await freePolicy(this.db, hall.id);
      if (ctx.activeFreeCount >= fp.maxActiveFreeReservations) return { isReservable: false, blockReason: 'ACTIVE_FREE_LIMIT' };
      return { isReservable: true, blockReason: null };
    }
    // GROUP
    if (a.carrierId !== ctx.driverCarrierId) return { isReservable: false, blockReason: 'NOT_IN_GROUP' };
    if (!matches) return { isReservable: false, blockReason: 'LOADER_MISMATCH' };
    if (!ctx.inGroup) return { isReservable: false, blockReason: 'NOT_IN_GROUP' };
    if (!ctx.window || !ctx.windowEligible) return { isReservable: false, blockReason: 'WINDOW_CLOSED' };
    if (ctx.windowAlreadyReserved) return { isReservable: false, blockReason: 'ONE_PER_WINDOW' };
    if (ctx.groupLoadsToday >= ctx.groupMaxLoads) return { isReservable: false, blockReason: 'DAILY_LIMIT_REACHED' };
    return { isReservable: true, blockReason: null };
  }
}

// ───────── small title helpers (cached per request) ─────────
async function titleOf(
  db: PrismaTx,
  kind: 'product' | 'packaging' | 'loader',
  id: string,
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(id)) return cache.get(id)!;
  const title =
    kind === 'product'
      ? (await db.product.findUnique({ where: { id }, select: { title: true } }))?.title
      : kind === 'packaging'
        ? (await db.packagingType.findUnique({ where: { id }, select: { title: true } }))?.title
        : (await db.loaderType.findUnique({ where: { id }, select: { title: true } }))?.title;
  const value = title ?? '';
  cache.set(id, value);
  return value;
}

async function cityOf(db: PrismaTx, id: number, cache: Map<number, string>): Promise<string> {
  if (cache.has(id)) return cache.get(id)!;
  const name = (await db.city.findUnique({ where: { id }, select: { name: true } }))?.name ?? '';
  cache.set(id, name);
  return name;
}

async function destinationOf(
  db: PrismaTx,
  a: { destinationId: string | null; destCityId: number | null },
  cache: { cities: Map<number, string>; destinations: Map<string, string> },
): Promise<string> {
  if (a.destinationId) {
    if (!cache.destinations.has(a.destinationId)) {
      const t = (await db.destination.findUnique({ where: { id: a.destinationId }, select: { title: true } }))?.title ?? '';
      cache.destinations.set(a.destinationId, t);
    }
    return cache.destinations.get(a.destinationId)!;
  }
  return a.destCityId !== null ? cityOf(db, a.destCityId, cache.cities) : '';
}

function fareOf(a: { fareCalc: string; farePerTruck: bigint | null; ratePerTon: bigint | null; weightToKg: number }): string | null {
  if (a.fareCalc === 'PER_TRUCK') return a.farePerTruck !== null ? a.farePerTruck.toString() : null;
  if (a.ratePerTon === null) return null;
  return ((a.ratePerTon * BigInt(a.weightToKg)) / 1000n).toString();
}

export { dateOnlyIso };
