import { PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { DomainError } from '../errors/domain-error';
import { zodDetails } from '../errors/error-mapping';

/** Parse `input` with a Zod schema; throws DomainError(VALIDATION_FAILED) with issue details. */
export function parseWith<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('VALIDATION_FAILED', zodDetails(r.error));
  return r.data;
}

/** Usage: `@Body(new ZodPipe(loginSchema)) body: LoginInput`. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    return parseWith(this.schema, value);
  }
}
