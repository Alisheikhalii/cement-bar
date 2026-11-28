'use client';
import { CalendarClock, CalendarX2, Warehouse } from 'lucide-react';
import {
  HALL_CATEGORY_LABELS_FA,
  HALL_DAY_STATUS_LABELS_FA,
  isoDateToJalali,
  type HallDayStatus,
} from '@cb/shared';
import { Badge, Card, EmptyState, cn, type Tone } from '@cb/ui';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/StateViews';
import { faDriver } from '@/i18n/driver';
import { errorMessage } from '@/lib/api';
import { hallTime } from './format';
import { useDriverHallHours } from './queries';

const h = faDriver.hallHours;

const STATUS_TONE: Record<HallDayStatus, Tone> = {
  SCHEDULED: 'info',
  OPEN: 'success',
  ALLOCATING: 'purple',
  CLOSED: 'neutral',
  HALTED: 'danger',
  CANCELLED: 'danger',
};

const STATUS_STRIP: Record<HallDayStatus, string> = {
  SCHEDULED: 'bg-info',
  OPEN: 'bg-success',
  ALLOCATING: 'bg-purple',
  CLOSED: 'bg-outline-variant',
  HALTED: 'bg-danger',
  CANCELLED: 'bg-danger',
};

export function HallHoursView() {
  const q = useDriverHallHours();

  return (
    <div>
      <PageHeader title={h.title} description={h.description} />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.days.every((d) => d.entries.length === 0) ? (
        <Card>
          <EmptyState icon={<Warehouse className="size-7" />} title={h.empty} />
        </Card>
      ) : (
        <div className="flex flex-col gap-space-lg">
          {q.data.days.map((day) => (
            <section
              key={day.date}
              aria-labelledby={`day-${day.date}`}
              className="flex flex-col gap-space-sm"
            >
              <h2
                id={`day-${day.date}`}
                className="flex flex-wrap items-center gap-space-xs text-headline-sm text-text-primary"
              >
                <CalendarClock className="size-5 text-primary-container" aria-hidden />
                {isoDateToJalali(day.date, 'EEEE d MMMM')}
                {day.date === q.data.today ? <Badge tone="primary">{h.today}</Badge> : null}
              </h2>
              {day.entries.length === 0 ? (
                <p className="flex items-center gap-space-xs rounded-2xl bg-surface-container-low p-space-md text-body-md text-text-muted">
                  <CalendarX2 className="size-5" aria-hidden />
                  {h.noHall}
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-space-sm md:grid-cols-2 xl:grid-cols-3">
                  {day.entries.map((e) => {
                    const cancelled = e.status === 'CANCELLED';
                    return (
                      <li key={`${e.hallId}-${day.date}`}>
                        <Card
                          className={cn(
                            'relative flex h-full flex-col gap-space-sm overflow-hidden',
                            e.source === 'DAY' && !cancelled ? 'bg-success-surface' : undefined,
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'absolute inset-y-0 start-0 w-1.5',
                              e.status ? STATUS_STRIP[e.status] : 'bg-info',
                            )}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-space-xs">
                            <h3 className="text-label-lg text-text-primary">{e.hallTitle}</h3>
                            <div className="flex flex-wrap gap-1">
                              <Badge tone="neutral">{HALL_CATEGORY_LABELS_FA[e.category]}</Badge>
                              {e.status ? (
                                <Badge tone={STATUS_TONE[e.status]}>
                                  {HALL_DAY_STATUS_LABELS_FA[e.status]}
                                </Badge>
                              ) : (
                                <Badge tone="info">{h.scheduled}</Badge>
                              )}
                            </div>
                          </div>
                          <dl
                            className={cn(
                              'grid grid-cols-2 gap-space-xs text-body-md',
                              cancelled && 'line-through opacity-60',
                            )}
                          >
                            <div>
                              <dt className="text-label-md text-text-secondary">{h.start}</dt>
                              <dd className="text-headline-sm text-text-primary">
                                {hallTime(e.t0At, day.date)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-label-md text-text-secondary">{h.end}</dt>
                              <dd className="text-headline-sm text-text-primary">
                                {hallTime(e.hallEndAt, day.date)}
                              </dd>
                            </div>
                            {e.priorityEndAt ? (
                              <div className="col-span-2">
                                <dt className="text-label-md text-text-secondary">{h.priorityEnd}</dt>
                                <dd className="text-text-primary">{hallTime(e.priorityEndAt, day.date)}</dd>
                              </div>
                            ) : null}
                          </dl>
                          {e.terminalName || e.terminalCity ? (
                            <p className="text-caption text-text-muted">
                              {h.terminal}: {[e.terminalName, e.terminalCity].filter(Boolean).join('، ')}
                            </p>
                          ) : null}
                          {e.source === 'SCHEDULE' ? (
                            <p className="text-caption text-text-muted">{h.scheduledHint}</p>
                          ) : null}
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
