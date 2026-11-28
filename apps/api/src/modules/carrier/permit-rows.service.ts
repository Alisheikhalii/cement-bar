import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ARCHIVED_RESERVATION_STATUSES,
  PERMIT_COLUMNS,
  RESERVATION_STATUSES,
  parsePlate,
  type PermitView,
  type ReservationStatus,
  type TableRow,
} from '@cb/shared';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import type { ParsedList } from '../../common/list/list-query';
import { extraCells } from '../../common/list/list-response';
import { PrismaService } from '../../common/prisma/prisma.service';

export const permitInclude = {
  unit: { include: { announcement: { include: { carrier: true } } } },
  driver: { include: { user: { select: { mobile: true } }, vehicles: { where: { active: true }, take: 1 } } },
} satisfies Prisma.ReservationInclude;
export type PermitEntity = Prisma.ReservationGetPayload<{ include: typeof permitInclude }>;

const ARCHIVED = ARCHIVED_RESERVATION_STATUSES as ReservationStatus[];
const ACTIVE = RESERVATION_STATUSES.filter((s) => !ARCHIVED.includes(s));

/** Fare of ONE permit (one truck) in rial. */
export function permitFare(a: { fareCalc: string; farePerTruck: bigint | null; ratePerTon: bigint | null; weightToKg: number }): bigint | null {
  if (a.fareCalc === 'PER_TRUCK') return a.farePerTruck;
  // ASSUMPTION(Q-F-4): a per-ton fare is valued at the announced maximum weight (weightToKg, as in
  // the D12 quota formula), truncated to whole rial. Report-only value; no money is moved.
  if (a.ratePerTon === null) return null;
  return (a.ratePerTon * BigInt(a.weightToKg)) / 1000n;
}

const byIds = <T extends { id: string | number }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
const uniq = <T>(v: (T | null | undefined)[]): T[] => [...new Set(v.filter((x): x is T => x !== null && x !== undefined))];

/**
 * Builds permit (= reservation) table rows from the shared PERMIT_COLUMNS config. Used by
 * /carrier/permits and by the carrier/factory reports. Scope is ALWAYS supplied by the caller
 * from the session (tenantId, and carrierId for carriers).
 */
@Injectable()
export class PermitRowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
  ) {}

  where(scope: { tenantId: string; carrierId?: string }, p: ParsedList, view?: PermitView): Prisma.ReservationWhereInput {
    const and: Prisma.ReservationWhereInput[] = [{ tenantId: scope.tenantId }, ...(p.where as Prisma.ReservationWhereInput[])];
    if (scope.carrierId) and.push({ carrierId: scope.carrierId });
    if (view === 'active') and.push({ status: { in: ACTIVE } });
    if (view === 'archived') and.push({ status: { in: ARCHIVED } });
    if (p.q) {
      const q = p.q;
      const or: Prisma.ReservationWhereInput[] = [
        { driver: { firstName: { contains: q, mode: 'insensitive' } } },
        { driver: { lastName: { contains: q, mode: 'insensitive' } } },
        { driver: { user: { mobile: { contains: q } } } },
        { driver: { vehicles: { some: { active: true, plate: { contains: q } } } } },
      ];
      if (/^\d{1,9}$/.test(q)) or.push({ permitNo: Number(q) }, { unit: { announcement: { number: Number(q) } } });
      and.push({ OR: or });
    }
    return { AND: and };
  }

  async list(where: Prisma.ReservationWhereInput, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        include: permitInclude,
        orderBy: p.orderBy.length ? (p.orderBy as Prisma.ReservationOrderByWithRelationInput[]) : [{ reservedAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.reservation.count({ where }),
    ]);
    return { rows: await this.toRows(items), total };
  }

  private decrypt(enc: string | null | undefined): string | null {
    if (!enc) return null;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return null;
    }
  }

  async toRows(items: PermitEntity[]): Promise<TableRow[]> {
    const anns = items.map((r) => r.unit.announcement);
    const vehicles = items.map((r) => r.driver.vehicles[0]);
    const [halls, products, packagings, loaders, cities, destinations, owners, turns] = await Promise.all([
      this.prisma.hall.findMany({ where: { id: { in: uniq(anns.map((a) => a.hallId)) } }, select: { id: true, title: true } }),
      this.prisma.product.findMany({ where: { id: { in: uniq(anns.map((a) => a.productId)) } }, select: { id: true, title: true } }),
      this.prisma.packagingType.findMany({ where: { id: { in: uniq(anns.map((a) => a.packagingTypeId)) } }, select: { id: true, title: true } }),
      this.prisma.loaderType.findMany({
        where: { id: { in: uniq([...anns.map((a) => a.loaderTypeId), ...vehicles.map((v) => v?.loaderTypeId)]) } },
        select: { id: true, title: true },
      }),
      this.prisma.city.findMany({ where: { id: { in: uniq(anns.flatMap((a) => [a.originCityId, a.destCityId])) } } }),
      this.prisma.destination.findMany({ where: { id: { in: uniq(anns.map((a) => a.destinationId)) } }, select: { id: true, title: true } }),
      this.prisma.goodsOwner.findMany({ where: { id: { in: uniq(anns.map((a) => a.goodsOwnerId)) } }, select: { id: true, name: true } }),
      this.prisma.bagTurn.findMany({
        where: {
          OR: items
            .filter((r) => r.source === 'TIMED' && r.hallDayId)
            .map((r) => ({ hallDayId: r.hallDayId!, driverId: r.driverId })),
        },
        select: { hallDayId: true, driverId: true, turnNo: true, registeredAt: true },
      }),
    ]);
    const m = {
      halls: byIds(halls),
      products: byIds(products),
      packagings: byIds(packagings),
      loaders: byIds(loaders),
      cities: byIds(cities),
      destinations: byIds(destinations),
      owners: byIds(owners),
      turns: new Map(turns.map((t) => [`${t.hallDayId}:${t.driverId}`, t])),
    };
    return items.map((r) => this.toRow(r, m));
  }

  private toRow(
    r: PermitEntity,
    m: {
      halls: Map<string | number, { title: string }>;
      products: Map<string | number, { title: string }>;
      packagings: Map<string | number, { title: string }>;
      loaders: Map<string | number, { title: string }>;
      cities: Map<string | number, { name: string }>;
      destinations: Map<string | number, { title: string }>;
      owners: Map<string | number, { name: string }>;
      turns: Map<string, { turnNo: number; registeredAt: Date }>;
    },
  ): TableRow {
    const a = r.unit.announcement;
    const c = a.carrier;
    const d = r.driver;
    const v = d.vehicles[0];
    const turn = r.hallDayId ? m.turns.get(`${r.hallDayId}:${r.driverId}`) : undefined;
    const plate = v ? parsePlate(v.plate) : null;
    const fare = permitFare(a);
    const destination = (a.destinationId ? m.destinations.get(a.destinationId)?.title : undefined)
      ?? (a.destCityId !== null ? m.cities.get(a.destCityId)?.name : undefined) ?? null;
    return {
      id: r.id,
      turnNo: turn?.turnNo ?? null,
      driverName: `${d.firstName} ${d.lastName}`,
      driverNationalId: this.decrypt(d.nationalIdEnc),
      loaderGroup: m.loaders.get(a.loaderTypeId)?.title ?? null,
      hall: m.halls.get(a.hallId)?.title ?? null,
      turnRegisteredAt: turn?.registeredAt.toISOString() ?? null,
      status: r.status,
      source: r.source,
      permitNo: r.permitNo,
      reservedAt: r.reservedAt.toISOString(),
      loadedAt: r.loadedAt?.toISOString() ?? null,
      unitSeq: r.unit.seq,
      arrivedAt: r.arrivedAt?.toISOString() ?? null,
      exitedAt: r.exitedAt?.toISOString() ?? null,
      driverMobile: d.user.mobile,
      smartCardNo: v?.smartCardNo ?? null,
      plate: v?.plate ?? null,
      plateSeries: plate?.iran ?? null,
      loaderType: v ? (m.loaders.get(v.loaderTypeId)?.title ?? null) : null,
      announcementNo: a.number,
      carrierCode: c.code,
      carrierName: c.name,
      origin: a.originCityId !== null ? (m.cities.get(a.originCityId)?.name ?? null) : null,
      destination,
      requestedTruckType: a.requestedTruckType,
      announcementSender: a.senderName,
      announcementReceiver: a.receiverName,
      returned: r.status === 'RETURNED',
      returnReason: r.returnReason,
      senderName: a.senderName,
      senderNationalId: this.decrypt(a.senderNationalIdEnc),
      receiverName: a.receiverName,
      receiverNationalId: this.decrypt(a.receiverNationalIdEnc),
      product: m.products.get(a.productId)?.title ?? null,
      loadingFrom: a.loadingFrom,
      loadingTo: a.loadingTo,
      orderDescription: a.description,
      fareRate: fare !== null ? fare.toString() : null,
      carrierPhone: c.phone,
      carrierAddress: c.address,
      ratePerTon: a.ratePerTon?.toString() ?? null,
      announcedWeight: a.weightToKg,
      orderCode: a.orderCode,
      packaging: m.packagings.get(a.packagingTypeId)?.title ?? null,
      goodsOwner: a.goodsOwnerId ? (m.owners.get(a.goodsOwnerId)?.name ?? null) : null,
      description: r.manualReason,
      ip: r.ip,
      userAgent: r.userAgent,
      ...extraCells(r.extra, PERMIT_COLUMNS),
    };
  }
}
