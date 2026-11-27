import { Controller, Get, Inject, Injectable, Module, Query } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { Public } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodPipe } from '../../common/validation/zod';

const citiesQuery = z.object({ q: z.string().trim().max(50).optional() }).strict();
const CITY_LIMIT = 50;

/**
 * Public lookups used by the driver sign-up form. v1 is single-tenant: the public tenant is
 * PUBLIC_TENANT_ID or, if unset, the oldest tenant (see DECISIONS open question).
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async tenantId(): Promise<string | null> {
    if (this.config.publicTenantId) return this.config.publicTenantId;
    const t = await this.prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return t?.id ?? null;
  }

  async carriers(): Promise<{ id: string; code: string; name: string }[]> {
    const tenantId = await this.tenantId();
    if (!tenantId) return [];
    return this.prisma.carrier.findMany({
      where: { tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  async loaderTypes(): Promise<{ id: string; code: string; title: string }[]> {
    const tenantId = await this.tenantId();
    if (!tenantId) return [];
    return this.prisma.loaderType.findMany({
      where: { tenantId, active: true, deletedAt: null },
      select: { id: true, code: true, title: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  async cities(q: string | undefined): Promise<{ id: number; name: string; province: string }[]> {
    const rows = await this.prisma.city.findMany({
      where: q ? { name: { contains: q } } : undefined,
      select: { id: true, name: true, province: { select: { name: true } } },
      orderBy: [{ provinceId: 'asc' }, { name: 'asc' }],
      take: CITY_LIMIT,
    });
    return rows.map((c) => ({ id: c.id, name: c.name, province: c.province.name }));
  }
}

@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('carriers')
  carriers(): Promise<{ id: string; code: string; name: string }[]> {
    return this.svc.carriers();
  }

  @Get('loader-types')
  loaderTypes(): Promise<{ id: string; code: string; title: string }[]> {
    return this.svc.loaderTypes();
  }

  @Get('cities')
  cities(
    @Query(new ZodPipe(citiesQuery)) query: z.infer<typeof citiesQuery>,
  ): Promise<{ id: number; name: string; province: string }[]> {
    return this.svc.cities(query.q);
  }
}

@Module({ controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
