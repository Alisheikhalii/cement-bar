import { Injectable } from '@nestjs/common';
import { ARCHIVED_RESERVATION_STATUSES, jalaliYearMonth, localDate, type FactoryDashboardDto } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isoOrNull } from './factory.util';

/** Factory home: max 4 KPIs + today's halls (GUIDELINES §6 "simplicity first"). */
@Injectable()
export class FactoryDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async summary(user: AuthUser): Promise<FactoryDashboardDto> {
    const scope = scopedTenant(user);
    const now = this.clock.now();
    const today = localDate(now);
    const yearMonth = jalaliYearMonth(now);
    const [announcementsToday, activeReservations, carriers, drivers, halls, withoutQuota] = await Promise.all([
      this.prisma.announcement.count({
        where: { ...scope, announceDate: today, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      }),
      this.prisma.reservation.count({ where: { ...scope, status: { notIn: [...ARCHIVED_RESERVATION_STATUSES] } } }),
      this.prisma.carrier.groupBy({ by: ['status'], where: { ...scope, deletedAt: null }, _count: { _all: true } }),
      this.prisma.driver.groupBy({ by: ['status'], where: { ...scope, deletedAt: null }, _count: { _all: true } }),
      this.prisma.hall.findMany({
        where: { ...scope, active: true },
        orderBy: { createdAt: 'asc' },
        include: { days: { where: { date: today }, take: 1 } },
      }),
      this.prisma.carrier.count({
        where: { ...scope, deletedAt: null, status: 'ACTIVE', quotas: { none: { yearMonth } } },
      }),
    ]);
    const count = <S extends string>(rows: { status: S; _count: { _all: number } }[], s: S) =>
      rows.find((r) => r.status === s)?._count._all ?? 0;
    return {
      today,
      yearMonth,
      announcementsToday,
      activeReservations,
      carriers: { active: count(carriers, 'ACTIVE'), suspended: count(carriers, 'SUSPENDED') },
      drivers: { approved: count(drivers, 'APPROVED'), pending: count(drivers, 'PENDING'), blocked: count(drivers, 'BLOCKED') },
      hallsToday: halls.map((h) => {
        const d = h.days[0];
        return {
          hallId: h.id,
          hallTitle: h.title,
          category: h.category,
          dayId: d?.id ?? null,
          status: d?.status ?? null,
          t0At: isoOrNull(d?.t0At),
          hallEndAt: isoOrNull(d?.hallEndAt),
        };
      }),
      carriersWithoutQuota: withoutQuota,
    };
  }
}
