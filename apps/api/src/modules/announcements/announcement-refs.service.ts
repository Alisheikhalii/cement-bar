import { Injectable } from '@nestjs/common';
import type { Announcement, Destination, Hall, Party } from '@prisma/client';
import {
  localDate,
  localTime,
  type AnnouncementInput,
  type AnnouncementLookupsDto,
  type LookupPartyAddress,
} from '@cb/shared';
import type { CarrierScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, type PrismaTx } from '../../common/prisma/prisma.service';

export interface ResolvedRefs {
  hall: Hall;
  destination: Destination | null;
  senderParty: Party | null;
  receiverParty: Party | null;
}

interface Issue {
  path: string;
  message: string;
}

const NOT_FOUND_MSG = 'مورد انتخاب‌شده معتبر نیست یا غیرفعال شده است';

/** Shape of one element of Party.addresses (jsonb, written by the carrier master-data slice). */
export function partyAddresses(raw: unknown): LookupPartyAddress[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && typeof (a as { address?: unknown }).address === 'string')
    .map((a) => ({
      title: typeof a.title === 'string' ? a.title : undefined,
      cityId: typeof a.cityId === 'number' ? a.cityId : undefined,
      postalCode: typeof a.postalCode === 'string' ? a.postalCode : undefined,
      address: a.address as string,
    }));
}

/**
 * Validates every master-data id referenced by an announcement against the session scope
 * (tenant; carrier-owned or shared `carrierId = null` rows per P2-5), and serves the form's select sources.
 * Reads the master-data tables directly (independent of the D/F CRUD slices).
 */
@Injectable()
export class AnnouncementRefsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
    private readonly clock: ClockService,
  ) {}

  /** Carrier-owned or shared rows (P2-5). */
  private visible(s: CarrierScope) {
    return { tenantId: s.tenantId, deletedAt: null, OR: [{ carrierId: s.carrierId }, { carrierId: null }] };
  }

  /**
   * Throws VALIDATION_FAILED (with per-field issues) when a reference is unknown, foreign or inactive.
   * On edit (`prev` given) unchanged references are accepted even if deactivated since.
   */
  async validate(db: PrismaTx, s: CarrierScope, input: AnnouncementInput, prev?: Announcement | null): Promise<ResolvedRefs> {
    const issues: Issue[] = [];
    const t = s.tenantId;
    const changed = (k: keyof Announcement & keyof AnnouncementInput) => !prev || prev[k] !== input[k];
    const live = { tenantId: t, deletedAt: null };
    const check = async (path: keyof AnnouncementInput, id: unknown, find: () => Promise<unknown>) => {
      if (id === undefined || id === null || !changed(path as keyof Announcement & keyof AnnouncementInput)) return;
      if (!(await find())) issues.push({ path, message: NOT_FOUND_MSG });
    };
    const city = (id: number) => db.city.findUnique({ where: { id }, select: { id: true } });

    const [hall, destination, senderParty, receiverParty] = await Promise.all([
      db.hall.findFirst({ where: { id: input.hallId, tenantId: t, ...(changed('hallId') ? { active: true } : {}) } }),
      input.destinationId
        ? db.destination.findFirst({
            where: { id: input.destinationId, ...live, ...(changed('destinationId') ? { active: true } : {}) },
          })
        : null,
      input.senderPartyId ? db.party.findFirst({ where: { id: input.senderPartyId, ...live, carrierId: s.carrierId } }) : null,
      input.receiverPartyId
        ? db.party.findFirst({ where: { id: input.receiverPartyId, ...live, carrierId: s.carrierId } })
        : null,
    ]);
    if (!hall) issues.push({ path: 'hallId', message: NOT_FOUND_MSG });
    if (input.destinationId && !destination) issues.push({ path: 'destinationId', message: NOT_FOUND_MSG });
    if (input.senderPartyId && !senderParty) issues.push({ path: 'senderPartyId', message: NOT_FOUND_MSG });
    if (input.receiverPartyId && !receiverParty) issues.push({ path: 'receiverPartyId', message: NOT_FOUND_MSG });
    if (destination && input.destCityId !== undefined && input.destCityId !== destination.cityId) {
      issues.push({ path: 'destCityId', message: 'شهر مقصد با مقصد انتخاب‌شده یکسان نیست' });
    }

    let packagingCategory: string | null = null;
    await Promise.all([
      check('productId', input.productId, () => db.product.findFirst({ where: { id: input.productId, ...live, active: true } })),
      check('packagingTypeId', input.packagingTypeId, async () => {
        const p = await db.packagingType.findFirst({ where: { id: input.packagingTypeId, ...live, active: true } });
        packagingCategory = p?.category ?? null;
        return p;
      }),
      check('loaderTypeId', input.loaderTypeId, () => db.loaderType.findFirst({ where: { id: input.loaderTypeId, ...live, active: true } })),
      check('loaderType2Id', input.loaderType2Id, () =>
        db.loaderType.findFirst({ where: { id: input.loaderType2Id, ...live, active: true } }),
      ),
      check('loadingLocationId', input.loadingLocationId, () =>
        db.loadingLocation.findFirst({ where: { id: input.loadingLocationId, ...this.visible(s) } }),
      ),
      check('cargoDescriptionId', input.cargoDescriptionId, () =>
        db.cargoDescription.findFirst({ where: { id: input.cargoDescriptionId, ...this.visible(s) } }),
      ),
      check('goodsOwnerId', input.goodsOwnerId, () =>
        db.goodsOwner.findFirst({ where: { id: input.goodsOwnerId, ...live, carrierId: s.carrierId } }),
      ),
      check('originCityId', input.originCityId, () => city(input.originCityId!)),
      check('destCityId', input.destCityId, () => city(input.destCityId!)),
    ]);
    // ASSUMPTION(Q-E-2): the packaging category must match the hall category (bag hall ↔ bag packaging).
    if (hall && packagingCategory && packagingCategory !== hall.category) {
      issues.push({ path: 'packagingTypeId', message: 'نوع بسته‌بندی با نوع سالن سازگار نیست' });
    }
    if (issues.length) throw new DomainError('VALIDATION_FAILED', { issues });
    return { hall: hall!, destination, senderParty, receiverParty };
  }

  private decryptOrNull(enc: string | null | undefined): string | null {
    if (!enc) return null;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return null;
    }
  }

  async lookups(s: CarrierScope): Promise<AnnouncementLookupsDto> {
    const t = s.tenantId;
    const live = { tenantId: t, deletedAt: null };
    const own = { ...live, carrierId: s.carrierId };
    const db = this.prisma;
    const [halls, products, packagingTypes, loaderTypes, destinations, locations, cargo, conditions, parties, owners] =
      await Promise.all([
        db.hall.findMany({ where: { tenantId: t, active: true }, orderBy: { title: 'asc' } }),
        db.product.findMany({ where: { ...live, active: true }, orderBy: { title: 'asc' } }),
        db.packagingType.findMany({ where: { ...live, active: true }, orderBy: { title: 'asc' } }),
        db.loaderType.findMany({ where: { ...live, active: true }, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] }),
        db.destination.findMany({
          where: { ...live, active: true },
          orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
          include: { city: true },
        }),
        db.loadingLocation.findMany({ where: this.visible(s), orderBy: { name: 'asc' } }),
        db.cargoDescription.findMany({ where: this.visible(s), orderBy: { text: 'asc' } }),
        db.loadingCondition.findMany({ where: this.visible(s), orderBy: { createdAt: 'asc' } }),
        db.party.findMany({ where: own, orderBy: { title: 'asc' } }),
        db.goodsOwner.findMany({ where: own, orderBy: { name: 'asc' } }),
      ]);
    const partyAddrs = parties.map((p) => partyAddresses(p.addresses));
    const cityIds = new Set<number>();
    for (const l of locations) if (l.cityId) cityIds.add(l.cityId);
    for (const list of partyAddrs) for (const a of list) if (a.cityId) cityIds.add(a.cityId);
    const cities = cityIds.size
      ? await db.city.findMany({ where: { id: { in: [...cityIds] } }, select: { id: true, name: true } })
      : [];
    const cityName = new Map(cities.map((c) => [c.id, c.name]));
    const now = this.clock.now();
    return {
      today: localDate(now),
      nowTime: localTime(now),
      halls: halls.map((h) => ({ id: h.id, title: h.title, category: h.category, defaultAllocation: h.defaultAllocation })),
      products: products.map((p) => ({ id: p.id, title: p.title })),
      packagingTypes: packagingTypes.map((p) => ({ id: p.id, title: p.title, category: p.category })),
      loaderTypes: loaderTypes.map((l) => ({ id: l.id, title: l.title, code: l.code })),
      destinations: destinations.map((d) => ({ id: d.id, title: d.title, cityId: d.cityId, cityName: d.city.name })),
      loadingLocations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        warehouseType: l.warehouseType,
        cityId: l.cityId,
        cityName: l.cityId ? (cityName.get(l.cityId) ?? null) : null,
        address: l.address,
        shared: l.carrierId === null,
      })),
      cargoDescriptions: cargo.map((c) => ({ id: c.id, text: c.text, shared: c.carrierId === null })),
      loadingConditions: conditions.map((c) => ({ id: c.id, name: c.name, condition: c.condition, shared: c.carrierId === null })),
      parties: parties.map((p, i) => ({
        id: p.id,
        title: p.title,
        name: p.name,
        nationalId: this.decryptOrNull(p.nationalIdEnc),
        addresses: partyAddrs[i]!.map((a) => ({ ...a, cityName: a.cityId ? (cityName.get(a.cityId) ?? null) : null })),
      })),
      goodsOwners: owners.map((o) => ({ id: o.id, name: o.name })),
    };
  }
}
