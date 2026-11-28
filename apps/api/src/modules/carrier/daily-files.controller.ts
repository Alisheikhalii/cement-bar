import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CARRIER_DAILY_FILE_COLUMNS } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { CarrierDailyFilesService } from './daily-files.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Roles('CARRIER_OPERATOR')
@Controller('carrier/daily-files')
export class CarrierDailyFilesController {
  constructor(private readonly files: CarrierDailyFilesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, CARRIER_DAILY_FILE_COLUMNS);
    const { rows, total } = await this.files.list(user, parsed);
    return respondList(res, parsed, CARRIER_DAILY_FILE_COLUMNS, rows, total, 'daily-files');
  }

  @Get(':id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const f = await this.files.download(user, id);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', f.disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(f.stream);
  }
}
