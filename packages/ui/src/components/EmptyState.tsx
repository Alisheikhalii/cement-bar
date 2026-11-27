import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../cn';
import { uiStrings } from '../strings';

export interface EmptyStateProps {
  title?: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title = uiStrings.empty, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-space-sm px-space-md py-space-2xl text-center',
        className,
      )}
    >
      <span
        className="flex size-14 items-center justify-center rounded-2xl bg-surface-container-low text-primary-container"
        aria-hidden
      >
        {icon ?? <Inbox className="size-7" />}
      </span>
      <p className="text-headline-sm text-text-primary">{title}</p>
      {description ? <p className="max-w-md text-body-sm text-text-secondary">{description}</p> : null}
      {action}
    </div>
  );
}
