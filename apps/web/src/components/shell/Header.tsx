'use client';
import { Bell, ChevronDown, LogOut, Menu as MenuIcon } from 'lucide-react';
import { ROLE_LABELS_FA, type MeResponse } from '@cb/shared';
import { EmptyState, Menu, PopoverPanel } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { useLogout } from '@/lib/auth';
import { BrandMark } from './BrandMark';

const headerIconBtn =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-on-primary transition-colors hover:bg-on-primary/15';

export function Header({ me, onOpenMenu }: { me: MeResponse; onOpenMenu: () => void }) {
  const logout = useLogout();
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-space-xs bg-gradient-to-l from-primary-container to-tertiary-container px-space-sm text-on-primary shadow-header md:px-space-lg">
      <button type="button" onClick={onOpenMenu} aria-label={fa.common.openMenu} className={`${headerIconBtn} lg:hidden`}>
        <MenuIcon className="size-6" aria-hidden />
      </button>
      <BrandMark />
      <div className="ms-auto flex items-center gap-1">
        <PopoverPanel
          label={fa.common.notifications}
          triggerClassName={headerIconBtn}
          trigger={<Bell className="size-5" aria-hidden />}
        >
          <EmptyState title={fa.common.noNotifications} className="py-space-md" />
        </PopoverPanel>
        <Menu
          label={me.displayName}
          triggerClassName="flex min-h-11 items-center gap-space-xs rounded-full px-1.5 hover:bg-on-primary/15 sm:pe-space-sm"
          trigger={
            <>
              <span className="flex size-9 items-center justify-center rounded-full bg-on-primary/20 text-label-lg" aria-hidden>
                {me.displayName.trim().charAt(0)}
              </span>
              <span className="hidden max-w-40 truncate text-label-lg sm:inline">{me.displayName}</span>
              <ChevronDown className="hidden size-4 sm:block" aria-hidden />
            </>
          }
          header={
            <div>
              <p className="truncate text-label-lg text-text-primary">{me.displayName}</p>
              <p className="text-caption text-text-muted">
                {ROLE_LABELS_FA[me.role]}
                {me.carrier ? ` — ${me.carrier.name}` : ''}
              </p>
            </div>
          }
          items={[
            {
              key: 'logout',
              label: fa.common.logout,
              icon: <LogOut className="size-4" aria-hidden />,
              danger: true,
              onSelect: () => logout.mutate(),
            },
          ]}
        />
      </div>
    </header>
  );
}
