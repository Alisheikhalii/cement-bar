import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  hallCreateSchema,
  hallDayCreateSchema,
  hallDayGenerateSchema,
  hallDayUpdateSchema,
  hallScheduleReplaceSchema,
  hallUpdateSchema,
  reasonSchema,
  zIsoDate,
  type HallCreateInput,
  type HallDayCreateInput,
  type ReasonInput,
} from '@cb/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { ZodPipe } from '../../common/validation/zod';
import { parsePatch, UuidPipe } from './factory.util';
import { HallsService } from './halls.service';

const dayRangeQuery = z.object({ from: zIsoDate.optional(), to: zIsoDate.optional() }).strict();

@Roles('FACTORY_OPERATOR')
@Controller('factory/halls')
export class HallsController {
  constructor(private readonly halls: HallsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.halls.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(hallCreateSchema)) body: HallCreateInput) {
    return this.halls.create(user, body);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.halls.detail(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() body: unknown) {
    return this.halls.update(user, id, parsePatch(hallUpdateSchema, body));
  }

  @Put(':id/schedules')
  replaceSchedules(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(hallScheduleReplaceSchema)) body: z.infer<typeof hallScheduleReplaceSchema>,
  ) {
    return this.halls.replaceSchedules(user, id, body.items);
  }

  @Get(':id/days')
  days(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodPipe(dayRangeQuery)) q: z.infer<typeof dayRangeQuery>,
  ) {
    return this.halls.listDays(user, id, q);
  }

  @Post(':id/days')
  createDay(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(hallDayCreateSchema)) body: HallDayCreateInput,
  ) {
    return this.halls.createDay(user, id, body);
  }

  @Post(':id/days/generate')
  generate(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(hallDayGenerateSchema)) body: z.infer<typeof hallDayGenerateSchema>,
  ) {
    return this.halls.generateDays(user, id, body.from, body.days);
  }

  @Patch(':id/days/:dayId')
  updateDay(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('dayId', UuidPipe) dayId: string,
    @Body(new ZodPipe(hallDayUpdateSchema)) body: z.infer<typeof hallDayUpdateSchema>,
  ) {
    return this.halls.updateDay(user, id, dayId, body);
  }

  @Post(':id/days/:dayId/halt')
  @HttpCode(200)
  halt(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('dayId', UuidPipe) dayId: string,
    @Body(new ZodPipe(reasonSchema)) body: ReasonInput,
  ) {
    return this.halls.haltDay(user, id, dayId, body.reason);
  }
}
