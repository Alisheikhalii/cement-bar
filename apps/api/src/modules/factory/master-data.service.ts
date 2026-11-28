import { Injectable } from '@nestjs/common';
import type { City, Destination, LoaderType, PackagingType, Product, Province } from '@prisma/client';
import type { DestinationDto, LoaderTypeDto, PackagingTypeDto, ProductDto } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface DestinationInput {
  cityId: number;
  title: string;
  active: boolean;
  sortOrder: number;
}
export interface LoaderTypeInput {
  code: string;
  title: string;
  active: boolean;
  sortOrder: number;
}
export interface PackagingTypeInput {
  title: string;
  category: 'BAG' | 'BULK';
  active: boolean;
}
export interface ProductInput {
  title: string;
  active: boolean;
}

type DestinationRow = Destination & { city: City & { province: Province } };
const withCity = { city: { include: { province: true } } } as const;

const toDestination = (d: DestinationRow): DestinationDto => ({
  id: d.id,
  cityId: d.cityId,
  cityName: d.city.name,
  provinceName: d.city.province.name,
  title: d.title,
  active: d.active,
  sortOrder: d.sortOrder,
});
const toLoaderType = (l: LoaderType): LoaderTypeDto => ({ id: l.id, code: l.code, title: l.title, active: l.active, sortOrder: l.sortOrder });
const toPackaging = (p: PackagingType): PackagingTypeDto => ({ id: p.id, title: p.title, category: p.category, active: p.active });
const toProduct = (p: Product): ProductDto => ({ id: p.id, title: p.title, active: p.active });

/**
 * Factory master data: destinations, loader types, packaging types, products.
 * No hard delete: rows are referenced by announcements/vehicles; deactivate instead (`active=false`).
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: TX_TIMEOUT_MS });
  }

  private live(user: AuthUser) {
    return { ...scopedTenant(user), deletedAt: null };
  }

  private async assertCity(tx: PrismaTx, cityId: number): Promise<void> {
    if (!(await tx.city.findUnique({ where: { id: cityId }, select: { id: true } }))) {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'cityId', message: 'unknown city' }] });
    }
  }

  // ───────── destinations ─────────
  async listDestinations(user: AuthUser): Promise<DestinationDto[]> {
    const rows = await this.prisma.destination.findMany({ where: this.live(user), include: withCity, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] });
    return rows.map(toDestination);
  }

  createDestination(user: AuthUser, input: DestinationInput): Promise<DestinationDto> {
    return this.tx(async (tx) => {
      await this.assertCity(tx, input.cityId);
      const d = await tx.destination.create({ data: { ...scopedTenant(user), ...input, createdBy: user.id }, include: withCity });
      await this.audit.log({ action: 'destination.created', entity: 'Destination', entityId: d.id, after: toDestination(d) }, tx);
      return toDestination(d);
    });
  }

  updateDestination(user: AuthUser, id: string, patch: Partial<DestinationInput>): Promise<DestinationDto> {
    return this.tx(async (tx) => {
      const b = await tx.destination.findFirst({ where: { id, ...this.live(user) }, include: withCity });
      if (!b) throw new DomainError('NOT_FOUND');
      if (patch.cityId !== undefined) await this.assertCity(tx, patch.cityId);
      const a = await tx.destination.update({ where: { id: b.id }, data: patch, include: withCity });
      await this.audit.log({ action: 'destination.updated', entity: 'Destination', entityId: a.id, before: toDestination(b), after: toDestination(a) }, tx);
      return toDestination(a);
    });
  }

  // ───────── loader types ─────────
  async listLoaderTypes(user: AuthUser): Promise<LoaderTypeDto[]> {
    const rows = await this.prisma.loaderType.findMany({ where: this.live(user), orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] });
    return rows.map(toLoaderType);
  }

  createLoaderType(user: AuthUser, input: LoaderTypeInput): Promise<LoaderTypeDto> {
    return this.tx(async (tx) => {
      const l = await tx.loaderType.create({ data: { ...scopedTenant(user), ...input, createdBy: user.id } });
      await this.audit.log({ action: 'loader_type.created', entity: 'LoaderType', entityId: l.id, after: toLoaderType(l) }, tx);
      return toLoaderType(l);
    });
  }

  updateLoaderType(user: AuthUser, id: string, patch: Partial<LoaderTypeInput>): Promise<LoaderTypeDto> {
    return this.tx(async (tx) => {
      const b = await tx.loaderType.findFirst({ where: { id, ...this.live(user) } });
      if (!b) throw new DomainError('NOT_FOUND');
      const a = await tx.loaderType.update({ where: { id: b.id }, data: patch });
      await this.audit.log({ action: 'loader_type.updated', entity: 'LoaderType', entityId: a.id, before: toLoaderType(b), after: toLoaderType(a) }, tx);
      return toLoaderType(a);
    });
  }

  // ───────── packaging types ─────────
  async listPackagingTypes(user: AuthUser): Promise<PackagingTypeDto[]> {
    const rows = await this.prisma.packagingType.findMany({ where: this.live(user), orderBy: [{ category: 'asc' }, { title: 'asc' }] });
    return rows.map(toPackaging);
  }

  createPackagingType(user: AuthUser, input: PackagingTypeInput): Promise<PackagingTypeDto> {
    return this.tx(async (tx) => {
      const p = await tx.packagingType.create({ data: { ...scopedTenant(user), ...input, createdBy: user.id } });
      await this.audit.log({ action: 'packaging_type.created', entity: 'PackagingType', entityId: p.id, after: toPackaging(p) }, tx);
      return toPackaging(p);
    });
  }

  updatePackagingType(user: AuthUser, id: string, patch: Partial<PackagingTypeInput>): Promise<PackagingTypeDto> {
    return this.tx(async (tx) => {
      const b = await tx.packagingType.findFirst({ where: { id, ...this.live(user) } });
      if (!b) throw new DomainError('NOT_FOUND');
      // ASSUMPTION(Q-D-7): BAG/BULK category is fixed once announcements use the packaging type.
      if (patch.category && patch.category !== b.category && (await tx.announcement.count({ where: { packagingTypeId: b.id } })) > 0) {
        throw new DomainError('INVALID_STATE', { field: 'category' });
      }
      const a = await tx.packagingType.update({ where: { id: b.id }, data: patch });
      await this.audit.log({ action: 'packaging_type.updated', entity: 'PackagingType', entityId: a.id, before: toPackaging(b), after: toPackaging(a) }, tx);
      return toPackaging(a);
    });
  }

  // ───────── products ─────────
  async listProducts(user: AuthUser): Promise<ProductDto[]> {
    const rows = await this.prisma.product.findMany({ where: this.live(user), orderBy: { title: 'asc' } });
    return rows.map(toProduct);
  }

  createProduct(user: AuthUser, input: ProductInput): Promise<ProductDto> {
    return this.tx(async (tx) => {
      const p = await tx.product.create({ data: { ...scopedTenant(user), ...input, createdBy: user.id } });
      await this.audit.log({ action: 'product.created', entity: 'Product', entityId: p.id, after: toProduct(p) }, tx);
      return toProduct(p);
    });
  }

  updateProduct(user: AuthUser, id: string, patch: Partial<ProductInput>): Promise<ProductDto> {
    return this.tx(async (tx) => {
      const b = await tx.product.findFirst({ where: { id, ...this.live(user) } });
      if (!b) throw new DomainError('NOT_FOUND');
      const a = await tx.product.update({ where: { id: b.id }, data: patch });
      await this.audit.log({ action: 'product.updated', entity: 'Product', entityId: a.id, before: toProduct(b), after: toProduct(a) }, tx);
      return toProduct(a);
    });
  }
}
