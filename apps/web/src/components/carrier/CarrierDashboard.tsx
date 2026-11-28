'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Gauge, Megaphone, ScrollText, UserCheck } from 'lucide-react';
import { Alert, KpiCard, button3DClasses } from '@cb/ui';
import { faDigits, formatTon, type CarrierDashboardDto } from '@cb/shared';
import { fa } from '@/i18n/fa';
import { faCarrier } from '@/i18n/carrier';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { ErrorState, PageSkeleton } from '@/components/StateViews';

const t = faCarrier.dashboard;
const ton = (kg: string) => formatTon(Number(kg));

/** US-B1: quota & remaining, active announcements, active permits, pending requests (≤ 4 KPIs). */
export function CarrierDashboard() {
  const me = useMe();
  const q = useQuery({
    queryKey: ['carrier', 'dashboard'],
    queryFn: ({ signal }) => api.get<CarrierDashboardDto>('/carrier/dashboard', { signal }),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const name = me.data?.carrier ? `${me.data.displayName} (${me.data.carrier.name})` : me.data?.displayName;
  const pending = d.pendingDrivers + d.pendingVehicleChanges + d.pendingCancelRequests;

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <p className="text-label-md text-text-muted">{fa.roles.carrier}</p>
        <h1 className="text-headline-lg-mobile text-text-primary md:text-headline-lg">
          {name ? fa.dashboard.welcome(name) : fa.dashboard.welcomeFallback}
        </h1>
      </div>
      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`${t.quotaRemaining} ${faDigits(d.yearMonth)}`}
          value={d.quota.remainingKg !== null ? ton(d.quota.remainingKg) : '—'}
          caption={d.quota.limitKg !== null ? t.quotaOf(ton(d.quota.usedKg), ton(d.quota.limitKg)) : t.quotaNotSet}
          tone={d.quota.limitKg === null ? 'warning' : 'primary'}
          icon={<Gauge className="size-5" />}
        />
        <KpiCard title={t.activeAnnouncements} value={faDigits(d.activeAnnouncements)} tone="info" icon={<Megaphone className="size-5" />} />
        <KpiCard title={t.activePermits} value={faDigits(d.activePermits)} tone="success" icon={<ScrollText className="size-5" />} />
        <KpiCard
          title={t.pendingRequests}
          value={faDigits(pending)}
          caption={t.pendingBreakdown(faDigits(d.pendingDrivers), faDigits(d.pendingVehicleChanges), faDigits(d.pendingCancelRequests))}
          tone={pending > 0 ? 'danger' : 'neutral'}
          icon={<UserCheck className="size-5" />}
        />
      </div>
      {d.unseenDailyFiles > 0 ? (
        <Alert
          tone="info"
          icon={<FolderOpen className="size-5" />}
          title={t.unseenFiles(faDigits(d.unseenDailyFiles))}
          action={
            <Link href="/carrier/daily-files" className={button3DClasses({ variant: 'primary', size: 'sm' })}>
              {t.goFiles}
            </Link>
          }
        />
      ) : null}
      <div className="flex flex-wrap gap-space-sm">
        <Link href="/carrier/drivers" className={button3DClasses({ variant: 'neutral', size: 'sm' })}>
          {t.goDrivers}
        </Link>
        <Link href="/carrier/permits" className={button3DClasses({ variant: 'neutral', size: 'sm' })}>
          {t.goPermits}
        </Link>
      </div>
    </div>
  );
}
