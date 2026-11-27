import type { ReactNode } from 'react';
import { cn } from '@cb/ui';
import { BrandMark } from '@/components/shell/BrandMark';

/** Elevated card with the gradient brand header used by login and registration. */
export function AuthCard({
  title,
  subtitle,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'w-full overflow-hidden rounded-3xl bg-surface-card shadow-elevation-3 animate-fade-in',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      <header className="bg-gradient-to-l from-primary-container to-tertiary-container px-space-lg py-space-lg text-on-primary">
        <BrandMark />
        <h1 className="mt-space-md text-headline-md">{title}</h1>
        {subtitle ? <p className="mt-1 text-body-sm text-primary-fixed">{subtitle}</p> : null}
      </header>
      <div className="p-space-lg">{children}</div>
    </section>
  );
}
