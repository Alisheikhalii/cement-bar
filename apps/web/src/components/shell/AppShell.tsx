'use client';
import { useState, type ReactNode } from 'react';
import { Drawer, cn } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { RequireRole, useMe } from '@/lib/auth';
import { BottomNav } from './BottomNav';
import { Header } from './Header';
import { SidebarNav } from './Sidebar';
import { PANEL_ROLE, type Panel } from './nav';
import { BrandMark } from './BrandMark';

function ShellFrame({ panel, children }: { panel: Panel; children: ReactNode }) {
  const me = useMe();
  const [drawer, setDrawer] = useState(false);
  const isDriver = panel === 'driver';
  if (!me.data) return null;

  return (
    <div className="min-h-dvh">
      <Header me={me.data} onOpenMenu={() => setDrawer(true)} />

      <aside className="fixed bottom-0 start-0 top-16 z-30 hidden w-72 border-e border-border-subtle bg-surface-card lg:block">
        <SidebarNav panel={panel} />
      </aside>

      <Drawer open={drawer} onOpenChange={setDrawer} title={fa.common.menu}>
        <div className="bg-gradient-to-l from-primary-container to-tertiary-container px-space-md py-space-md pe-14">
          <BrandMark />
        </div>
        <SidebarNav panel={panel} onNavigate={() => setDrawer(false)} />
      </Drawer>

      <main
        id="main"
        className={cn(
          'min-w-0 px-margin-mobile pb-space-xl pt-[calc(4rem+theme(spacing.space-lg))] md:px-margin lg:ps-[calc(18rem+theme(spacing.margin))]',
          isDriver && 'pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-space-xl',
        )}
      >
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>

      {isDriver ? <BottomNav /> : null}
    </div>
  );
}

/** Panel shell: gradient header, right sidebar (drawer on mobile), driver bottom nav. */
export function AppShell({ panel, children }: { panel: Panel; children: ReactNode }) {
  return (
    <RequireRole role={PANEL_ROLE[panel]}>
      <ShellFrame panel={panel}>{children}</ShellFrame>
    </RequireRole>
  );
}
