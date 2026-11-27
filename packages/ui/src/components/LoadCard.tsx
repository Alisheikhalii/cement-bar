'use client';
import type { ReactNode } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { faNumber } from '@cb/shared';
import { cn } from '../cn';
import { uiStrings } from '../strings';
import { Badge } from './Badge';
import { Button3D } from './Button3D';
import type { Tone } from '../tokens';

export interface LoadSpec {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
}

export interface LoadCardProps {
  status: { label: string; tone: Tone };
  /** Optional reference (e.g. waybill code) shown on the top-end. */
  reference?: string;
  origin: string;
  destination: string;
  /** Up to 4 specs, rendered as a 2x2 grid. */
  specs: LoadSpec[];
  /** Rial amount as bigint/string/number — displayed with Persian digits. */
  fareRial?: bigint | string | number;
  ctaLabel: string;
  onCta?: () => void;
  ctaLoading?: boolean;
  /** Reserved by someone: red «رزرو شده» tag + disabled CTA. */
  reserved?: boolean;
  disabled?: boolean;
  className?: string;
}

const MAX_SPECS = 4;

export function LoadCard({
  status,
  reference,
  origin,
  destination,
  specs,
  fareRial,
  ctaLabel,
  onCta,
  ctaLoading,
  reserved,
  disabled,
  className,
}: LoadCardProps) {
  return (
    <article
      className={cn(
        'relative flex flex-col gap-space-sm rounded-2xl bg-surface-card p-space-md shadow-elevation-1',
        'transition-[transform,box-shadow] duration-200 hover:shadow-card-hover',
        reserved && 'opacity-90',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-space-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={status.tone}>{status.label}</Badge>
          {reserved ? (
            <Badge tone="danger" solid icon={<Lock className="size-3" aria-hidden />}>
              {uiStrings.reserved}
            </Badge>
          ) : null}
        </div>
        {reference ? <span className="truncate text-caption text-text-muted">{reference}</span> : null}
      </div>

      <div className="flex items-center justify-between gap-space-xs rounded-xl bg-surface-container-low p-space-sm">
        <div className="min-w-0">
          <p className="text-caption text-text-muted">{uiStrings.origin}</p>
          <p className="truncate text-label-lg text-text-primary">{origin}</p>
        </div>
        <ArrowLeft className="size-5 shrink-0 text-primary-container" aria-hidden />
        <div className="min-w-0 text-end">
          <p className="text-caption text-text-muted">{uiStrings.destination}</p>
          <p className="truncate text-label-lg text-primary-container">{destination}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-space-sm gap-y-space-xs">
        {specs.slice(0, MAX_SPECS).map((s) => (
          <div key={s.label} className="flex min-w-0 items-center gap-1.5 text-body-sm text-text-secondary">
            {s.icon ? <span className="shrink-0 text-outline" aria-hidden>{s.icon}</span> : null}
            <dt className="sr-only">{s.label}</dt>
            <dd className="truncate" title={s.label}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex flex-col gap-space-sm border-t border-border-subtle pt-space-sm">
        {fareRial !== undefined ? (
          <div className="flex items-baseline justify-between">
            <span className="text-caption text-text-secondary">{uiStrings.fare}</span>
            <span className="text-headline-md text-text-primary">
              {faNumber(fareRial)} <span className="text-label-sm text-text-secondary">{uiStrings.rial}</span>
            </span>
          </div>
        ) : null}
        <Button3D
          variant={reserved ? 'neutral' : 'success'}
          fullWidth
          size="lg"
          disabled={reserved || disabled}
          loading={ctaLoading}
          onClick={onCta}
        >
          {reserved ? uiStrings.reserved : ctaLabel}
        </Button3D>
      </div>
    </article>
  );
}
