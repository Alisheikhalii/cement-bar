'use client';
import { KeyRound, Truck, UserCircle } from 'lucide-react';
import { Tabs } from '@cb/ui';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/StateViews';
import { faDriver } from '@/i18n/driver';
import { errorMessage } from '@/lib/api';
import { DriverInfoForm } from './DriverInfoForm';
import { PasswordForm } from './PasswordForm';
import { useDriverProfile } from './queries';
import { VehiclePanel } from './VehiclePanel';

const p = faDriver.profile;

function DriverTab() {
  const q = useDriverProfile();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  // key: remount the form with fresh defaults after a refetch from another tab/device
  return <DriverInfoForm key={q.dataUpdatedAt} profile={q.data} />;
}

export function ProfileView() {
  return (
    <div>
      <PageHeader title={p.title} description={p.description} />
      <Tabs
        fullWidth
        aria-label={p.title}
        items={[
          {
            value: 'driver',
            label: p.tabs.driver,
            icon: <UserCircle className="size-4" aria-hidden />,
            content: <DriverTab />,
          },
          {
            value: 'vehicle',
            label: p.tabs.vehicle,
            icon: <Truck className="size-4" aria-hidden />,
            content: <VehiclePanel />,
          },
          {
            value: 'password',
            label: p.tabs.password,
            icon: <KeyRound className="size-4" aria-hidden />,
            content: <PasswordForm />,
          },
        ]}
      />
    </div>
  );
}
