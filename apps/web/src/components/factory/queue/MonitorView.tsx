'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Building2, Clock, Eye, RefreshCw } from 'lucide-react';
import { Alert, Badge, Button3D, Card, EmptyState, Skeleton, type Tone } from '@cb/ui';
import {
  BULK_WINDOW_KIND_LABELS_FA,
  HALL_CATEGORY_LABELS_FA,
  HALL_DAY_STATUS_LABELS_FA,
  faDigits,
  formatDateTimeFa,
  isoDateToJalali,
  toJalali,
  type FactoryMonitorDto,
  type FactoryMonitorHallDto,
  type HallDayStatus,
} from '@cb/shared';
import { fq } from '@/i18n/factory-queue';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { api, errorMessage } from '@/lib/api';
import { AllocationRunModal } from './AllocationRunModal';

const DAY_TONE: Record<HallDayStatus, Tone> = {
  SCHEDULED: 'info',
  OPEN: 'success',
  ALLOCATING: 'warning',
  CLOSED: 'neutral',
  HALTED: 'danger',
  CANCELLED: 'neutral',
};

function HallCard({ hall, onDetails }: { hall: FactoryMonitorHallDto; onDetails: (runId: string) => void }) {
  const run = hall.allocationRun;
  const halted = hall.haltedReason !== null || hall.dayStatus === 'HALTED';
  return (
    <Card className="flex flex-col gap-space-md">
      <div className="flex flex-wrap items-start justify-between gap-space-sm">
        <div className="min-w-0">
          <h2 className="flex items-center gap-space-xs text-headline-md text-text-primary">
            <Building2 className="size-5 text-primary-container" aria-hidden />
            {hall.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-space-xs">
            <Badge tone="neutral">{HALL_CATEGORY_LABELS_FA[hall.category]}</Badge>
            {hall.dayStatus ? (
              <Badge tone={DAY_TONE[hall.dayStatus]}>{HALL_DAY_STATUS_LABELS_FA[hall.dayStatus]}</Badge>
            ) : (
              <Badge tone="neutral">{fq.monitor.dayNone}</Badge>
            )}
          </div>
        </div>
        {hall.t0At && hall.hallEndAt ? (
          <div className="text-start">
            <p className="text-label-md text-text-muted">{fq.monitor.hallHours}</p>
            <p dir="ltr" className="text-body-md tabular-nums text-text-primary">
              {toJalali(hall.t0At, 'HH:mm')} – {toJalali(hall.hallEndAt, 'HH:mm')}
            </p>
          </div>
        ) : null}
      </div>

      {halted ? (
        <Alert tone="danger" title={fq.monitor.halted}>
          {hall.haltedReason ? fq.monitor.haltedReason(hall.haltedReason) : null}
        </Alert>
      ) : null}

      <section className="rounded-xl border border-border-subtle p-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <h3 className="flex items-center gap-space-xs text-headline-sm text-text-primary">
            <BarChart3 className="size-4" aria-hidden />
            {fq.monitor.allocationTitle}
          </h3>
          {run ? (
            <Button3D size="sm" variant="neutral" icon={<Eye className="size-4" aria-hidden />} onClick={() => onDetails(run.id)}>
              {fq.monitor.details}
            </Button3D>
          ) : null}
        </div>
        {run ? (
          <div className="mt-space-sm flex flex-col gap-space-sm">
            <div className="grid grid-cols-2 gap-space-xs">
              <div className="rounded-lg bg-success-surface px-space-sm py-space-xs">
                <p className="text-caption text-success">{fq.monitor.assignmentCount}</p>
                <p className="text-headline-sm tabular-nums text-success">{faDigits(run.assignmentCount)}</p>
              </div>
              <div className="rounded-lg bg-warning-surface px-space-sm py-space-xs">
                <p className="text-caption text-warning-bevel">{fq.monitor.notAllocatedCount}</p>
                <p className="text-headline-sm tabular-nums text-warning-bevel">{faDigits(run.notAllocatedCount)}</p>
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-space-xs text-body-sm text-text-secondary sm:grid-cols-2">
              <div>
                <dt className="text-caption text-text-muted">{fq.monitor.engineVersion}</dt>
                <dd dir="ltr">{run.engineVersion}</dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">{fq.monitor.startedAt}</dt>
                <dd dir="ltr">{formatDateTimeFa(run.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">{fq.monitor.finishedAt}</dt>
                <dd dir="ltr">{formatDateTimeFa(run.finishedAt)}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="mt-space-xs text-body-sm text-text-muted">{fq.monitor.noAllocation}</p>
        )}
      </section>

      <section className="flex flex-col gap-space-sm">
        <h3 className="flex items-center gap-space-xs text-headline-sm text-text-primary">
          <Activity className="size-4" aria-hidden />
          {fq.monitor.bulkTitle}
        </h3>
        {hall.bulk.length === 0 ? (
          <p className="text-body-sm text-text-muted">{fq.monitor.noBulk}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-xl bg-surface-container-low">
            {hall.bulk.map((b) => (
              <li key={b.carrierId} className="flex flex-col gap-space-xs px-space-sm py-space-sm">
                <div className="flex flex-wrap items-center justify-between gap-space-xs">
                  <p className="text-label-lg text-text-primary">{b.carrierName}</p>
                  {b.activeWindow ? (
                    <Badge tone={b.activeWindow.kind === 'HEAD' ? 'primary' : 'info'}>
                      {fq.monitor.window}: {BULK_WINDOW_KIND_LABELS_FA[b.activeWindow.kind]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">{fq.monitor.noWindow}</Badge>
                  )}
                </div>
                <p className="text-body-sm text-text-secondary">
                  {fq.monitor.headGroup}: {b.headGroupTitle ?? fq.common.none}
                </p>
                <p className="text-body-sm text-text-secondary">
                  {fq.monitor.cursorGroup}:{' '}
                  {b.cursorGroupTitle
                    ? fq.monitor.cursorValue(b.cursorGroupTitle, faDigits(b.cursorRemaining))
                    : fq.common.none}
                </p>
                {b.activeWindow ? (
                  <div className="flex flex-wrap items-center gap-space-xs text-caption text-text-muted">
                    <span>
                      {fq.monitor.windowValue(
                        BULK_WINDOW_KIND_LABELS_FA[b.activeWindow.kind],
                        faDigits(b.activeWindow.seq),
                        faDigits(b.activeWindow.round),
                        b.activeWindow.groupTitle,
                      )}
                    </span>
                    <span className="inline-flex items-center gap-space-2xs">
                      <Clock className="size-3.5" aria-hidden />
                      {toJalali(b.activeWindow.closesAt, 'HH:mm')}
                    </span>
                    <span>
                      {fq.monitor.windowCounts(
                        faDigits(b.activeWindow.reservedCount),
                        faDigits(b.activeWindow.burnedCount),
                        faDigits(b.activeWindow.eligibleCount),
                      )}
                    </span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

/** US-F8: live monitor of hall days, bulk rotations per carrier and the bag allocation run result. */
export function MonitorView() {
  const [runId, setRunId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['factory', 'monitor'],
    queryFn: ({ signal }) => api.get<FactoryMonitorDto>('/factory/monitor', { signal }),
    refetchInterval: 5000,
  });

  if (q.isPending) {
    return (
      <div>
        <PageHeader title={fq.monitor.title} description={fq.monitor.description} />
        <div className="grid grid-cols-1 gap-space-lg xl:grid-cols-2" role="status" aria-label={fq.common.loading}>
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div>
        <PageHeader title={fq.monitor.title} description={fq.monitor.description} />
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const d = q.data;
  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader title={fq.monitor.title} description={fq.monitor.description} />
      <div className="flex flex-wrap items-center justify-between gap-space-xs text-caption text-text-muted">
        <span>{isoDateToJalali(d.today)}</span>
        <span className="inline-flex items-center gap-space-2xs">
          <RefreshCw className="size-3.5" aria-hidden />
          {fq.common.refreshNote}
        </span>
      </div>

      {d.halls.length === 0 ? (
        <Card>
          <EmptyState icon={<Building2 className="size-7" />} title={fq.monitor.noHalls} description={fq.monitor.noHallsDesc} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-space-lg xl:grid-cols-2">
          {d.halls.map((h) => (
            <HallCard key={h.hallId} hall={h} onDetails={setRunId} />
          ))}
        </div>
      )}

      <AllocationRunModal runId={runId} onClose={() => setRunId(null)} />
    </div>
  );
}
