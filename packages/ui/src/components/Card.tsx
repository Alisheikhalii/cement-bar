import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';
import { toneBg, toneSoft, type Tone } from '../tokens';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /** Adds hover lift (transform + shadow only). */
  interactive?: boolean;
}

export function Card({ interactive, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-surface-card p-space-md shadow-elevation-1 md:p-space-lg',
        interactive &&
          'cursor-pointer transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover',
        className,
      )}
      {...rest}
    />
  );
}

export interface KpiCardProps {
  title: string;
  value: ReactNode;
  caption?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
}

export function KpiCard({ title, value, caption, icon, tone = 'primary', className }: KpiCardProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-surface-card p-space-md shadow-elevation-1', className)}>
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1.5', toneBg[tone])} />
      <div className="flex items-start justify-between gap-space-sm pt-1">
        <p className="text-label-lg text-text-secondary">{title}</p>
        {icon ? (
          <span
            className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', toneSoft[tone])}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-space-xs text-display-hero text-text-primary">{value}</p>
      {caption ? <p className="mt-1 text-caption text-text-muted">{caption}</p> : null}
    </div>
  );
}
