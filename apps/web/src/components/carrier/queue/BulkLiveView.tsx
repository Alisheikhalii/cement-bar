'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CalendarX2, Clock, OctagonX, TimerReset, Users } from 'lucide-react';
import {
  Alert,
  Badge,
  Button3D,
  Card,
  Countdown,
  DataTable,
  EmptyState,
  Skeleton,
  useToast,
  type Tone,
} from '@cb/ui';
import {
  BULK_CLOSE_REASON_LABELS_FA,
  BULK_WINDOW_KIND_LABELS_FA,
  HALL_DAY_STATUS_LABELS_FA,
  faDigits,
  isoDateToJalali,
  toJalali,
  type BulkWindowDto,
  type CarrierBulkLiveDto,
  type HallDayStatus,
} from '@cb/shared';
import { cq } from '@/i18n/carrier-queue';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { api, errorMessage } from '@/lib/api';
import { useServerClock } from '@/lib/server-clock';
import { LIVE_KEY, windowTime } from './helpers';
import { ReasonDialog } from './dialogs';

const DAY_TONE: Record<HallDayStatus, Tone> = {
  SCHEDULED: 'info',
  OPEN: 'success',
  ALLOCATING: 'warning',
  CLOSED: 'neutral',
  HALTED: 'danger',
  CANCELLED: 'neutral',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low px-space-sm py-space-xs">
      <p className="text-caption text-text-muted">{label}</p>
      <p className="text-headline-sm tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

/** US-B7: today's bulk rotation for this carrier, active window with countdown and manual controls. */
export function BulkLiveView() {
  const qc = useQueryClient();
  const toast = useToast();
  const { now } = useServerClock();
  const [dialog, setDialog] = useState<'close' | 'halt' | null>(null);

  const q = useQuery({
    queryKey: LIVE_KEY,
    queryFn: ({ signal }) => api.get<CarrierBulkLiveDto>('/carrier/bulk/live', { signal }),
    refetchInterval: 5000,
  });

  const closeWindow = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api.post<CarrierBulkLiveDto>(`/carrier/bulk/windows/${v.id}/close`, { reason: v.reason }),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.live.windowClosed });
      setDialog(null);
      await qc.invalidateQueries({ queryKey: LIVE_KEY });
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const halt = useMutation({
    mutationFn: (reason: string) => api.post<CarrierBulkLiveDto>('/carrier/bulk/halt', { reason }),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.live.haltedDone });
      setDialog(null);
      await qc.invalidateQueries({ queryKey: LIVE_KEY });
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const windowCols = useMemo<ColumnDef<BulkWindowDto, unknown>[]>(
    () => [
      {
        id: 'seq',
        header: cq.live.seq,
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{faDigits(row.original.seq)}</span>,
      },
      {
        id: 'kind',
        header: cq.live.kind,
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={row.original.kind === 'HEAD' ? 'primary' : 'info'}>
            {BULK_WINDOW_KIND_LABELS_FA[row.original.kind]}
          </Badge>
        ),
      },
      {
        id: 'group',
        header: cq.live.group,
        enableSorting: false,
        cell: ({ row }) => row.original.groupTitle,
      },
      {
        id: 'round',
        header: cq.live.round,
        enableSorting: false,
        cell: ({ row }) => faDigits(row.original.round),
      },
      {
        id: 'eligible',
        header: cq.live.eligible,
        enableSorting: false,
        cell: ({ row }) => faDigits(row.original.eligibleCount),
      },
      {
        id: 'reserved',
        header: cq.live.reserved,
        enableSorting: false,
        cell: ({ row }) => faDigits(row.original.reservedCount),
      },
      {
        id: 'burned',
        header: cq.live.burned,
        enableSorting: false,
        cell: ({ row }) => faDigits(row.original.burnedCount),
      },
      {
        id: 'carried',
        header: cq.live.carried,
        enableSorting: false,
        cell: ({ row }) => faDigits(row.original.carriedCount),
      },
      {
        id: 'closeReason',
        header: cq.live.closeReasonLabel,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.closeReason ? BULK_CLOSE_REASON_LABELS_FA[row.original.closeReason] : cq.common.none,
      },
      {
        id: 'times',
        header: cq.live.times,
        enableSorting: false,
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {windowTime(row.original.opensAt)} – {windowTime(row.original.closesAt)}
          </span>
        ),
        meta: { hideOnMobile: false },
      },
    ],
    [],
  );

  if (q.isPending) {
    return (
      <div>
        <PageHeader title={cq.live.title} description={cq.live.description} />
        <div className="flex flex-col gap-space-md" role="status" aria-label={cq.common.loading}>
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div>
        <PageHeader title={cq.live.title} description={cq.live.description} />
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const d = q.data;
  const w = d.activeWindow;
  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader title={cq.live.title} description={cq.live.description} />

      <Card className="flex flex-col gap-space-md">
        <div className="flex flex-wrap items-start justify-between gap-space-sm">
          <div className="min-w-0">
            <p className="text-label-md text-text-muted">{cq.live.dayStatus}</p>
            <div className="mt-1 flex flex-wrap items-center gap-space-xs">
              {d.day ? (
                <>
                  <Badge tone={DAY_TONE[d.day.status]}>{HALL_DAY_STATUS_LABELS_FA[d.day.status]}</Badge>
                  <span className="text-body-sm text-text-secondary">{isoDateToJalali(d.day.date)}</span>
                </>
              ) : (
                <Badge tone="neutral">{cq.live.noDay}</Badge>
              )}
            </div>
          </div>
          {d.day ? (
            <div className="text-start">
              <p className="text-label-md text-text-muted">{cq.live.hallHours}</p>
              <p dir="ltr" className="text-body-md tabular-nums text-text-primary">
                {toJalali(d.day.t0At, 'HH:mm')} – {toJalali(d.day.hallEndAt, 'HH:mm')}
              </p>
            </div>
          ) : null}
          <Button3D
            variant="danger"
            icon={<OctagonX className="size-4" aria-hidden />}
            disabled={!d.day || d.halted}
            onClick={() => setDialog('halt')}
          >
            {cq.live.halt}
          </Button3D>
        </div>

        <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
          <Stat
            label={cq.live.headGroup}
            value={d.headGroup?.title ?? cq.common.none}
          />
          <Stat
            label={cq.live.cursor}
            value={
              d.cursor
                ? cq.live.cursorValue(d.cursor.groupTitle, faDigits(d.cursor.remainingCount), faDigits(d.cursor.round))
                : cq.live.cursorEmpty
            }
          />
        </div>

        {d.halted ? (
          <Alert tone="danger" title={cq.live.halted}>
            {d.haltedReason ? cq.live.haltedReason(d.haltedReason) : null}
          </Alert>
        ) : null}

        {!d.day ? (
          <EmptyState icon={<CalendarX2 className="size-7" />} title={cq.live.noDay} description={cq.live.noDayDesc} />
        ) : null}
      </Card>

      {d.day ? (
        <Card className="flex flex-col gap-space-md">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <h2 className="text-headline-md text-text-primary">{cq.live.windowTitle}</h2>
            <Button3D
              variant="warning"
              icon={<TimerReset className="size-4" aria-hidden />}
              disabled={!w}
              onClick={() => setDialog('close')}
            >
              {cq.live.closeWindow}
            </Button3D>
          </div>

          {!w ? (
            <EmptyState icon={<Clock className="size-7" />} title={cq.live.noWindow} />
          ) : (
            <div className="flex flex-col gap-space-md">
              <div className="flex flex-wrap items-center gap-space-sm">
                <Badge tone={w.kind === 'HEAD' ? 'primary' : 'info'}>{BULK_WINDOW_KIND_LABELS_FA[w.kind]}</Badge>
                <span className="text-body-sm text-text-secondary">
                  {cq.live.seq} {faDigits(w.seq)} · {cq.live.round} {faDigits(w.round)} · {w.groupTitle}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-space-xs sm:grid-cols-5">
                <Stat label={cq.live.eligible} value={faDigits(w.eligibleCount)} />
                <Stat label={cq.live.reserved} value={faDigits(w.reservedCount)} />
                <Stat label={cq.live.burned} value={faDigits(w.burnedCount)} />
                <Stat label={cq.live.carried} value={faDigits(w.carriedCount)} />
                <Stat label={cq.live.skipped} value={faDigits(w.skippedCount)} />
              </div>
              <div className="rounded-xl bg-surface-container-low p-space-md">
                <Countdown target={new Date(w.closesAt)} now={now} label={cq.live.remainingTime} />
              </div>
              <div>
                <h3 className="mb-space-xs flex items-center gap-space-xs text-headline-sm text-text-primary">
                  <Users className="size-4" aria-hidden />
                  {cq.live.eligibleDrivers}
                </h3>
                {w.eligibleDrivers.length === 0 ? (
                  <p className="text-body-sm text-text-muted">{cq.live.noEligible}</p>
                ) : (
                  <ul className="grid grid-cols-1 gap-space-xs sm:grid-cols-2 lg:grid-cols-3">
                    {w.eligibleDrivers.map((dr) => (
                      <li key={dr.driverId} className="rounded-xl bg-surface-container-low px-space-sm py-space-xs">
                        <p className="truncate text-body-md text-text-primary">
                          {dr.firstName} {dr.lastName}
                        </p>
                        <p className="text-caption text-text-muted">
                          {cq.live.plate}: {dr.plate ? faDigits(dr.plate) : cq.common.none}
                          {dr.loaderTitle ? ` · ${cq.live.loader}: ${dr.loaderTitle}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-space-md text-headline-md text-text-primary">{cq.live.recent}</h2>
        <DataTable<BulkWindowDto>
          columns={windowCols}
          data={d.recentWindows}
          getRowId={(r) => r.id}
          emptyText={cq.live.recentEmpty}
          caption={cq.live.recent}
          rowTone={(r) =>
            r.closeReason === 'HALTED'
              ? 'danger'
              : r.closeReason === 'ALL_RESERVED' || r.closeReason === 'EXHAUSTED'
                ? 'success'
                : 'primary'
          }
        />
        <p className="mt-space-sm flex items-center gap-space-xs text-caption text-text-muted">
          <AlertTriangle className="size-3.5" aria-hidden />
          {cq.common.refreshNote}
        </p>
      </Card>

      <ReasonDialog
        open={dialog === 'close'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={cq.live.closeTitle}
        message={w ? cq.live.closeConfirm(faDigits(w.seq)) : undefined}
        required
        submitLabel={cq.live.closeWindow}
        variant="warning"
        loading={closeWindow.isPending}
        onSubmit={({ reason }) => w && closeWindow.mutate({ id: w.id, reason })}
      />

      <ReasonDialog
        open={dialog === 'halt'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={cq.live.haltTitle}
        message={cq.live.haltConfirm}
        required
        submitLabel={cq.live.halt}
        variant="danger"
        loading={halt.isPending}
        onSubmit={({ reason }) => halt.mutate(reason)}
      />
    </div>
  );
}
