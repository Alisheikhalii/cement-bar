import type { ReactNode } from 'react';
import { faDigits, isoDateToJalali } from '@cb/shared';
import { cn } from '../cn';
import { credentialLevel, credentialProgress, type CredentialLevel } from '../helpers/credential';
import { uiStrings } from '../strings';
import { Badge } from './Badge';
import type { Tone } from '../tokens';

export interface CredentialCardProps {
  title: string;
  icon?: ReactNode;
  /** Local ISO expiry date "YYYY-MM-DD"; undefined = not set yet (placeholder). */
  expiryIso?: string;
  /** Days remaining computed with the server clock (daysUntil from @cb/shared). */
  daysLeft?: number;
  /** Status label per level, e.g. { success: 'معتبر', ... }. */
  levelLabels?: Partial<Record<CredentialLevel, string>>;
  className?: string;
}

const levelTone: Record<CredentialLevel, Tone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  expired: 'danger',
};
const levelBar: Record<CredentialLevel, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  expired: 'bg-danger',
};
const levelText: Record<CredentialLevel, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  expired: 'text-danger',
};
const defaultLabels: Record<CredentialLevel, string> = {
  success: 'معتبر',
  warning: 'نزدیک انقضا',
  danger: 'رو به انقضا',
  expired: uiStrings.expired,
};

export function CredentialCard({ title, icon, expiryIso, daysLeft, levelLabels, className }: CredentialCardProps) {
  const known = daysLeft !== undefined && expiryIso !== undefined;
  const level = known ? credentialLevel(daysLeft) : null;
  const labels = { ...defaultLabels, ...levelLabels };

  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-surface-card p-space-md shadow-elevation-1', className)}>
      <span aria-hidden className={cn('absolute inset-y-0 start-0 w-1.5', level ? levelBar[level] : 'bg-outline-variant')} />
      <div className="flex items-center justify-between gap-space-xs">
        <div className="flex min-w-0 items-center gap-space-xs">
          {icon ? (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-low text-primary-container" aria-hidden>
              {icon}
            </span>
          ) : null}
          <p className="truncate text-label-lg text-text-primary">{title}</p>
        </div>
        {level ? <Badge tone={levelTone[level]}>{labels[level]}</Badge> : null}
      </div>

      <div className="mt-space-sm flex items-baseline gap-space-xs">
        <span className={cn('text-display-hero', level ? levelText[level] : 'text-text-muted')}>
          {known ? (level === 'expired' ? '—' : faDigits(daysLeft)) : '—'}
        </span>
        <span className="text-label-sm text-text-secondary">
          {level === 'expired' ? uiStrings.expired : uiStrings.daysLeft}
        </span>
      </div>

      <div
        className="mt-space-sm h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? credentialProgress(daysLeft) : 0}
      >
        <div
          className={cn('h-full rounded-full', level ? levelBar[level] : 'bg-outline-variant')}
          style={{ width: `${known ? credentialProgress(daysLeft) : 0}%` }}
        />
      </div>

      <p className="mt-space-xs text-caption text-text-muted">
        {uiStrings.expiresOn}: {expiryIso ? isoDateToJalali(expiryIso) : '—'}
      </p>
    </div>
  );
}
