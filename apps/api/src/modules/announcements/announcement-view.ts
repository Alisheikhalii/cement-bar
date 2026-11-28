import type { Announcement, Carrier, UnitState } from '@prisma/client';
import {
  ABSORPTION_LABELS_FA,
  ALLOCATION_LABELS_FA,
  ALLOCATIONS,
  ANNOUNCEMENT_COLUMNS,
  faNumber,
  type Allocation,
  type AnnouncementUnitCounts,
  type CellValue,
  type TableRow,
} from '@cb/shared';
import { extraCells } from '../../common/list/list-response';
import type { PrismaTx } from '../../common/prisma/prisma.service';
import { absorptionOf, countUnits } from './allocation-rules';

export type AnnouncementWithCarrier = Announcement & { carrier: Carrier };

interface CityInfo {
  name: string;
  province: string;
}

/** Names of every master-data row referenced by a page of announcements (one query per table). */
export interface ViewContext {
  halls: Map<string, string>;
  loaderTypes: Map<string, { title: string; code: string }>;
  products: Map<string, string>;
  packaging: Map<string, string>;
  destinations: Map<string, string>;
  cities: Map<number, CityInfo>;
  locations: Map<string, { name: string; cityId: number | null; address: string | null }>;
  cargo: Map<string, string>;
  owners: Map<string, string>;
  users: Map<string, string>;
  counts: Map<string, AnnouncementUnitCounts>;
  allocations: Map<string, Map<Allocation, number>>;
}

const ids = <T>(list: (T | null | undefined)[]): T[] => [...new Set(list.filter((v): v is T => v !== null && v !== undefined))];

export async function loadViewContext(db: PrismaTx, tenantId: string, anns: Announcement[]): Promise<ViewContext> {
  const inIds = (list: (string | null)[]) => ({ id: { in: ids(list) }, tenantId });
  const annIds = anns.map((a) => a.id);
  const [halls, loaderTypes, products, packaging, destinations, locations, cargo, owners, users, groups] = await Promise.all([
    db.hall.findMany({ where: inIds(anns.map((a) => a.hallId)), select: { id: true, title: true } }),
    db.loaderType.findMany({
      where: inIds(anns.flatMap((a) => [a.loaderTypeId, a.loaderType2Id])),
      select: { id: true, title: true, code: true },
    }),
    db.product.findMany({ where: inIds(anns.map((a) => a.productId)), select: { id: true, title: true } }),
    db.packagingType.findMany({ where: inIds(anns.map((a) => a.packagingTypeId)), select: { id: true, title: true } }),
    db.destination.findMany({ where: inIds(anns.map((a) => a.destinationId)), select: { id: true, title: true } }),
    db.loadingLocation.findMany({
      where: inIds(anns.map((a) => a.loadingLocationId)),
      select: { id: true, name: true, cityId: true, address: true },
    }),
    db.cargoDescription.findMany({ where: inIds(anns.map((a) => a.cargoDescriptionId)), select: { id: true, text: true } }),
    db.goodsOwner.findMany({ where: inIds(anns.map((a) => a.goodsOwnerId)), select: { id: true, name: true } }),
    db.user.findMany({ where: inIds(anns.map((a) => a.createdBy)), select: { id: true, displayName: true } }),
    annIds.length
      ? db.loadUnit.groupBy({
          by: ['announcementId', 'state', 'allocation'],
          where: { announcementId: { in: annIds }, tenantId },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const cityIds = ids([...anns.flatMap((a) => [a.originCityId, a.destCityId]), ...locations.map((l) => l.cityId)]);
  const cities = cityIds.length
    ? await db.city.findMany({ where: { id: { in: cityIds } }, include: { province: true } })
    : [];

  const byAnn = new Map<string, { state: UnitState; n: number }[]>();
  const allocations = new Map<string, Map<Allocation, number>>();
  for (const g of groups) {
    const n = g._count._all;
    const list = byAnn.get(g.announcementId) ?? [];
    list.push({ state: g.state, n });
    byAnn.set(g.announcementId, list);
    if (g.state !== 'CANCELLED') {
      const m = allocations.get(g.announcementId) ?? new Map<Allocation, number>();
      m.set(g.allocation, (m.get(g.allocation) ?? 0) + n);
      allocations.set(g.announcementId, m);
    }
  }
  return {
    halls: new Map(halls.map((h) => [h.id, h.title])),
    loaderTypes: new Map(loaderTypes.map((l) => [l.id, { title: l.title, code: l.code }])),
    products: new Map(products.map((p) => [p.id, p.title])),
    packaging: new Map(packaging.map((p) => [p.id, p.title])),
    destinations: new Map(destinations.map((d) => [d.id, d.title])),
    cities: new Map(cities.map((c) => [c.id, { name: c.name, province: c.province.name }])),
    locations: new Map(locations.map((l) => [l.id, { name: l.name, cityId: l.cityId, address: l.address }])),
    cargo: new Map(cargo.map((c) => [c.id, c.text])),
    owners: new Map(owners.map((o) => [o.id, o.name])),
    users: new Map(users.map((u) => [u.id, u.displayName])),
    counts: new Map(annIds.map((id) => [id, countUnits(byAnn.get(id) ?? [])])),
    allocations,
  };
}

/** Reads a field-sourced column path ("truckCount", "carrier.name") from the entity; bigint → string. */
export function fieldValue(entity: unknown, path: string): CellValue {
  let v: unknown = entity;
  for (const key of path.split('.')) {
    if (v === null || v === undefined || typeof v !== 'object') return null;
    v = (v as Record<string, unknown>)[key];
  }
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return null;
}

/** «گروهی» column: allocation mix of the live units, e.g. "زمانی (کیسه‌ای) ۸، آزاد ۲". */
export function allocationSummary(m: Map<Allocation, number> | undefined): string | null {
  if (!m || m.size === 0) return null;
  return ALLOCATIONS.filter((a) => m.get(a))
    .map((a) => `${ALLOCATION_LABELS_FA[a]} ${faNumber(m.get(a)!)}`)
    .join('، ');
}

const FIELD_COLUMNS = ANNOUNCEMENT_COLUMNS.filter((c) => c.source.kind === 'field');

export function toRow(
  a: AnnouncementWithCarrier,
  ctx: ViewContext,
  decrypt: (enc: string | null) => string | null,
): TableRow {
  const row: TableRow = { id: a.id };
  for (const c of FIELD_COLUMNS) if (c.source.kind === 'field') row[c.id] = fieldValue(a, c.source.path);
  const counts = ctx.counts.get(a.id) ?? countUnits([]);
  const loc = ctx.locations.get(a.loadingLocationId);
  const locCity = loc?.cityId ? ctx.cities.get(loc.cityId) : undefined;
  const origin = a.originCityId ? ctx.cities.get(a.originCityId) : undefined;
  const dest = a.destCityId ? ctx.cities.get(a.destCityId) : undefined;
  const lt = ctx.loaderTypes.get(a.loaderTypeId);
  Object.assign(row, {
    hall: ctx.halls.get(a.hallId) ?? null,
    loaderType: lt?.title ?? null,
    loaderType2: a.loaderType2Id ? (ctx.loaderTypes.get(a.loaderType2Id)?.title ?? null) : null,
    loaderCode: lt?.code ?? null,
    product: ctx.products.get(a.productId) ?? null,
    absorption: ABSORPTION_LABELS_FA[absorptionOf(a.status, counts)],
    permitsIssued: counts.issued,
    remaining: counts.open,
    allocation: allocationSummary(ctx.allocations.get(a.id)),
    destination: (a.destinationId ? ctx.destinations.get(a.destinationId) : undefined) ?? dest?.name ?? null,
    loadingCity: locCity?.name ?? null,
    loadingAddress: loc?.address ?? a.loadingPlaceText ?? null,
    originCity: origin?.name ?? null,
    originProvince: origin?.province ?? null,
    destProvince: dest?.province ?? null,
    cargoDescription: a.cargoDescriptionId ? (ctx.cargo.get(a.cargoDescriptionId) ?? null) : null,
    packaging: ctx.packaging.get(a.packagingTypeId) ?? null,
    senderNationalId: decrypt(a.senderNationalIdEnc),
    receiverNationalId: decrypt(a.receiverNationalIdEnc),
    createdByUser: a.createdBy ? (ctx.users.get(a.createdBy) ?? null) : null,
    goodsOwner: a.goodsOwnerId ? (ctx.owners.get(a.goodsOwnerId) ?? null) : null,
  } satisfies Record<string, CellValue>);
  Object.assign(row, extraCells(a.extra, ANNOUNCEMENT_COLUMNS));
  return row;
}
