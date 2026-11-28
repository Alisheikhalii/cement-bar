import { faDigits, formatDateTimeFa, localDate, localTime, type DriverAlertDto } from '@cb/shared';
import { faDriver } from '@/i18n/driver';

const a = faDriver.alerts;

export interface AlertContent {
  title: string;
  body: string;
}

function untilText(until: string | null | undefined): string {
  return until ? formatDateTimeFa(until) : a.indefinite;
}

/** Persian title/body for a dashboard alert (pure; server already decided which alerts apply). */
export function alertContent(alert: DriverAlertDto): AlertContent {
  const doc = alert.document ? faDriver.docNames[alert.document] : '';
  switch (alert.kind) {
    case 'PENDING_APPROVAL':
      return { title: a.PENDING_APPROVAL.title, body: a.PENDING_APPROVAL.body };
    case 'REJECTED':
      return { title: a.REJECTED.title, body: a.REJECTED.body + (alert.reason || a.noReason) };
    case 'BLOCKED': {
      const reason = a.BLOCKED.body + (alert.reason || a.noReason);
      return {
        title: a.BLOCKED.title,
        body: alert.until ? `${reason} — ${a.until} ${untilText(alert.until)}` : reason,
      };
    }
    case 'PENALIZED':
      return { title: a.PENALIZED.title, body: a.PENALIZED.body + untilText(alert.until) };
    case 'DOCUMENT_EXPIRED':
      return { title: a.DOCUMENT_EXPIRED.title(doc), body: a.DOCUMENT_EXPIRED.body };
    case 'DOCUMENT_EXPIRING':
      return {
        title: a.DOCUMENT_EXPIRING.title(doc),
        body: a.DOCUMENT_EXPIRING.body(faDigits(alert.daysLeft ?? 0)),
      };
    case 'VEHICLE_CHANGE_PENDING':
      return { title: a.VEHICLE_CHANGE_PENDING.title, body: a.VEHICLE_CHANGE_PENDING.body };
    case 'NO_VEHICLE':
      return { title: a.NO_VEHICLE.title, body: a.NO_VEHICLE.body };
  }
}

/** "HH:mm" (Persian digits) of an ISO instant in Tehran, with a next-day marker relative to `date`. */
export function hallTime(iso: string, date: string): string {
  const at = new Date(iso);
  const t = faDigits(localTime(at));
  return localDate(at) > date ? `${t} ${faDriver.hallHours.nextDay}` : t;
}

/** Display a normalised plate "65ع576-98" as "۶۵ ع ۵۷۶ - ایران ۹۸". */
export function plateFa(plate: string): string {
  const m = /^(\d{2})(\D+)(\d{3})-(\d{2})$/.exec(plate);
  if (!m) return faDigits(plate);
  return `${faDigits(m[1]!)} ${m[2]} ${faDigits(m[3]!)} - ایران ${faDigits(m[4]!)}`;
}

/** Case/diacritic-tolerant Persian search on company names. */
export function matchesQuery(text: string, query: string): boolean {
  const norm = (s: string) =>
    s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const q = norm(query);
  return q === '' || norm(text).includes(q);
}

/** Field named by an API error's details: `{ field }` (domain checks) or the first zod issue path. */
export function errorField(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const d = details as { field?: unknown; issues?: { path?: unknown }[] };
  if (typeof d.field === 'string') return d.field;
  const first = Array.isArray(d.issues) ? d.issues[0]?.path : undefined;
  return typeof first === 'string' && first !== '' ? first : undefined;
}
