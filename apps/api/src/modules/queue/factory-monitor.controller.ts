import { Controller, Get, Param, Query } from '@nestjs/common';
import type { BulkFairnessRowDto, FactoryAllocationRunDto, FactoryMonitorDto } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { FactoryMonitorService } from './factory-monitor.service';

/** Factory queue monitoring & fairness report (SPEC §4 Factory). */
@Roles('FACTORY_OPERATOR')
@Controller('factory')
export class FactoryMonitorController {
  constructor(private readonly monitor: FactoryMonitorService) {}

  @Get('monitor')
  overview(@CurrentUser() user: AuthUser): Promise<FactoryMonitorDto> {
    return this.monitor.monitor(user);
  }

  @Get('monitor/allocation-runs/:id')
  allocationRun(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<FactoryAllocationRunDto> {
    return this.monitor.allocationRun(user, id);
  }

  @Get('reports/bulk-fairness')
  fairness(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<BulkFairnessRowDto[]> {
    return this.monitor.bulkFairness(user, from, to);
  }
}
