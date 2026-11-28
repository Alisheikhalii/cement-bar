import { DomainError } from '../../common/errors/domain-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Route ids that are not UUIDs can never match a row: answer 404 (never leak a 400/500). */
export function assertUuid(v: unknown): string {
  if (!isUuid(v)) throw new DomainError('NOT_FOUND');
  return v;
}

/** Date-only column (`@db.Date`) → "YYYY-MM-DD". */
export function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
