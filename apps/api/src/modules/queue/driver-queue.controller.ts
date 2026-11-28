import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  cancelRequestSchema,
  createReservationSchema,
  setBagPrioritiesSchema,
  type Allocation,
  type BagHallDto,
  type BagTurnDto,
  type CancelRequestInput,
  type CreateReservationInput,
  type DriverBulkStateDto,
  type DriverHistoryDto,
  type DriverLoadCityDto,
  type DriverLoadDto,
  type DriverQueueHallsDto,
  type DriverReservationDto,
  type HallCategory,
  type SetBagPrioritiesInput,
} from '@cb/shared';
import { CurrentUser, RateLimitBucket, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ZodPipe } from '../../common/validation/zod';
import { DriverQueueService } from './driver-queue.service';
import { DriverLoadsService } from './driver-loads.service';
import { DriverReservationsService } from './driver-reservations.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v: string | undefined, field: string): string {
  if (!v || !UUID_RE.test(v)) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: field, message: 'uuid' }] });
  return v;
}

function hallCategory(v: unknown): HallCategory | undefined {
  if (v === undefined || v === '') return undefined;
  if (v === 'BAG' || v === 'BULK') return v;
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'hallCategory', message: 'BAG|BULK' }] });
}

function allocationOf(v: unknown): Allocation | undefined {
  if (v === undefined || v === '') return undefined;
  if (v === 'GROUP' || v === 'TIMED' || v === 'FREE') return v;
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'allocation', message: 'GROUP|TIMED|FREE' }] });
}

function cityIdOf(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'cityId', message: 'positive int' }] });
  return n;
}

/** Driver queue endpoints (SPEC §4). tenantId/driverId come only from the session. */
@Roles('DRIVER')
@Controller('driver')
export class DriverQueueController {
  constructor(
    private readonly queue: DriverQueueService,
    private readonly loads: DriverLoadsService,
    private readonly reservations: DriverReservationsService,
  ) {}

  @Get('queue/halls')
  halls(@CurrentUser() user: AuthUser): Promise<DriverQueueHallsDto> {
    return this.queue.halls(user);
  }

  @Get('bag')
  bag(@CurrentUser() user: AuthUser): Promise<BagHallDto> {
    return this.queue.bag(user);
  }

  @Post('bag/turn')
  @RateLimitBucket('turn')
  @HttpCode(200)
  registerTurn(@CurrentUser() user: AuthUser): Promise<{ turn: BagTurnDto }> {
    return this.queue.registerTurn(user);
  }

  @Put('bag/priorities')
  setPriorities(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(setBagPrioritiesSchema)) body: SetBagPrioritiesInput,
  ): Promise<{ priorities: BagHallDto['priorities'] }> {
    return this.queue.setPriorities(user, body);
  }

  @Get('bulk')
  bulk(@CurrentUser() user: AuthUser): Promise<DriverBulkStateDto> {
    return this.queue.bulkState(user);
  }

  @Get('loads/cities')
  loadCities(@CurrentUser() user: AuthUser, @Query('hallCategory') hallCategoryRaw?: string): Promise<DriverLoadCityDto[]> {
    return this.loads.cities(user, hallCategory(hallCategoryRaw));
  }

  @Get('loads')
  loadList(
    @CurrentUser() user: AuthUser,
    @Query() q: Record<string, string | undefined>,
  ): Promise<DriverLoadDto[]> {
    return this.loads.list(user, {
      cityId: cityIdOf(q.cityId),
      hallCategory: hallCategory(q.hallCategory),
      allocation: allocationOf(q.allocation),
      carrierId: q.carrierId ? uuid(q.carrierId, 'carrierId') : undefined,
      q: q.q?.trim() || undefined,
      compatible: q.compatible !== 'false',
    });
  }

  @Get('loads/:announcementId')
  loadDetail(@CurrentUser() user: AuthUser, @Param('announcementId') announcementId: string): Promise<DriverLoadDto> {
    return this.loads.detail(user, uuid(announcementId, 'announcementId'));
  }

  @Post('reservations')
  @RateLimitBucket('reserve')
  reserve(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createReservationSchema)) body: CreateReservationInput,
  ): Promise<DriverReservationDto> {
    return this.reservations.create(user, body);
  }

  @Get('reservations')
  listReservations(
    @CurrentUser() user: AuthUser,
    @Query('view') view?: string,
  ): Promise<DriverReservationDto[]> {
    if (view !== undefined && view !== 'active' && view !== 'history') {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'view', message: 'active|history' }] });
    }
    return this.reservations.list(user, view ?? 'active');
  }

  @Post('reservations/:id/cancel-request')
  @HttpCode(200)
  cancelRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(cancelRequestSchema)) body: CancelRequestInput,
  ): Promise<DriverReservationDto> {
    return this.reservations.cancelRequest(user, uuid(id, 'id'), body);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser): Promise<DriverHistoryDto> {
    return this.queue.history(user);
  }
}
