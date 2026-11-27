import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERRORS, type ApiErrorBody, type ErrorCode } from '@cb/shared';
import { ZodError } from 'zod';
import { DomainError } from './domain-error';

export interface MappedError {
  status: number;
  body: ApiErrorBody;
  /** true when the error is unexpected and must be logged with its stack. */
  unexpected: boolean;
}

const HTTP_STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_FAILED',
  415: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

function build(code: ErrorCode, details?: unknown, unexpected = false): MappedError {
  const def = ERRORS[code];
  const error: ApiErrorBody['error'] = { code, message: def.fa };
  if (details !== undefined) error.details = details;
  return { status: def.status, body: { error }, unexpected };
}

export function zodDetails(err: ZodError): { issues: { path: string; message: string }[] } {
  return {
    issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

/** Extract a stable field name from a unique-constraint violation. */
export function uniqueViolationField(err: Prisma.PrismaClientKnownRequestError): string | undefined {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String).join(',');
  if (typeof target === 'string') return target;
  return undefined;
}

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Partial<BodyParserError>;
  return typeof e.type === 'string' && typeof e.status === 'number' && e.status >= 400 && e.status < 500;
}

/** Pure mapping of any thrown value → standard API error. No stack traces leave the server. */
export function mapError(err: unknown): MappedError {
  if (err instanceof DomainError) return build(err.code, err.details);
  if (err instanceof ZodError) return build('VALIDATION_FAILED', zodDetails(err));
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const field = uniqueViolationField(err);
      return build('CONFLICT', field ? { field } : undefined);
    }
    if (err.code === 'P2025') return build('NOT_FOUND');
    return build('INTERNAL', undefined, true);
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code = HTTP_STATUS_TO_CODE[status];
    if (code) return build(code);
    return build('INTERNAL', undefined, status >= 500);
  }
  if (isBodyParserError(err)) return build('VALIDATION_FAILED');
  return build('INTERNAL', undefined, true);
}
