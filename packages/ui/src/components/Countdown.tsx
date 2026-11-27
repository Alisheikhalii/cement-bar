'use client';
import { useEffect, useState } from 'react';
import { cn } from '../cn';
import { formatCountdown, remainingMs } from '../helpers/countdown';
import { uiStrings } from '../strings';

const TICK_MS = 1000;
/** Announce to screen readers only every N seconds to avoid chatter. */
const ANNOUNCE_EVERY_S = 30;

export interface CountdownProps {
  target: Date;
  /** Server-synchronized clock (useServerClock().now) — never the raw device clock. */
  now: () => number;
  onComplete?: () => void;
  label?: string;
  className?: string;
}

export function Countdown({ target, now, onComplete, label = uiStrings.remaining, className }: CountdownProps) {
  const [left, setLeft] = useState(() => remainingMs(target, now()));

  useEffect(() => {
    let done = false;
    const tick = () => {
      const ms = remainingMs(target, now());
      setLeft(ms);
      if (ms <= 0 && !done) {
        done = true;
        onComplete?.();
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [target, now, onComplete]);

  const text = formatCountdown(left);
  const secs = Math.ceil(left / TICK_MS);
  const announce = secs % ANNOUNCE_EVERY_S === 0 || secs <= 10;

  return (
    <span className={cn('inline-flex flex-col items-center', className)}>
      <span className="text-caption text-text-muted">{label}</span>
      <span dir="ltr" className="text-display-hero tabular-nums text-primary-container" aria-hidden>
        {text}
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic>
        {announce ? `${label}: ${text}` : ''}
      </span>
    </span>
  );
}
