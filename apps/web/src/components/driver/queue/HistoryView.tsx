'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import {
  BAG_TURN_STATUSES,
  BAG_TURN_STATUS_LABELS_FA,
  faDigits,
  formatDateTimeFa,
  isoDateToJalali,
  type BagTurnStatus,
} from '@cb/shared';
import { Badge, button3DClasses, Card, EmptyState, Select, Skeleton } from '@cb/ui';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { fa } from '@/i18n/fa';
import { faDriverQueue } from '@/i18n/driver-queue';
import { errorMessage } from '@/lib/api';
import { TURN_TONE, filterTurnsByStatus } from './helpers';
import { useDriverHistory } from './queries';

const h = faDriverQueue.history;
const c = faDriverQueue.common;
type TurnFilter = 'ALL' | BagTurnStatus;

export function HistoryView() {
  const q = useDriverHistory();
  const [filter, setFilter] = useState<TurnFilter>('ALL');

  const turns = useMemo(() => filterTurnsByStatus(q.data?.turns ?? [], filter), [q.data?.turns, filter]);

  const options = useMemo(
    () => [
      { value: 'ALL', label: h.allStatuses },
      ...BAG_TURN_STATUSES.map((s) => ({ value: s, label: BAG_TURN_STATUS_LABELS_FA[s] })),
    ],
    [],
  );

  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <PageHeader title={fa.nav.driver.history} description={h.description} />

      {q.isPending ? (
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2" role="status" aria-label={c.loadingList}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.turns.length === 0 ? (
        <Card>
          <EmptyState title={h.empty} description={h.emptyBody} icon={<ClipboardList className="size-7" />} />
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-space-sm p-space-md sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-xs">
              <Select
                value={filter}
                onValueChange={(value) => setFilter(value as TurnFilter)}
                options={options}
                aria-label={h.filterLabel}
              />
            </div>
            <p className="text-caption text-text-muted">{h.count(faDigits(turns.length))}</p>
          </Card>

          {turns.length === 0 ? (
            <Card>
              <EmptyState title={h.noMatch} description={h.noMatchBody} icon={<ClipboardList className="size-7" />} />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
              {turns.map((turn) => (
                <Card key={turn.id} className="flex flex-col gap-space-sm">
                  <div className="flex flex-wrap items-center justify-between gap-space-xs">
                    <span className="text-label-lg text-text-primary" dir="rtl">
                      {isoDateToJalali(turn.date)}
                    </span>
                    <Badge tone={TURN_TONE[turn.status]}>{BAG_TURN_STATUS_LABELS_FA[turn.status]}</Badge>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-space-sm gap-y-space-xs text-body-sm">
                    <div className="min-w-0">
                      <dt className="text-caption text-text-muted">{h.hall}</dt>
                      <dd className="truncate text-text-body">{turn.hallTitle}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-caption text-text-muted">{h.turnNo}</dt>
                      <dd className="text-headline-sm text-primary-container">{faDigits(turn.turnNo)}</dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-caption text-text-muted">{h.registeredAt}</dt>
                      <dd className="text-text-body">{formatDateTimeFa(turn.registeredAt)}</dd>
                    </div>
                  </dl>

                  <div className="rounded-xl bg-surface-container-low p-space-sm">
                    <p className="text-caption text-text-muted">{h.assignment}</p>
                    {turn.assignment ? (
                      <>
                        <p className="text-label-lg text-text-primary">
                          {h.permitNo(faDigits(turn.assignment.permitNo))} — #{faDigits(turn.assignment.announcementNumber)}
                        </p>
                        <p className="truncate text-body-sm text-text-secondary">
                          {turn.assignment.title} • {turn.assignment.destinationTitle ?? c.none}
                        </p>
                      </>
                    ) : (
                      <p className="text-body-sm text-text-muted">{h.noAssignment}</p>
                    )}
                  </div>

                  <Link href="/driver/reservations" className={button3DClasses({ variant: 'neutral', fullWidth: true })}>
                    {h.viewReservation}
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
