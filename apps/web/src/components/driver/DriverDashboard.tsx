'use client';
import Link from 'next/link';
import {
  CalendarClock,
  ClipboardList,
  HeartPulse,
  IdCard,
  Landmark,
  ShieldAlert,
  Ticket,
  Truck,
  UserCircle,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  CARRIER_STATUS_LABELS_FA,
  DRIVER_STATUS_LABELS_FA,
  VEHICLE_STATUS_LABELS_FA,
  type DriverDocumentKind,
  type DriverStatus,
} from '@cb/shared';
import { Alert, Badge, Card, CredentialCard, type Tone } from '@cb/ui';
import { ErrorState, PageSkeleton } from '@/components/StateViews';
import { fa } from '@/i18n/fa';
import { faDriver } from '@/i18n/driver';
import { errorMessage } from '@/lib/api';
import { alertContent, plateFa } from './format';
import { useDriverDashboard } from './queries';

const d = faDriver.dashboard;

const STATUS_TONE: Record<DriverStatus, Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  BLOCKED: 'danger',
};

const DOC_ICONS: Record<DriverDocumentKind, LucideIcon> = {
  HEALTH_CARD: HeartPulse,
  SMART_CARD: IdCard,
  INSPECTION: Wrench,
};

const MAIN_SHORTCUTS = [
  { href: '/driver/bag-hall', label: fa.nav.driver.bagHall, icon: Ticket, tone: 'bg-primary-container' },
  { href: '/driver/loads', label: fa.nav.driver.loads, icon: Truck, tone: 'bg-success' },
  { href: '/driver/halls', label: fa.nav.driver.halls, icon: Warehouse, tone: 'bg-info' },
  { href: '/driver/history', label: fa.nav.driver.history, icon: ClipboardList, tone: 'bg-purple' },
] as const;

const ACCOUNT_SHORTCUTS = [
  { href: '/driver/profile', label: faDriver.shortcuts.profile, icon: UserCircle },
  { href: '/driver/hall-hours', label: faDriver.shortcuts.hallHours, icon: CalendarClock },
  { href: '/driver/companies', label: faDriver.shortcuts.companies, icon: Landmark },
] as const;

export function DriverDashboard() {
  const q = useDriverDashboard();

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const data = q.data;
  const fullName = `${data.driver.firstName} ${data.driver.lastName}`;

  return (
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="text-headline-lg-mobile text-text-primary md:text-headline-lg">
          {fa.dashboard.welcome(fullName)}
        </h1>
        <div className="flex flex-wrap items-center gap-space-xs">
          <Badge tone={STATUS_TONE[data.driver.status]}>
            {fa.dashboard.accountStatus}: {DRIVER_STATUS_LABELS_FA[data.driver.status]}
          </Badge>
          <Badge tone={data.driver.canOperate ? 'success' : 'neutral'}>
            {data.driver.canOperate ? d.canOperate : d.cannotOperate}
          </Badge>
        </div>
      </div>

      {data.alerts.length > 0 ? (
        <section aria-labelledby="drv-alerts" className="flex flex-col gap-space-sm">
          <h2 id="drv-alerts" className="sr-only">
            {d.alertsTitle}
          </h2>
          {data.alerts.map((alert, i) => {
            const c = alertContent(alert);
            return (
              <Alert key={`${alert.kind}-${alert.document ?? i}`} tone={alert.tone} title={c.title}>
                {c.body}
              </Alert>
            );
          })}
        </section>
      ) : null}

      <section aria-labelledby="drv-docs" className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <h2 id="drv-docs" className="text-headline-sm text-text-primary">
            {d.documentsTitle}
          </h2>
          <Link
            href="/driver/profile"
            className="text-label-lg text-primary-container underline-offset-4 hover:underline"
          >
            {d.updateDocuments}
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          {data.documents.map((doc) => {
            const Icon = DOC_ICONS[doc.kind];
            return (
              <CredentialCard
                key={doc.kind}
                title={faDriver.docNames[doc.kind]}
                icon={<Icon className="size-5" />}
                expiryIso={doc.expiry}
                daysLeft={doc.daysLeft}
                levelLabels={faDriver.docLevels}
              />
            );
          })}
        </div>
        <p className="text-caption text-text-muted">{d.documentsHint}</p>
      </section>

      <section className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
        <Card className="flex flex-col gap-space-xs">
          <p className="text-label-md text-text-secondary">{d.myCarrier}</p>
          <div className="flex flex-wrap items-center gap-space-xs">
            <p className="text-headline-sm text-text-primary">{data.carrier.name}</p>
            {data.carrier.status !== 'ACTIVE' ? (
              <Badge tone="warning">{CARRIER_STATUS_LABELS_FA[data.carrier.status]}</Badge>
            ) : null}
          </div>
        </Card>
        <Card className="flex flex-col gap-space-xs">
          <p className="text-label-md text-text-secondary">{d.myVehicle}</p>
          {data.vehicle ? (
            <div className="flex flex-wrap items-center gap-space-xs">
              <p className="text-headline-sm text-text-primary" dir="rtl">
                {plateFa(data.vehicle.plate)}
              </p>
              {data.vehicle.loaderType ? <Badge tone="info">{data.vehicle.loaderType.title}</Badge> : null}
              {data.vehicle.status !== 'APPROVED' ? (
                <Badge tone="warning">{VEHICLE_STATUS_LABELS_FA[data.vehicle.status]}</Badge>
              ) : null}
            </div>
          ) : (
            <p className="text-body-md text-text-muted">{d.noVehicle}</p>
          )}
        </Card>
      </section>

      <section aria-labelledby="drv-shortcuts" className="flex flex-col gap-space-sm">
        <h2 id="drv-shortcuts" className="text-headline-sm text-text-primary">
          {d.shortcutsTitle}
        </h2>
        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
          {MAIN_SHORTCUTS.map((s) => (
            <Link key={s.href} href={s.href} className="group rounded-2xl focus-visible:outline-none">
              <Card
                interactive
                className="flex h-full flex-col items-center gap-space-xs p-space-md text-center md:p-space-md"
              >
                <span
                  className={`flex size-12 items-center justify-center rounded-2xl text-on-primary shadow-elevation-2 ${s.tone}`}
                >
                  <s.icon className="size-6" aria-hidden />
                </span>
                <span className="text-label-lg text-text-primary">{s.label}</span>
              </Card>
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-3">
          {ACCOUNT_SHORTCUTS.map((s) => (
            <Link key={s.href} href={s.href} className="group rounded-2xl focus-visible:outline-none">
              <Card interactive className="flex items-center gap-space-sm p-space-md md:p-space-md">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-low text-primary-container">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="text-label-lg text-text-primary">{s.label}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="drv-rules" className="flex flex-col gap-space-sm">
        <h2 id="drv-rules" className="text-headline-sm text-text-primary">
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
