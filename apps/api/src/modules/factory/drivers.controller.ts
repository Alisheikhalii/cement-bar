import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FACTORY_DRIVER_COLUMNS, driverBlockSchema, optionalNoteSchema } from '@cb/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { ZodPipe } from '../../common/validation/zod';
import { FactoryDriversService } from './drivers.service';
import { UuidPipe } from './factory.util';

@Roles('FACTORY_OPERATOR')
@Controller('factory/drivers')
export class FactoryDriversController {
  constructor(private readonly drivers: FactoryDriversService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, FACTORY_DRIVER_COLUMNS);
    const { rows, total } = await this.drivers.list(user, parsed);
    return respondList(res, parsed, FACTORY_DRIVER_COLUMNS, rows, total, 'drivers');
  }

  @Post(':id/block')
  @HttpCode(200)
  block(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(driverBlockSchema)) body: z.infer<typeof driverBlockSchema>,
  ) {
    return this.drivers.block(user, id, body);
  }

  @Post(':id/unblock')
  @HttpCode(200)
  unblock(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(optionalNoteSchema)) body: z.infer<typeof optionalNoteSchema>,
  ) {
    return this.drivers.unblock(user, id, body.note);
  }
}
