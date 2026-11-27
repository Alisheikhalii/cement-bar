'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { DRIVER_BOTTOM_NAV, isActive } from './nav';

/** Driver mobile bottom navigation: 4 items, ≥44px targets, respects the iOS safe area. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label={fa.roles.driver}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface-card/95 pb-[env(safe-area-inset-bottom)] shadow-elevation-3 backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {DRIVER_BOTTOM_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-label-sm transition-colors',
                  active ? 'text-primary-container' : 'text-text-secondary',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    active && 'bg-surface-container-high',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
