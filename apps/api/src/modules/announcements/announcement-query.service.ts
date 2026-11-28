import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ANNOUNCEMENT_VIEW_STATUSES,
  ANNOUNCEMENT_VIEWS,
  type AnnouncementDetailDto,
  type AnnouncementSummaryDto,
  type AnnouncementUnitDto,
  type AnnouncementView,
  type TableRow,
} from '@cb/shared';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  allowedTargets,
  baseAllocation,
  canCancel,
  countUnits,
  editBlock,
  quotaKg,
  revertTarget,
  type AllocationChangeRow,
} from './allocation-rules';
import { toFormValues } from './announcement-data';
import { loadViewContext, toRow } from './announcement-view';

/** Scope of a read: carrier operators see their carrier, factory operators the whole tenant. */
export interface ReadScope {
  tenantId: string;
  carrierId?: string;
}

export function parseView(raw: unknown): AnnouncementView {
  const v = typeof raw === 'string' && raw ? raw : 'active';
  if (!(ANNOUNCEMENT_VIEWS as readonly string[]).includes(v)) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'view', message: 'active|archived|history' }] });
  }
  return v as AnnouncementView;
}

export function unitDto(u: {
  id: string;
  seq: number;
  allocation: AnnouncementUnitDto['allocation'];
  state: AnnouncementUnitDto['state'];
  allocationChanges: AllocationChangeRow[];
}): AnnouncementUnitDto {
  const r = { allocation: u.allocation, state: u.state, changes: u.allocationChanges };
  return {
    id: u.id,
    seq: u.seq,
    allocation: u.allocation,
    state: u.state,
    baseAllocation: baseAllocation(r),
    revertTo: revertTarget(r),
    allowedTargets: allowedTargets(r),
  };
}

/** Read side shared by the carrier and factory controllers (same column config / xlsx export). */
@Injectable()
export class AnnouncementQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
  ) {}

  private decrypt = (enc: string | null): string | null => {
    if (!enc) return null;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return null;
    }
  };

  private where(scope: ReadScope, view: AnnouncementView, parsed?: ParsedList): Prisma.AnnouncementWhereInput {
    const and = [...(parsed?.where ?? [])] as Prisma.AnnouncementWhereInput[];
    const q = parsed?.q;
    if (q) {
      const text = { contains: q, mode: 'insensitive' as const };
      const or: Prisma.AnnouncementWhereInput[] = [
        { senderName: text },
        { receiverName: text },
        { orderCode: text },
        { description: text },
      ];
      if (/^\d{1,9}$/.test(q)) or.push({ number: Number(q) });
      and.push({ OR: or });
    }
    return {
      tenantId: scope.tenantId,
      ...(scope.carrierId ? { carrierId: scope.carrierId } : {}),
      deletedAt: null,
      status: { in: [...ANNOUNCEMENT_VIEW_STATUSES[view]] },
      AND: and,
    };
  }

  async list(scope: ReadScope, view: AnnouncementView, parsed: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const where = this.where(scope, view, parsed);
    const orderBy = [...(parsed.orderBy as Prisma.AnnouncementOrderByWithRelationInput[]), { number: 'desc' as const }];
    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({ where, orderBy, skip: parsed.skip, take: parsed.take, include: { carrier: true } }),
      this.prisma.announcement.count({ where }),
    ]);
    const ctx = await loadViewContext(this.prisma, scope.tenantId, items);
    return { rows: items.map((a) => toRow(a, ctx, this.decrypt)), total };
  }

  async summary(scope: ReadScope, view: AnnouncementView): Promise<AnnouncementSummaryDto> {
    const where = this.where(scope, view);
    const [agg, remaining] = await Promise.all([
      this.prisma.announcement.aggregate({ where, _count: { _all: true }, _sum: { truckCount: true } }),
      this.prisma.loadUnit.count({ where: { tenantId: scope.tenantId, state: 'OPEN', announcement: { is: where } } }),
    ]);
    return { announcements: agg._count._all, trucks: agg._sum.truckCount ?? 0, remaining };
  }

  async detail(scope: ReadScope, id: string): Promise<AnnouncementDetailDto> {
    const a = await this.prisma.announcement.findFirst({
      where: { id, tenantId: scope.tenantId, ...(scope.carrierId ? { carrierId: scope.carrierId } : {}), deletedAt: null },
      include: {
        carrier: true,
        units: { orderBy: { seq: 'asc' }, include: { allocationChanges: { orderBy: { at: 'asc' } } } },
      },
    });
    if (!a) throw new DomainError('NOT_FOUND');
    const [hall, ctx, priorities, parties] = await Promise.all([
      this.prisma.hall.findFirst({ where: { id: a.hallId, tenantId: scope.tenantId } }),
      loadViewContext(this.prisma, scope.tenantId, [a]),
      this.prisma.bagPriority.count({ where: { announcementId: id } }),
      this.prisma.party.findMany({
        where: { id: { in: [a.senderPartyId, a.receiverPartyId].filter((v): v is string => !!v) }, tenantId: scope.tenantId },
        select: { id: true, title: true },
      }),
    ]);
    const units = a.units.map(unitDto);
    const counts = countUnits(a.units);
    const base = units[0]?.baseAllocation ?? hall?.defaultAllocation ?? 'FREE';
    const block = editBlock(a.status, counts, priorities);
    const city = (cid: number | null) => (cid ? (ctx.cities.get(cid)?.name ?? null) : null);
    const partyName = (pid: string | null) => parties.find((p) => p.id === pid)?.title ?? null;
    const row = toRow(a, ctx, () => null);
    return {
      id: a.id,
      number: a.number,
      status: a.status,
      cancelReason: a.cancelReason,
      createdAt: a.createdAt.toISOString(),
      carrier: { code: a.carrier.code, name: a.carrier.name },
      hall: { id: a.hallId, title: hall?.title ?? '', category: hall?.category ?? null },
      baseAllocation: base,
      form: toFormValues(a, this.decrypt, base),
      labels: {
        product: (row.product as string | null) ?? null,
        packaging: (row.packaging as string | null) ?? null,
        loaderType: (row.loaderType as string | null) ?? null,
        loaderType2: (row.loaderType2 as string | null) ?? null,
        destination: a.destinationId ? (ctx.destinations.get(a.destinationId) ?? null) : null,
        originCity: city(a.originCityId),
        destCity: city(a.destCityId),
        loadingLocation: ctx.locations.get(a.loadingLocationId)?.name ?? null,
        cargoDescription: (row.cargoDescription as string | null) ?? null,
        goodsOwner: (row.goodsOwner as string | null) ?? null,
        senderParty: partyName(a.senderPartyId),
        receiverParty: partyName(a.receiverPartyId),
      },
      units,
      counts,
      quotaKg: quotaKg(counts.total, a.weightToKg).toString(),
      editable: block === null,
      editBlockedReason: block,
      cancellable: canCancel(a.status, counts),
    };
  }
}
