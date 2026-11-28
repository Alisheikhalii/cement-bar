import type { ReactNode } from 'react';
import { ServiceWorkerRegister } from '@/components/driver/ServiceWorkerRegister';
import { AppShell } from '@/components/shell/AppShell';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <ServiceWorkerRegister />
      <AppShell panel="driver">{children}</AppShell>
    </>
  );
}
