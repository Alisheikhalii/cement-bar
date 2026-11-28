import { Injectable } from '@nestjs/common';
import { addDaysIso, DRIVER_HALL_HOURS_DAYS, localDate, type DriverHallHoursDto } from '@cb/shared';
import type { DriverScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { buildHallHours } from './hall-hours';

/** Read-only hall opening hours (US-D8). Halls and their hours are set by the factory for the whole tenant. */
@Injectable()
export class HallHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async forDriver(scope: DriverScope): Promise<DriverHallHoursDto> {
    const now = this.clock.now();
    const today = localDate(now);
    const last = addDaysIso(today, DRIVER_HALL_HOURS_DAYS - 1);
    const { tenantId } = scope;
    const [halls, hallDays, schedules] = await Promise.all([
      this.prisma.hall.findMany({
        where: { tenantId, active: true },
        select: { id: true, title: true, category: true, terminalName: true, terminalCity: true },
        orderBy: { title: 'asc' },
      }),
      this.prisma.hallDay.findMany({
        where: { tenantId, date: { gte: today, lte: last } },
        select: { hallId: true, date: true, status: true, t0At: true, priorityEndAt: true, hallEndAt: true },
      }),
      this.prisma.hallSchedule.findMany({
        where: { tenantId, active: true },
        select: { hallId: true, weekday: true, t0: true, priorityEnd: true, hallEnd: true },
      }),
    ]);
    return {
      serverTime: now.toISOString(),
      today,
      days: buildHallHours(today, DRIVER_HALL_HOURS_DAYS, halls, hallDays, schedules),
    };
  }
}
