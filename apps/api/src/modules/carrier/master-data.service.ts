import { Injectable } from '@nestjs/common';
import {
  CARRIER_MASTER_KINDS,
  type CarrierMasterKind,
  type CarrierMasterOptionDto,
  type CarrierMasterRecordDto,
  type TableRow,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier, type CarrierScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { parseWith } from '../../common/validation/zod';
import { AuditService } from '../audit/audit.service';
import { assertUuid } from './ids';
import { MASTER_KINDS, type MasterKindDef, type MasterRow } from './master-data.kinds';

type Where = Record<string, unknown>;
/** The subset of a Prisma model delegate used here (the five tables share this shape). */
interface MasterDelegate {
  findMany(args: { where: Where; orderBy?: unknown; skip?: number; take?: number }): Promise<MasterRow[]>;
  findFirst(args: { where: Where }): Promise<MasterRow | null>;
  count(args: { where: Where }): Promise<number>;
  create(args: { data: Where }): Promise<MasterRow>;
  updateMany(args: { where: Where; data: Where }): Promise<{ count: number }>;
}

const OPTIONS_LIMIT = 50;

@Injectable()
export class CarrierMasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  kind(raw: string): MasterKindDef {
    if (!(CARRIER_MASTER_KINDS as readonly string[]).includes(raw)) throw new DomainError('NOT_FOUND');
    return MASTER_KINDS[raw as CarrierMasterKind];
  }

  private delegate(def: MasterKindDef, db: PrismaTx = this.prisma): MasterDelegate {
    const map: Record<CarrierMasterKind, unknown> = {
      parties: db.party,
      'goods-owners': db.goodsOwner,
      'loading-locations': db.loadingLocation,
      'cargo-descriptions': db.cargoDescription,
      'loading-conditions': db.loadingCondition,
    };
    return map[def.kind] as MasterDelegate;
  }

  /** Rows the carrier may SEE: its own, plus factory-shared rows where the table has them. */
  private visibleWhere(def: MasterKindDef, scope: CarrierScope): Where {
    const base = { tenantId: scope.tenantId, deletedAt: null };
    return def.hasShared
      ? { ...base, OR: [{ carrierId: scope.carrierId }, { carrierId: null }] }
      : { ...base, carrierId: scope.carrierId };
  }

  private decrypt = (enc: unknown): string | null => {
    if (typeof enc !== 'string' || !enc) return null;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return null;
    }
  };

  async list(user: AuthUser, kindRaw: string, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const def = this.kind(kindRaw);
    const scope = scopedCarrier(user);
    const and: Where[] = [this.visibleWhere(def, scope), ...p.where];
    if (p.q) and.push({ OR: def.search.map((f) => ({ [f]: { contains: p.q, mode: 'insensitive' } })) });
    const where = { AND: and };
    const d = this.delegate(def);
    const [items, total] = await Promise.all([
      d.findMany({ where, orderBy: p.orderBy.length ? p.orderBy : [{ createdAt: 'desc' }], skip: p.skip, take: p.take }),
      d.count({ where }),
    ]);
    const cityIds = [...new Set(items.map((r) => r.cityId).filter((c): c is number => typeof c === 'number'))];
    const cities = cityIds.length
      ? new Map((await this.prisma.city.findMany({ where: { id: { in: cityIds } } })).map((c) => [c.id, c.name]))
      : new Map<number, string>();
    const rows = items.map<TableRow>((r) => ({
      id: r.id,
      ...def.toCells(r, { decrypt: this.decrypt, cities }),
      shared: r.carrierId === null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { rows, total };
  }

  async options(user: AuthUser, kindRaw: string, q: string | undefined): Promise<CarrierMasterOptionDto[]> {
    const def = this.kind(kindRaw);
    const scope = scopedCarrier(user);
    const and: Where[] = [this.visibleWhere(def, scope)];
    const term = q?.trim().slice(0, 100);
    if (term) and.push({ OR: def.search.map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })) });
    const items = await this.delegate(def).findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }], take: OPTIONS_LIMIT });
    return items.map((r) => ({ id: r.id, label: def.label(r), shared: r.carrierId === null }));
  }

  async get(user: AuthUser, kindRaw: string, id: string): Promise<CarrierMasterRecordDto> {
    const def = this.kind(kindRaw);
    const scope = scopedCarrier(user);
    const row = await this.delegate(def).findFirst({ where: { id: assertUuid(id), ...this.visibleWhere(def, scope) } });
    if (!row) throw new DomainError('NOT_FOUND');
    return { id: row.id, shared: row.carrierId === null, ...def.toRecord(row, this.decrypt) };
  }

  async create(user: AuthUser, kindRaw: string, body: unknown): Promise<{ id: string }> {
    const def = this.kind(kindRaw);
    const scope = scopedCarrier(user);
    const input = parseWith(def.schema, body);
    const data = def.toData(input, this.crypto);
    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.delegate(def, tx).create({
          data: { ...data, tenantId: scope.tenantId, carrierId: scope.carrierId, createdBy: user.id },
        });
        await this.audit.log({ action: `${def.entity}.create`, entity: def.entity, entityId: row.id, after: def.auditView(data) }, tx);
        return { id: row.id };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  /**
   * Only the carrier's OWN rows are writable. Another carrier's row → 404 (no existence leak);
   * a factory-shared row → 403 (it is visible to the carrier, but read-only, P2-5).
   */
  private async findWritable(def: MasterKindDef, scope: CarrierScope, id: string, tx: PrismaTx): Promise<MasterRow> {
    const d = this.delegate(def, tx);
    const own = await d.findFirst({ where: { id: assertUuid(id), tenantId: scope.tenantId, carrierId: scope.carrierId, deletedAt: null } });
    if (own) return own;
    if (def.hasShared) {
      const shared = await d.findFirst({ where: { id, tenantId: scope.tenantId, carrierId: null, deletedAt: null } });
      if (shared) throw new DomainError('FORBIDDEN', { reason: 'SHARED_READ_ONLY' });
    }
    throw new DomainError('NOT_FOUND');
  }

  async update(user: AuthUser, kindRaw: string, id: string, body: unknown): Promise<{ id: string }> {
    const def = this.kind(kindRaw);
    const scope = scopedCarrier(user);
    const input = parseWith(def.schema, body);
    const data = def.toData(input, this.crypto);
    return this.prisma.$transaction(
      async (tx) => {
        const before = await this.findWritable(def, scope, id, tx);
        await this.delegate(def, tx).updateMany({ where: { id: before.id, carrierId: scope.carrierId, deletedAt: null }, data });
        await this.audit.log(
          {
            action: `${def.entity}.update`,
            entity: def.entity,
            entityId: before.id,
            before: def.auditView(def.toRecord(before, () => null)),
            after: def.auditView(data),
          },
          tx,
        );
        return { id: before.id };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  /** Soft delete (deletedAt); existing announcements keep their references. */
  async remove(user: AuthUser, kindRaw: string, id: string): Promise<void> {
    const def = this.kind(kindRaw);
    const scope = scopedCarrier(user);
    await this.prisma.$transaction(
      async (tx) => {
        const before = await this.findWritable(def, scope, id, tx);
        await this.delegate(def, tx).updateMany({
          where: { id: before.id, carrierId: scope.carrierId, deletedAt: null },
          data: { deletedAt: this.clock.now() },
        });
        await this.audit.log(
          { action: `${def.entity}.delete`, entity: def.entity, entityId: before.id, before: def.auditView(def.toRecord(before, () => null)) },
          tx,
        );
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }
}
