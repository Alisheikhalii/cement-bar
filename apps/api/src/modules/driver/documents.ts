import {
  daysUntil,
  type DriverAlertDto,
  type DriverDocumentDto,
  type DriverDocumentKind,
  type DriverDocumentLevel,
} from '@cb/shared';

/** DECISIONS Q-B5: >60 green, 15..60 orange (both bounds inclusive), <15 red, negative = expired. */
export const DOC_OK_DAYS = 60;
export const DOC_WARN_DAYS = 15;

export function documentLevel(daysLeft: number): DriverDocumentLevel {
  if (daysLeft < 0) return 'expired';
  if (daysLeft > DOC_OK_DAYS) return 'success';
  if (daysLeft >= DOC_WARN_DAYS) return 'warning';
  return 'danger';
}

/** Local ISO "YYYY-MM-DD" of a Prisma @db.Date value (stored as UTC midnight). */
export function dateOnlyIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function documentStatus(
  kind: DriverDocumentKind,
  expiryIso: string,
  todayIso: string,
): DriverDocumentDto {
  const daysLeft = daysUntil(expiryIso, todayIso);
  return { kind, expiry: expiryIso, daysLeft, level: documentLevel(daysLeft) };
}

/** Expired → danger alert; danger/warning level (≤60 days) → expiring alert. */
export function documentAlerts(docs: DriverDocumentDto[]): DriverAlertDto[] {
  const out: DriverAlertDto[] = [];
  for (const d of docs) {
    if (d.level === 'expired')
      out.push({ kind: 'DOCUMENT_EXPIRED', tone: 'danger', document: d.kind, daysLeft: d.daysLeft });
    else if (d.level !== 'success')
      out.push({
        kind: 'DOCUMENT_EXPIRING',
        tone: d.level === 'danger' ? 'danger' : 'warning',
        document: d.kind,
        daysLeft: d.daysLeft,
      });
  }
  return out;
}

/** Strict real-calendar check for a "YYYY-MM-DD" string (zIsoDate only checks the shape). */
export function isRealIsoDate(iso: string): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
}

export const isoToDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
