import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { mapError } from './error-mapping';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const mapped = mapError(exception);
    if (mapped.unexpected) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    if (res.headersSent) return;
    res.status(mapped.status).json(mapped.body);
  }
}
