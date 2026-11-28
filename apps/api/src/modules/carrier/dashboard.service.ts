import { Controller, Get, Injectable } from '@nestjs/common';
import { ARCHIVED_RESERVATION_STATUSES, jalaliYearMonth, type CarrierDashboardDto, type ReservationStatus } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QuotaService } from '../../common/quota/quota.service';

@Injectable()
export class CarrierDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly quota: QuotaService,
  ) {}

  /** US-B1: quota & remaining, active announcements, pending requests. All counts are carrier-scoped. */
  async get(user: AuthUser): Promise<CarrierDashboardDto> {
    const scope = scopedCarrier(user);
    const yearMonth = jalaliYearMonth(this.clock.now());
    const [usage, activeAnnouncements, activePermits, pendingDrivers, pendingVehicleChanges, pendingCancelRequests, unseenDailyFiles] =
      await Promise.all([
        this.quota.usage(scope.tenantId, scope.carrierId, yearMonth),
        this.prisma.announcement.count({ where: { ...scope, status: 'ACTIVE', deletedAt: null } }),
        this.prisma.reservation.count({ where: { ...scope, status: { notIn: ARCHIVED_RESERVATION_STATUSES as ReservationStatus[] } } }),
        this.prisma.driver.count({ where: { ...scope, status: 'PENDING', deletedAt: null } }),
        this.prisma.vehicle.count({
          where: { tenantId: scope.tenantId, active: true, status: 'PENDING_CHANGE', driver: { carrierId: scope.carrierId, deletedAt: null } },
        }),
        this.prisma.cancelRequest.count({ where: { ...scope, status: 'PENDING' } }),
        this.prisma.dailyFile.count({ where: { ...scope, seenAt: null, deletedAt: null } }),
      ]);
    const remaining = usage.limitKg === null ? null : usage.limitKg - usage.usedKg;
    return {
      yearMonth,
      quota: { limitKg: usage.limitKg?.toString() ?? null, usedKg: usage.usedKg.toString(), remainingKg: remaining?.toString() ?? null },
      activeAnnouncements,
      activePermits,
      pendingDrivers,
      pendingVehicleChanges,
      pendingCancelRequests,
      unseenDailyFiles,
    };
  }
}

@Roles('CARRIER_OPERATOR')
@Controller('carrier/dashboard')
export class CarrierDashboardController {
  constructor(private readonly dashboard: CarrierDashboardService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<CarrierDashboardDto> {
    return this.dashboard.get(user);
  }
}
