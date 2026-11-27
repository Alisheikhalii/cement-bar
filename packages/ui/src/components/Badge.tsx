import type { ReactNode } from 'react';
import { cn } from '../cn';
import { toneSoft, toneSolid, type Tone } from '../tokens';

export interface BadgeProps {
  tone?: Tone;
  solid?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', solid, icon, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-label-md',
        solid ? toneSolid[tone] : toneSoft[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
