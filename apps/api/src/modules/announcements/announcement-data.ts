import { Prisma, type Announcement } from '@prisma/client';
import type { Allocation, AnnouncementFormValues, AnnouncementInput } from '@cb/shared';
import type { PrismaTx } from '../../common/prisma/prisma.service';
import { partyAddresses, type ResolvedRefs } from './announcement-refs.service';

/** Keys of AnnouncementInput.extra (other keys of the jsonb column are preserved on edit). */
const INPUT_EXTRA_KEYS = ['shared', 'aggregated', 'native', 'loadingType'] as const;

const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const big = (v: number | undefined): bigint | null => (v === undefined ? null : BigInt(v));
const und = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/** Merges the form's extra flags into the stored jsonb (keeps unknown keys such as share data). */
export function mergeExtra(stored: unknown, input: AnnouncementInput['extra']): Prisma.InputJsonObject {
  const base: Record<string, unknown> =
    stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Record<string, unknown>) } : {};
  for (const k of INPUT_EXTRA_KEYS) {
    const v = input[k];
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base as Prisma.InputJsonObject;
}

/**
 * Maps validated input → announcement columns. Sender/receiver fields left empty are filled from the
 * chosen party (name, national id, first address); destCityId falls back to the destination's city.
 */
export function toData(input: AnnouncementInput, refs: ResolvedRefs, encrypt: (plain: string) => string) {
  const sp = refs.senderParty;
  const rp = refs.receiverParty;
  const spAddr = sp ? partyAddresses(sp.addresses)[0] : undefined;
  const rpAddr = rp ? partyAddresses(rp.addresses)[0] : undefined;
  return {
    hallId: input.hallId,
    announceDate: input.announceDate,
    announceTime: input.announceTime,
    orderCode: n(input.orderCode),
    contractNo: n(input.contractNo),
    unloadCode: n(input.unloadCode),
    senderPartyId: n(input.senderPartyId),
    senderName: input.senderName ?? sp?.name ?? null,
    senderNationalIdEnc: input.senderNationalId ? encrypt(input.senderNationalId) : (sp?.nationalIdEnc ?? null),
    originCityId: input.originCityId ?? spAddr?.cityId ?? null,
    senderPostal: input.senderPostal ?? spAddr?.postalCode ?? null,
    senderAddress: input.senderAddress ?? spAddr?.address ?? null,
    receiverPartyId: n(input.receiverPartyId),
    receiverName: input.receiverName ?? rp?.name ?? null,
    receiverNationalIdEnc: input.receiverNationalId ? encrypt(input.receiverNationalId) : (rp?.nationalIdEnc ?? null),
    destCityId: input.destCityId ?? refs.destination?.cityId ?? rpAddr?.cityId ?? null,
    destinationId: n(input.destinationId),
    receiverPostal: input.receiverPostal ?? rpAddr?.postalCode ?? null,
    receiverAddress: input.receiverAddress ?? rpAddr?.address ?? null,
    productId: input.productId,
    cargoDescriptionId: n(input.cargoDescriptionId),
    packagingTypeId: input.packagingTypeId,
    cargoValue: BigInt(input.cargoValue),
    cargoCount: n(input.cargoCount),
    loadingLocationId: input.loadingLocationId,
    warehouseName: n(input.warehouseName),
    loadingDate: n(input.loadingDate),
    loadingEndDate: n(input.loadingEndDate),
    loadingFrom: n(input.loadingFrom),
    loadingTo: n(input.loadingTo),
    loadingPlaceText: n(input.loadingPlaceText),
    fareCalc: input.fareCalc,
    loaderTypeId: input.loaderTypeId,
    loaderType2Id: n(input.loaderType2Id),
    truckCount: input.truckCount,
    loaderLength: n(input.loaderLength),
    requestedTruckType: n(input.requestedTruckType),
    weightFromKg: input.weightFromKg,
    weightToKg: input.weightToKg,
    destFareType: input.destFareType,
    farePerTruck: big(input.farePerTruck),
    ratePerTon: big(input.ratePerTon),
    goodsOwnerId: n(input.goodsOwnerId),
    waybillNote: n(input.waybillNote),
    description: input.description,
    isFreeOutsideDestinations: input.isFreeOutsideDestinations,
  } satisfies Partial<Prisma.AnnouncementUncheckedCreateInput>;
}

function extraFlags(extra: unknown): AnnouncementFormValues['extra'] {
  const e = extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {};
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  return {
    shared: bool(e.shared),
    aggregated: bool(e.aggregated),
    native: bool(e.native),
    loadingType: typeof e.loadingType === 'string' ? e.loadingType : undefined,
  };
}

/** Stored announcement → form values (edit prefill / server-side copy). */
export function toFormValues(
  a: Announcement,
  decrypt: (enc: string | null) => string | null,
  allocation: Allocation,
): AnnouncementFormValues {
  const money = (v: bigint | null) => (v === null ? undefined : Number(v));
  return {
    announceDate: a.announceDate,
    announceTime: a.announceTime,
    hallId: a.hallId,
    orderCode: und(a.orderCode),
    contractNo: und(a.contractNo),
    unloadCode: und(a.unloadCode),
    senderPartyId: und(a.senderPartyId),
    senderName: und(a.senderName),
    senderNationalId: und(decrypt(a.senderNationalIdEnc)),
    originCityId: und(a.originCityId),
    senderPostal: und(a.senderPostal),
    senderAddress: und(a.senderAddress),
    receiverPartyId: und(a.receiverPartyId),
    receiverName: und(a.receiverName),
    receiverNationalId: und(decrypt(a.receiverNationalIdEnc)),
    destCityId: und(a.destCityId),
    destinationId: und(a.destinationId),
    receiverPostal: und(a.receiverPostal),
    receiverAddress: und(a.receiverAddress),
    productId: a.productId,
    cargoDescriptionId: und(a.cargoDescriptionId),
    packagingTypeId: a.packagingTypeId,
    cargoValue: Number(a.cargoValue),
    cargoCount: und(a.cargoCount),
    loadingLocationId: a.loadingLocationId,
    warehouseName: und(a.warehouseName),
    loadingDate: und(a.loadingDate),
    loadingEndDate: und(a.loadingEndDate),
    loadingFrom: und(a.loadingFrom),
    loadingTo: und(a.loadingTo),
    loadingPlaceText: und(a.loadingPlaceText),
    fareCalc: a.fareCalc,
    loaderTypeId: a.loaderTypeId,
    loaderType2Id: und(a.loaderType2Id),
    truckCount: a.truckCount,
    loaderLength: und(a.loaderLength),
    requestedTruckType: und(a.requestedTruckType),
    weightFromKg: a.weightFromKg,
    weightToKg: a.weightToKg,
    destFareType: a.destFareType,
    farePerTruck: money(a.farePerTruck),
    ratePerTon: money(a.ratePerTon),
    goodsOwnerId: und(a.goodsOwnerId),
    waybillNote: und(a.waybillNote),
    description: a.description,
    allocation,
    isFreeOutsideDestinations: a.isFreeOutsideDestinations,
    extra: extraFlags(a.extra),
  };
}

/** Compact audit snapshot (no PII ciphertexts). */
export function snapshot(a: Announcement, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    number: a.number,
    status: a.status,
    hallId: a.hallId,
    announceDate: a.announceDate,
    announceTime: a.announceTime,
    productId: a.productId,
    packagingTypeId: a.packagingTypeId,
    loaderTypeId: a.loaderTypeId,
    loaderType2Id: a.loaderType2Id,
    destinationId: a.destinationId,
    destCityId: a.destCityId,
    truckCount: a.truckCount,
    weightFromKg: a.weightFromKg,
    weightToKg: a.weightToKg,
    fareCalc: a.fareCalc,
    farePerTruck: a.farePerTruck?.toString() ?? null,
    ratePerTon: a.ratePerTon?.toString() ?? null,
    cargoValue: a.cargoValue.toString(),
    isFreeOutsideDestinations: a.isFreeOutsideDestinations,
    cancelReason: a.cancelReason,
    ...extra,
  };
}

// ───────── row locks (SELECT … FOR UPDATE) — serialize writers with the future reservation path ─────────
export interface LockedUnit {
  id: string;
  seq: number;
  state: 'OPEN' | 'RESERVED' | 'CONSUMED' | 'CANCELLED' | 'HELD';
  allocation: Allocation;
}

/** Locks the announcement row inside the carrier scope; null when not visible (→ 404, no existence leak). */
export async function lockAnnouncement(
  tx: PrismaTx,
  scope: { tenantId: string; carrierId: string },
  id: string,
): Promise<Announcement | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM announcements
     WHERE id = ${id}::uuid AND "tenantId" = ${scope.tenantId}::uuid AND "carrierId" = ${scope.carrierId}::uuid
       AND "deletedAt" IS NULL
     FOR UPDATE`;
  if (!rows.length) return null;
  return tx.announcement.findUnique({ where: { id } });
}

export async function lockUnits(tx: PrismaTx, announcementId: string, unitIds?: string[]): Promise<LockedUnit[]> {
  const filter = unitIds ? Prisma.sql`AND id = ANY(${unitIds}::uuid[])` : Prisma.empty;
  return tx.$queryRaw<LockedUnit[]>`
    SELECT id, seq, state::text AS state, allocation::text AS allocation FROM load_units
     WHERE "announcementId" = ${announcementId}::uuid ${filter}
     ORDER BY seq
     FOR UPDATE`;
}

/** Next announcement number of the tenant (Counter row, atomic upsert inside the caller's transaction). */
export async function nextAnnouncementNumber(tx: PrismaTx, tenantId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters ("tenantId", name, value) VALUES (${tenantId}::uuid, 'announcement', 1)
    ON CONFLICT ("tenantId", name) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  return rows[0]!.value;
}
