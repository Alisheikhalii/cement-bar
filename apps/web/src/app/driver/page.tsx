'use client';
import Link from 'next/link';
import { ClipboardList, HeartPulse, IdCard, ShieldAlert, Ticket, Truck, Warehouse, Wrench } from 'lucide-react';
import { DRIVER_STATUS_LABELS_FA, type DriverStatus } from '@cb/shared';
import { Alert, Badge, Card, CredentialCard, type Tone } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { useMe } from '@/lib/auth';

const STATUS_TONE: Record<DriverStatus, Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  BLOCKED: 'danger',
};

const SHORTCUTS = [
  { href: '/driver/bag-hall', label: fa.nav.driver.bagHall, icon: Ticket, tone: 'bg-primary-container' },
  { href: '/driver/loads', label: fa.nav.driver.loads, icon: Truck, tone: 'bg-success' },
  { href: '/driver/halls', label: fa.nav.driver.halls, icon: Warehouse, tone: 'bg-info' },
  { href: '/driver/history', label: fa.nav.driver.history, icon: ClipboardList, tone: 'bg-purple' },
] as const;

const CRED_ICONS = [HeartPulse, IdCard, Wrench] as const;

function isDriverStatus(s: string | undefined): s is DriverStatus {
  return s !== undefined && s in DRIVER_STATUS_LABELS_FA;
}

export default function DriverDashboard() {
  const me = useMe();
  const status = me.data?.driver?.status;
  const known = isDriverStatus(status);

  return (
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="text-headline-lg-mobile text-text-primary md:text-headline-lg">
          {me.data ? fa.dashboard.welcome(me.data.displayName) : fa.dashboard.welcomeFallback}
        </h1>
        {known ? (
          <Badge tone={STATUS_TONE[status]}>
            {fa.dashboard.accountStatus}: {DRIVER_STATUS_LABELS_FA[status]}
          </Badge>
        ) : null}
      </div>

      {status === 'PENDING' ? (
        <Alert tone="warning" title={fa.dashboard.pendingBanner}>
          {fa.dashboard.pendingBannerHint}
        </Alert>
      ) : null}

      <section aria-labelledby="creds" className="flex flex-col gap-space-sm">
        <h2 id="creds" className="sr-only">
          {fa.dashboard.driverCredentials.join('، ')}
        </h2>
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          {fa.dashboard.driverCredentials.map((title, i) => {
            const Icon = CRED_ICONS[i] ?? IdCard;
            return <CredentialCard key={title} title={title} icon={<Icon className="size-5" />} />;
          })}
        </div>
        <p className="text-caption text-text-muted">{fa.dashboard.credentialPending}</p>
      </section>

      <section aria-labelledby="shortcuts">
        <h2 id="shortcuts" className="mb-space-sm text-headline-sm text-text-primary">
          {fa.dashboard.shortcutsTitle}
        </h2>
        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
          {SHORTCUTS.map((s) => (
            <Link key={s.href} href={s.href} className="group rounded-2xl focus-visible:outline-none">
              <Card interactive className="flex h-full flex-col items-center gap-space-xs p-space-md text-center md:p-space-md">
                <span className={`flex size-12 items-center justify-center rounded-2xl text-on-primary shadow-elevation-2 ${s.tone}`}>
                  <s.icon className="size-6" aria-hidden />
                </span>
                <span className="text-label-lg text-text-primary">{s.label}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="rules" className="flex flex-col gap-space-sm">
        <h2 id="rules" className="text-headline-sm text-text-primary">
          {fa.dashboard.rulesTitle}
        </h2>
        <Alert tone="info" icon={<ShieldAlert className="size-5 shrink-0" aria-hidden />}>
          {fa.dashboard.penaltyRule}
        </Alert>
        <Alert tone="info">{fa.dashboard.twoPhonesRule}</Alert>
      </section>
    </div>
  );
}
