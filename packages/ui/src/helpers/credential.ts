/** Credential (document) validity level thresholds — SPEC §5.1: >60 green, 15–60 orange, <15 red. */
export const CREDENTIAL_OK_DAYS = 60;
export const CREDENTIAL_WARN_DAYS = 15;
/** Progress bar spans a one-year window. */
export const CREDENTIAL_PROGRESS_SPAN_DAYS = 365;

export type CredentialLevel = 'success' | 'warning' | 'danger' | 'expired';

export function credentialLevel(daysLeft: number): CredentialLevel {
  if (daysLeft < 0) return 'expired';
  if (daysLeft > CREDENTIAL_OK_DAYS) return 'success';
  if (daysLeft >= CREDENTIAL_WARN_DAYS) return 'warning';
  return 'danger';
}

/** 0..100 percent of remaining validity in the progress span. */
export function credentialProgress(daysLeft: number): number {
  if (daysLeft <= 0) return 0;
  return Math.min(100, Math.round((daysLeft / CREDENTIAL_PROGRESS_SPAN_DAYS) * 100));
}
