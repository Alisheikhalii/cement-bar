import { describe, expect, it } from 'vitest';
import { credentialLevel, credentialProgress } from './credential';
import { formatCountdown, remainingMs } from './countdown';
import { normalizeNumeric, sanitizePlateDigits } from './plate';

describe('credentialLevel', () => {
  it('maps thresholds: >60 success, 15–60 warning, <15 danger, <0 expired', () => {
    expect(credentialLevel(61)).toBe('success');
    expect(credentialLevel(60)).toBe('warning');
    expect(credentialLevel(15)).toBe('warning');
    expect(credentialLevel(14)).toBe('danger');
    expect(credentialLevel(0)).toBe('danger');
    expect(credentialLevel(-1)).toBe('expired');
  });
  it('progress is clamped 0..100', () => {
    expect(credentialProgress(-5)).toBe(0);
    expect(credentialProgress(1000)).toBe(100);
    expect(credentialProgress(73)).toBe(20);
  });
});

describe('formatCountdown', () => {
  it('formats mm:ss with Persian digits', () => {
    expect(formatCountdown(65_000)).toBe('۰۱:۰۵');
    expect(formatCountdown(0)).toBe('۰۰:۰۰');
  });
  it('rounds partial seconds up and clamps negatives', () => {
    expect(formatCountdown(1_200)).toBe('۰۰:۰۲');
    expect(formatCountdown(-5_000)).toBe('۰۰:۰۰');
  });
  it('shows hours when ≥ 1h', () => {
    expect(formatCountdown(3_723_000)).toBe('۰۱:۰۲:۰۳');
  });
  it('remainingMs uses injected now and never goes negative', () => {
    const target = new Date('2026-11-27T06:30:00Z');
    expect(remainingMs(target, target.getTime() - 5000)).toBe(5000);
    expect(remainingMs(target, target.getTime() + 5000)).toBe(0);
  });
});

describe('plate helpers', () => {
  it('normalizes Persian digits and truncates to part length', () => {
    expect(sanitizePlateDigits('۱۲۳', 'two')).toBe('12');
    expect(sanitizePlateDigits('٣٤٥٦', 'three')).toBe('345');
    expect(sanitizePlateDigits('a6b7', 'iran')).toBe('67');
  });
  it('rejects non-digits entirely', () => {
    expect(sanitizePlateDigits('ب', 'two')).toBe('');
  });
  it('normalizeNumeric strips separators and keeps decimals only when allowed', () => {
    expect(normalizeNumeric('۱٬۲۵۰٬۰۰۰')).toBe('1250000');
    expect(normalizeNumeric('۲٫۵', true)).toBe('2.5');
    expect(normalizeNumeric('۲٫۵')).toBe('25');
  });
});
