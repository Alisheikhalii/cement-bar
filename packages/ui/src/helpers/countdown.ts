import { faDigits } from '@cb/shared';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Remaining ms → "mm:ss" (or "hh:mm:ss" when ≥ 1h) in Persian digits. Negative clamps to zero. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / MS_PER_SECOND));
  const h = Math.floor(total / SECONDS_PER_HOUR);
  const m = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  const text = h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  return faDigits(text);
}

export function remainingMs(target: Date, nowMs: number): number {
  return Math.max(0, target.getTime() - nowMs);
}
