'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, ListChecks, Megaphone, Users, Warehouse } from 'lucide-react';
import {
  HALL_CATEGORY_LABELS_FA,
  HALL_DAY_STATUS_LABELS_FA,
  faNumber,
  isoDateToJalali,
  toJalali,
  type FactoryDashboardDto,
  type HallDayStatus,
} from '@cb/shared';
import { Alert, Badge, Card, EmptyState, KpiCard, button3DClasses, type Tone } from '@cb/ui';
import { ErrorState, PageSkeleton } from '@/components/StateViews';
import { fa } from '@/i18n/fa';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';

const DAY_TONE: Record<HallDayStatus, Tone> = {
  SCHEDULED: 'info',
  OPEN: 'success',
  ALLOCATING: 'warning',
  CLOSED: 'neutral',
  HALTED: 'danger',
  CANCELLED: 'neutral',
};

export function FactoryDashboard() {
  const me = useMe();
  const q = useQuery({
    queryKey: ['factory', 'dashboard'],
    queryFn: ({ signal }) => api.get<FactoryDashboardDto>('/factory/dashboard', { signal }),
    refetchInterval: 60_000,
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <p className="text-label-md text-text-muted">
          {fa.roles.factory} · {isoDateToJalali(d.today)}
        </p>
        <h1 className="text-headline-lg-mobile text-text-primary md:text-headline-lg">
          {me.data ? fa.dashboard.welcome(me.data.displayName) : fa.dashboard.welcomeFallback}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t.dashboard.kpis.announcementsToday} value={faNumber(d.announcementsToday)} tone="primary" icon={<Megaphone className="size-5" />} />
        <KpiCard title={t.dashboard.kpis.activeReservations} value={faNumber(d.activeReservations)} tone="success" icon={<ListChecks className="size-5" />} />
        <KpiCard
          title={t.dashboard.kpis.activeCarriers}
          value={faNumber(d.carriers.active)}
          caption={d.carriers.suspended ? t.dashboard.suspended(faNumber(d.carriers.suspended)) : undefined}
          tone="info"
          icon={<Building2 className="size-5" />}
        />
        <KpiCard
          title={t.dashboard.kpis.approvedDrivers}
          value={faNumber(d.drivers.approved)}
          caption={t.dashboard.pendingBlocked(faNumber(d.drivers.pending), faNumber(d.drivers.blocked))}
          tone="purple"
          icon={<Users className="size-5" />}
        />
      </div>

      {d.carriersWithoutQuota > 0 ? (
        <Alert
          tone="warning"
          title={t.dashboard.withoutQuota(faNumber(d.carriersWithoutQuota))}
          action={
            <Link href="/factory/carriers" className={button3DClasses({ variant: 'neutral', size: 'sm' })}>
              {t.dashboard.manageQuotas}
            </Link>
          }
        />
      ) : null}

      <Card>
        <h2 className="mb-space-md text-headline-md text-text-primary">{t.dashboard.hallsToday}</h2>
        {d.hallsToday.length === 0 ? (
          <EmptyState icon={<Warehouse className="size-7" />} title={t.dashboard.noHalls} />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {d.hallsToday.map((h) => (
              <li key={h.hallId} className="flex flex-wrap items-center justify-between gap-space-sm py-space-sm">
                <div className="min-w-0">
                  <Link href={`/factory/halls/${h.hallId}`} className="text-headline-sm text-primary-container hover:underline">
                    {h.hallTitle}
                  </Link>
                  <p className="text-body-sm text-text-secondary">{HALL_CATEGORY_LABELS_FA[h.category]}</p>
                </div>
                {h.status ? (
                  <div className="flex items-center gap-space-sm">
                    <span className="text-body-sm text-text-secondary" dir="ltr">
                      {toJalali(h.t0At!, 'HH:mm')} – {toJalali(h.hallEndAt!, 'HH:mm')}
                    </span>
                    <Badge tone={DAY_TONE[h.status]}>{HALL_DAY_STATUS_LABELS_FA[h.status]}</Badge>
                  </div>
                ) : (
                  <span className="text-body-sm text-text-muted">{t.dashboard.noHallDay}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
