'use client';
import { useCallback } from 'react';
import { Layers, PackageSearch, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BULK_WINDOW_KIND_LABELS_FA,
  faDigits,
  type BulkWindowKind,
} from '@cb/shared';
import { Alert, Badge, Card, Countdown, EmptyState, Skeleton, useToast } from '@cb/ui';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/StateViews';
import { fa } from '@/i18n/fa';
import { faDriverQueue } from '@/i18n/driver-queue';
import { errorMessage, ApiError } from '@/lib/api';
import { useServerClock } from '@/lib/server-clock';
import { useQueueEvents } from '@/lib/useQueueEvents';
import { LoadCardItem } from './LoadCardItem';
import { queueKeys, useBulkHall, useCreateReservation, useLoads } from './queries';

const b = faDriverQueue.bulk;
const l = faDriverQueue.loads;
const loadReasons = faDriverQueue.loadBlockReasons;

/** Window kind label (kept here so the DTO enum drives the Persian label). */
function kindLabel(kind: BulkWindowKind): string {
  return BULK_WINDOW_KIND_LABELS_FA[kind];
}

export function BulkHallView() {
  const state = useBulkHall();
  const loadsQ = useLoads({ hallCategory: 'BULK' }, Boolean(state.data?.day));
  const reserve = useCreateReservation();
  const qc = useQueryClient();
  const toast = useToast();
  const clock = useServerClock();

  const onSse = useCallback(
    (ev: { type: string }) => {
      if (ev.type === 'window.changed') {
        void qc.invalidateQueries({ queryKey: queueKeys.bulk });
        void qc.invalidateQueries({ queryKey: queueKeys.loadsRoot });
      }
      if (ev.type === 'unit.reserved' || ev.type === 'unit.freed') {
        void qc.invalidateQueries({ queryKey: queueKeys.loadsRoot });
      }
    },
    [qc],
  );
  useQueueEvents(onSse);

  if (state.isPending) return <PageSkeleton />;
  if (state.isError) return <ErrorState message={errorMessage(state.error)} onRetry={() => void state.refetch()} />;

  const data = state.data;
  if (!data.day) {
    return (
      <div className="flex flex-col gap-space-lg">
        <PageHeader title={fa.nav.driver.bulkHall} description={b.description} />
        <Card>
          <EmptyState title={b.noDayTitle} description={b.noDayBody} icon={<Layers className="size-7" />} />
        </Card>
      </div>
    );
  }

  const w = data.window;
  const canReserve = data.canReserveNow && w?.isMine === true;
  const closeAt = w ? new Date(w.closesAt) : null;
  const windowOpen = closeAt ? closeAt.getTime() > clock.now() : false;

  const reserveLoad = (announcementId: string) =>
    reserve.mutate(
      { announcementId },
      {
        onSuccess: (r) => toast.toast({ tone: 'success', title: b.reservedToast(faDigits(r.permitNo)) }),
        onError: (e) => {
          if (e instanceof ApiError && (e.code === 'UNIT_TAKEN' || e.code === 'NO_UNIT_AVAILABLE')) {
            toast.toast({ tone: 'warning', title: l.takenToast });
            void qc.invalidateQueries({ queryKey: queueKeys.loadsRoot });
            return;
          }
          toast.toast({ tone: 'danger', title: fa.common.errorTitle, description: errorMessage(e) });
        },
      },
    );

  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <PageHeader title={fa.nav.driver.bulkHall} description={b.description} />

      {data.halted ? <Alert tone="danger" title={b.haltedTitle}>{data.haltedReason}</Alert> : null}

      <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex flex-col gap-1 p-space-md">
          <p className="text-caption text-text-muted">{b.myGroup}</p>
          {data.myGroup ? (
            <>
              <p className="truncate text-headline-sm text-text-primary">{data.myGroup.title}</p>
              <div className="flex flex-wrap items-center gap-space-xs">
                <Badge tone="primary">{b.role[data.myGroup.role]}</Badge>
                <span className="text-body-sm text-text-secondary">
                  {faDigits(data.myGroup.remainingCount)} {b.remaining}
                </span>
              </div>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">{b.noGroup}</p>
          )}
        </Card>

        <Card className="flex flex-col gap-1 p-space-md">
          <p className="text-caption text-text-muted">{b.headGroup}</p>
          <p className="truncate text-headline-sm text-text-primary">{data.headGroup?.title ?? faDriverQueue.common.none}</p>
          <p className="text-body-sm text-text-secondary">
            {b.nextGroup}: {data.nextGroupTitle ?? faDriverQueue.common.none}
          </p>
        </Card>

        <Card className="flex flex-col gap-1 p-space-md">
          <p className="text-caption text-text-muted">{b.currentWindow}</p>
          {w ? (
            <>
              <p className="truncate text-headline-sm text-text-primary">{w.groupTitle}</p>
              <div className="flex flex-wrap items-center gap-space-xs">
                <Badge tone={w.isMine ? 'success' : 'neutral'}>{kindLabel(w.kind)}</Badge>
                <span className="text-body-sm text-text-secondary">
                  {w.isMine ? b.windowMine : b.windowOther(w.groupTitle)}
                </span>
              </div>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">{b.windowNone}</p>
          )}
        </Card>

        <Card className="flex flex-col items-center justify-center gap-1 p-space-md">
          {w && windowOpen ? (
            <Countdown target={new Date(w.closesAt)} now={clock.now} label={b.windowRemaining} />
          ) : (
            <p className="text-body-sm text-text-muted">{b.windowNone}</p>
          )}
          <p className="text-caption text-text-muted">
            {b.groupCount}: {faDigits(data.groupCount)}
          </p>
        </Card>
      </div>

      {!data.myGroup ? (
        <Alert tone="info" title={b.noGroup}>
          {b.noGroupBody}
        </Alert>
      ) : null}

      <section aria-labelledby="bulk-loads" className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <h2 id="bulk-loads" className="flex items-center gap-1.5 text-headline-sm text-text-primary">
            <Users className="size-4 text-primary-container" aria-hidden />
            {b.loadsTitle}
          </h2>
          <span className="text-caption text-text-muted">{faDriverQueue.common.updateHint}</span>
        </div>

        {loadsQ.isPending ? (
          <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3" role="status">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : loadsQ.isError ? (
          <ErrorState message={errorMessage(loadsQ.error)} onRetry={() => void loadsQ.refetch()} />
        ) : loadsQ.data.length === 0 ? (
          <Card>
            <EmptyState title={b.loadsEmpty} description={b.loadsEmptyBody} icon={<PackageSearch className="size-7" />} />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3">
            {loadsQ.data.map((load) => {
              const mine = Boolean(load.myReservedUnitId);
              const caption = mine
                ? l.mineBody
                : !load.isReservable && load.blockReason
                  ? loadReasons[load.blockReason]
                  : !canReserve
                    ? b.reserveBlocked
                    : null;
              return (
                <LoadCardItem
                  key={load.id}
                  load={load}
                  ctaLabel={mine ? b.reservedMine : b.reserve}
                  disabled={mine || !canReserve || !load.isReservable}
                  loading={reserve.isPending && reserve.variables?.announcementId === load.id}
                  caption={caption}
                  onCta={() => reserveLoad(load.id)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
