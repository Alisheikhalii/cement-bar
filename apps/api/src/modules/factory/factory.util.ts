import type { PipeTransform } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { parseWith } from '../../common/validation/zod';
import type { ZodType } from 'zod';

/**
 * Zod 4 applies `.default()` inside `.partial()`, so a PATCH body `{ title }` would also reset
 * `active` to its default. Keep only the keys the client actually sent.
 */
export function presentOnly<T extends object>(parsed: T, raw: unknown): Partial<T> {
  if (!raw || typeof raw !== 'object') return {};
  const sent = new Set(Object.keys(raw));
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as Partial<T>;
}

/** Parse a PATCH body: validate with the (partial) schema, then drop defaulted keys that were not sent. */
export function parsePatch<T extends object>(schema: ZodType<T>, raw: unknown): Partial<T> {
  const data = presentOnly(parseWith(schema, raw), raw);
  if (Object.keys(data).length === 0) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: '', message: 'empty update' }] });
  }
  return data;
}

export const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Path params must be UUIDs; anything else is simply "not found" (no DB round trip, no 500 from Prisma). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertUuid(id: string): string {
  if (!UUID_RE.test(id)) throw new DomainError('NOT_FOUND');
  return id;
}

/** `@Param('id', UuidPipe) id: string` — malformed ids are 404, like ids of another tenant. */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return assertUuid(value);
  }
}

/** True when `e` is a unique-constraint violation (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** Common case-insensitive "contains" fragment for free-text search. */
export const ci = (q: string) => ({ contains: q, mode: 'insensitive' as const });
