import { cn } from '../cn';
import { uiStrings } from '../strings';

export interface SkeletonProps {
  className?: string;
}

/** Shimmer placeholder (animation disabled under prefers-reduced-motion via styles.css). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative h-4 overflow-hidden rounded-lg bg-surface-container',
        'before:absolute before:inset-0 before:translate-x-full before:animate-shimmer',
        'before:bg-gradient-to-l before:from-transparent before:via-surface-card/70 before:to-transparent',
        className,
      )}
    />
  );
}

export function SkeletonBlock({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label={uiStrings.loading} className={cn('flex flex-col gap-space-xs', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}
