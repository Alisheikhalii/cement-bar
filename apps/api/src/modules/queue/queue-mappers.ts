/** DTO mappers shared by the driver / carrier queue services. All join scope checks happen upstream. */
import type { Prisma } from '@prisma/client';
import type { BagAssignmentDto, BagPriorityDto, DriverReservationDto, BagTurnDto } from '@cb/shared';
import type { PrismaTx } from '../../common/prisma/prisma.service';

export const reservationInclude = {
  unit: { include: { announcement: { include: { carrier: true } } } },
  cancelRequests: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ReservationInclude;

export type ReservationFull = Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>;

export const bagTurnDto = (t: { id: string; turnNo: number; status: BagTurnDto['status']; registeredAt: Date }): BagTurnDto => ({
  id: t.id,
  turnNo: t.turnNo,
  status: t.status,
  registeredAt: t.registeredAt.toISOString(),
});

export async function destinationLabel(
  db: PrismaTx,
  a: { destinationId: string | null; destCityId: number | null },
  cache?: { destinations?: Map<string, string>; cities?: Map<number, string> },
): Promise<string | null> {
  if (a.destinationId) {
    if (cache?.destinations?.has(a.destinationId)) return cache.destinations.get(a.destinationId)!;
    const d = await db.destination.findUnique({ where: { id: a.destinationId }, select: { title: true } });
    if (cache?.destinations && d) cache.destinations.set(a.destinationId, d.title);
    if (d) return d.title;
  }
  if (a.destCityId !== null) {
    if (cache?.cities?.has(a.destCityId)) return cache.cities.get(a.destCityId)!;
    const c = await db.city.findUnique({ where: { id: a.destCityId }, select: { name: true } });
    if (cache?.cities && c) cache.cities.set(a.destCityId, c.name);
    if (c) return c.name;
  }
  return null;
}

export async function bagPriorityDtos(db: PrismaTx, turnId: string): Promise<BagPriorityDto[]> {
  const rows = await db.bagPriority.findMany({
    where: { turnId },
    orderBy: { rank: 'asc' },
    include: { announcement: { include: { carrier: true } } },
  });
  const cache = { destinations: new Map<string, string>(), cities: new Map<number, string>() };
  const out: BagPriorityDto[] = [];
  for (const p of rows) {
    const a = p.announcement;
    out.push({
      rank: p.rank,
      announcementId: a.id,
      announcementNumber: a.number,
      title: a.description,
      carrierName: a.carrier.name,
      destinationTitle: await destinationLabel(db, a, cache),
    });
  }
  return out;
}

export async function bagAssignmentDto(db: PrismaTx, reservation: ReservationFull): Promise<BagAssignmentDto> {
  const a = reservation.unit.announcement;
  return {
    reservationId: reservation.id,
    permitNo: reservation.permitNo,
    unitId: reservation.unitId,
    announcementId: a.id,
    announcementNumber: a.number,
    title: a.description,
    carrierName: a.carrier.name,
    destinationTitle: await destinationLabel(db, a),
    reservedAt: reservation.reservedAt.toISOString(),
  };
}

const CANCELABLE: ReadonlySet<string> = new Set(['RESERVED', 'ARRIVED']);

export async function driverReservationDto(db: PrismaTx, reservationId: string): Promise<DriverReservationDto> {
  const r = await db.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: reservationInclude });
  return driverReservationDtoFromFull(db, r);
}

export async function driverReservationDtoFromFull(db: PrismaTx, r: ReservationFull): Promise<DriverReservationDto> {
  const a = r.unit.announcement;
  const hall = await db.hall.findUnique({ where: { id: a.hallId }, select: { title: true, category: true } });
  const pending = r.cancelRequests[0];
  return {
    id: r.id,
    permitNo: r.permitNo,
    status: r.status,
    source: r.source,
    reservedAt: r.reservedAt.toISOString(),
    unitId: r.unitId,
    unitSeq: r.unit.seq,
    announcementId: a.id,
    announcementNumber: a.number,
    title: a.description,
    carrierName: a.carrier.name,
    destinationTitle: (await destinationLabel(db, a)) ?? '',
    hallId: a.hallId,
    hallTitle: hall?.title ?? '',
    hallCategory: hall?.category ?? 'BAG',
    cancelRequest: pending
      ? {
          id: pending.id,
          status: pending.status,
          reason: pending.reason,
          decisionNote: pending.decisionNote,
          createdAt: pending.createdAt.toISOString(),
          decidedAt: pending.decidedAt ? pending.decidedAt.toISOString() : null,
        }
      : null,
    canRequestCancel: CANCELABLE.has(r.status) && !pending,
  };
}
