/** Semantic tones shared by Badge, KpiCard, Button3D etc. Class strings are literal so Tailwind can scan them. */
export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral';

export const toneSoft: Record<Tone, string> = {
  primary: 'bg-surface-container-low text-primary-container',
  success: 'bg-success-surface text-success',
  warning: 'bg-warning-surface text-warning-bevel',
  danger: 'bg-danger-surface text-danger',
  info: 'bg-info-surface text-info-bevel',
  purple: 'bg-purple-surface text-purple',
  neutral: 'bg-surface-container text-text-secondary',
};

export const toneSolid: Record<Tone, string> = {
  primary: 'bg-primary-container text-on-primary',
  success: 'bg-success text-on-primary',
  warning: 'bg-warning text-on-primary',
  danger: 'bg-danger text-on-primary',
  info: 'bg-info text-on-primary',
  purple: 'bg-purple text-on-primary',
  neutral: 'bg-neutral text-on-primary',
};

/** Background-only (strips, bars, dots). */
export const toneBg: Record<Tone, string> = {
  primary: 'bg-primary-container',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  purple: 'bg-purple',
  neutral: 'bg-neutral',
};

export const toneText: Record<Tone, string> = {
  primary: 'text-primary-container',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  purple: 'text-purple',
  neutral: 'text-text-secondary',
};
