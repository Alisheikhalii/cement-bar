import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { DAILY_FILE_MAX_BYTES, FACTORY_DAILY_FILE_COLUMNS, dailyFileMetaSchema } from '@cb/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { mapError } from '../../common/errors/error-mapping';
import { DomainError } from '../../common/errors/domain-error';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { ZodPipe } from '../../common/validation/zod';
import { DailyFilesService, type UploadedFileLike } from './daily-files.service';

/** Multer's size-limit error → standard FILE_TOO_LARGE body (instead of a generic 413). */
@Catch(PayloadTooLargeException)
class FileTooLargeFilter implements ExceptionFilter {
  catch(_e: PayloadTooLargeException, host: ArgumentsHost): void {
    const mapped = mapError(new DomainError('FILE_TOO_LARGE', { maxBytes: DAILY_FILE_MAX_BYTES }));
    host.switchToHttp().getResponse<Response>().status(mapped.status).json(mapped.body);
  }
}

/** Memory storage: the buffer is validated before anything touches the disk. utf8 keeps Persian filenames intact. */
const uploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: DAILY_FILE_MAX_BYTES, files: 1, fields: 5, parts: 6 },
  defParamCharset: 'utf8',
};

@Roles('FACTORY_OPERATOR')
@Controller('factory/daily-files')
export class DailyFilesController {
  constructor(private readonly files: DailyFilesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, FACTORY_DAILY_FILE_COLUMNS);
    const { rows, total } = await this.files.list(user, parsed);
    return respondList(res, parsed, FACTORY_DAILY_FILE_COLUMNS, rows, total, 'daily-files');
  }

  /** multipart/form-data: file (xlsx) + carrierId, forDate, note? */
  @Post()
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  upload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(dailyFileMetaSchema)) body: z.infer<typeof dailyFileMetaSchema>,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.files.upload(user, body, file);
  }
}
