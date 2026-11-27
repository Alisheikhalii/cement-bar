import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const styles: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: 'bg-info-surface text-info-bevel', icon: <Info className="size-5 shrink-0" aria-hidden /> },
  success: { box: 'bg-success-surface text-success', icon: <CheckCircle2 className="size-5 shrink-0" aria-hidden /> },
  warning: { box: 'bg-warning-surface text-warning-bevel', icon: <AlertTriangle className="size-5 shrink-0" aria-hidden /> },
  danger: { box: 'bg-danger-surface text-danger', icon: <XCircle className="size-5 shrink-0" aria-hidden /> },
};

const strips: Record<AlertTone, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Inline callout with a coloured inline-start strip. */
export function Alert({ tone = 'info', title, icon, action, className, children }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'note'}
      className={cn('relative flex items-start gap-space-sm overflow-hidden rounded-2xl p-space-md ps-space-lg', styles[tone].box, className)}
    >
      <span aria-hidden className={cn('absolute inset-y-0 start-0 w-1.5', strips[tone])} />
      {icon ?? styles[tone].icon}
      <div className="min-w-0 flex-1">
        {title ? <p className="text-label-lg">{title}</p> : null}
        {children ? <div className="text-body-sm text-text-body">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
