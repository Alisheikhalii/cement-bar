'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity } from 'lucide-react';
import { cn } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { NAV, isActive, type Panel } from './nav';

export function SidebarNav({ panel, onNavigate }: { panel: Panel; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="mx-space-sm mt-space-md flex items-center gap-space-xs rounded-xl bg-surface-container-low px-space-sm py-space-xs">
        <Activity className="size-4 shrink-0 text-text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="text-label-md text-text-secondary">{fa.common.hallStatus}</p>
          <p className="text-caption text-text-muted">{fa.common.hallStatusUnknown}</p>
        </div>
      </div>
      <nav aria-label={fa.roles[panel]} className="flex-1 overflow-y-auto px-space-sm py-space-md">
        {NAV[panel].map((group) => (
          <div key={group.title} className="mb-space-md">
            <p className="mb-1 px-space-sm text-label-sm text-text-muted">{group.title}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center gap-space-sm rounded-xl px-space-sm text-label-lg transition-colors',
                        active
                          ? 'bg-primary-container text-on-primary shadow-elevation-2'
                          : 'text-text-body hover:bg-surface-container-low hover:text-primary-container',
                      )}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
