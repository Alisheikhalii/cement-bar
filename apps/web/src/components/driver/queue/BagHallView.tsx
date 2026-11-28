'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CheckCircle2, Ticket, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BAG_TURN_STATUS_LABELS_FA,
  HALL_DAY_STATUS_LABELS_FA,
  faDigits,
  formatDateTimeFa,
  localTime,
  type HallDayStatus,
} from '@cb/shared';
import {
  Alert,
  Badge,
  Button3D,
  button3DClasses,
  Card,
  Countdown,
  EmptyState,
  IconButton3D,
  Select,
  useToast,
  type Tone,
} from '@cb/ui';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/StateViews';
import { fa } from '@/i18n/fa';
import { faDriverQueue } from '@/i18n/driver-queue';
import { errorMessage } from '@/lib/api';
import { useServerClock } from '@/lib/server-clock';
import { useQueueEvents } from '@/lib/useQueueEvents';
import { hallTime } from '../format';
import { TURN_TONE, movePriority, togglePriority } from './helpers';
import { queueKeys, useBagHall, useLoads, useRegisterBagTurn, useSetBagPriorities } from './queries';

const b = faDriverQueue.bag;
const reasons = faDriverQueue.bagBlockReasons;

const DAY_TONE: Record<HallDayStatus, Tone> = {
  SCHEDULED: 'neutral',
  OPEN: 'success',
  ALLOCATING: 'info',
  CLOSED: 'neutral',
  HALTED: 'danger',
  CANCELLED: 'danger',
};

export function BagHallView() {
  const q = useBagHall();
  const qc = useQueryClient();
  const toast = useToast();
  const clock = useServerClock();
  const register = useRegisterBagTurn();
  const save = useSetBagPriorities();
  const loadsQ = useLoads({ hallCategory: 'BAG' }, Boolean(q.data?.turn));

  const serverIds = useMemo(
    () =>
      [...(q.data?.priorities ?? [])]
        .sort((a, z) => a.rank - z.rank)
        .map((p) => p.announcementId),
    [q.data?.priorities],
  );
  const serverSig = serverIds.join(',');
  const [draft, setDraft] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(serverSig ? serverSig.split(',') : []);
  }, [serverSig, dirty]);

  const ids = draft;
  const onPriorityChange = useCallback((id: string) => {
    setDraft((current) => togglePriority(current, id));
    setDirty(true);
  }, []);
  const onMove = useCallback((index: number, delta: -1 | 1) => {
    setDraft((current) => movePriority(current, index, delta));
    setDirty(true);
  }, []);
  const onRemove = useCallback((id: string) => {
    setDraft((current) => togglePriority(current, id));
    setDirty(true);
  }, []);

  const onSse = useCallback(
    (ev: { type: string }) => {
      if (ev.type === 'window.changed') void qc.invalidateQueries({ queryKey: queueKeys.bag });
    },
    [qc],
  );
  useQueueEvents(onSse);

  const info = useMemo(() => {
    const map = new Map<string, { number: number; title: string; carrier: string; destination: string | null }>();
    for (const p of q.data?.priorities ?? []) {
      map.set(p.announcementId, {
        number: p.announcementNumber,
        title: p.title,
        carrier: p.carrierName,
        destination: p.destinationTitle,
      });
    }
    for (const l of loadsQ.data ?? []) {
      if (!map.has(l.id)) {
        map.set(l.id, {
          number: l.number,
          title: l.productTitle,
          carrier: l.carrierName,
          destination: l.destinationTitle,
        });
      }
    }
    return map;
  }, [q.data?.priorities, loadsQ.data]);

  const options = useMemo(
    () =>
      (loadsQ.data ?? [])
        .filter((l) => !l.fullyReserved && !ids.includes(l.id))
        .map((l) => ({
          value: l.id,
          label: `#${faDigits(l.number)} — ${l.destinationTitle} (${l.carrierName})`,
        })),
    [loadsQ.data, ids],
  );

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;

  const data = q.data;
  const day = data.day;

  if (!data.hall || !day) {
    return (
      <div className="flex flex-col gap-space-lg">
        <PageHeader title={fa.nav.driver.bagHall} description={b.description} />
        <Card>
          <EmptyState title={b.noDayTitle} description={b.noDayBody} icon={<Ticket className="size-7" />} />
        </Card>
      </div>
    );
  }

  const nowMs = clock.now();
  const t0 = new Date(day.t0At);
  const priorityEnd = day.priorityEndAt ? new Date(day.priorityEndAt) : null;
  const hallEnd = new Date(day.hallEndAt);
  let countdown: { target: Date; label: string } | null = null;
  if (nowMs < t0.getTime()) countdown = { target: t0, label: b.t0Countdown };
  else if (priorityEnd && nowMs < priorityEnd.getTime())
    countdown = { target: priorityEnd, label: b.priorityCountdown };
  else if (nowMs < hallEnd.getTime()) countdown = { target: hallEnd, label: b.hallEndCountdown };

  const turn = data.turn;
  const result = data.result;
  const canEdit = data.canSetPriorities;

  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <PageHeader title={fa.nav.driver.bagHall} description={b.description} />

      <Card className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <span className="text-label-lg text-text-primary">{data.hall.title}</span>
          <Badge tone={DAY_TONE[day.status]}>{HALL_DAY_STATUS_LABELS_FA[day.status]}</Badge>
        </div>
        <dl className="grid grid-cols-1 gap-x-space-md gap-y-space-xs sm:grid-cols-3">
          <div>
            <dt className="text-caption text-text-muted">{b.t0At}</dt>
            <dd className="text-label-lg text-text-body" dir="rtl">
              {hallTime(day.t0At, day.date)}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{b.priorityEndAt}</dt>
            <dd className="text-label-lg text-text-body" dir="rtl">
              {day.priorityEndAt ? hallTime(day.priorityEndAt, day.date) : faDriverQueue.common.none}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{b.hallEndAt}</dt>
            <dd className="text-label-lg text-text-body" dir="rtl">
              {hallTime(day.hallEndAt, day.date)}
            </dd>
          </div>
        </dl>
        {countdown ? (
          <div className="flex justify-center rounded-xl bg-surface-container-low py-space-sm">
            <Countdown target={countdown.target} now={clock.now} label={countdown.label} />
          </div>
        ) : null}
        {day.status === 'HALTED' ? <Alert tone="danger" title={b.halted} /> : null}
      </Card>

      <Card className="flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <h2 className="text-headline-sm text-text-primary">{b.stepRegister}</h2>
          {turn ? <Badge tone={TURN_TONE[turn.status]}>{BAG_TURN_STATUS_LABELS_FA[turn.status]}</Badge> : null}
        </div>

        {turn ? (
          <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-3">
            <div className="rounded-xl bg-surface-container-low p-space-sm">
              <p className="text-caption text-text-muted">{b.turnNo}</p>
              <p className="text-display-hero text-primary-container">{faDigits(turn.turnNo)}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-space-sm">
              <p className="text-caption text-text-muted">{b.turnStatus}</p>
              <p className="mt-1">
                <Badge tone={TURN_TONE[turn.status]}>{BAG_TURN_STATUS_LABELS_FA[turn.status]}</Badge>
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-space-sm">
              <p className="text-caption text-text-muted">{b.registeredAt}</p>
              <p className="text-label-lg text-text-body">{formatDateTimeFa(turn.registeredAt)}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-body-sm text-text-secondary">{b.registerHint}</p>
            <Button3D
              variant="success"
              size="lg"
              fullWidth
              icon={<Ticket className="size-5" aria-hidden />}
              disabled={!data.canRegister}
              loading={register.isPending}
              onClick={() =>
                register.mutate(undefined, {
                  onSuccess: () => toast.toast({ tone: 'success', title: b.registeredToast }),
                  onError: (e) =>
                    toast.toast({ tone: 'danger', title: fa.common.errorTitle, description: errorMessage(e) }),
                })
              }
            >
              {b.registerCta}
            </Button3D>
            {!data.canRegister ? (
              <Alert tone="warning" title={b.registerDisabled}>
                {data.registerBlock ? reasons[data.registerBlock] : null}
              </Alert>
            ) : null}
          </>
        )}
        <p className="text-caption text-text-muted">{b.lateHint}</p>
      </Card>

      <Card className="flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <h2 className="text-headline-sm text-text-primary">{b.stepPriority}</h2>
          <Badge tone={ids.length > 0 ? 'success' : 'neutral'}>
            {faDigits(ids.length)} / {faDigits(3)}
          </Badge>
        </div>
        <p className="text-body-sm text-text-secondary">{b.priorityHint}</p>

        {data.window ? (
          <Alert tone="info">{b.windowClosesAt(faDigits(localTime(new Date(data.window.closesAt))))}</Alert>
        ) : null}
        {!canEdit && data.priorityBlock ? (
          <Alert tone="warning">{reasons[data.priorityBlock]}</Alert>
        ) : null}

        {ids.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-subtle p-space-md text-center text-body-sm text-text-muted">
            {b.priorityEmpty}
          </p>
        ) : (
          <ol className="flex flex-col gap-space-xs">
            {ids.map((id, index) => {
              const item = info.get(id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-space-xs rounded-xl bg-surface-container-low p-space-sm"
                >
                  <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary-container px-2 text-caption font-bold text-on-primary">
                    {faDigits(index + 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label-lg text-text-primary">
                      {item ? `#${faDigits(item.number)} — ${item.title}` : id}
                    </p>
                    <p className="truncate text-caption text-text-muted">
                      {item?.carrier}
                      {item?.destination ? ` • ${item.destination}` : ''}
                    </p>
                  </div>
                  <IconButton3D
                    label={b.moveUp}
                    icon={<ArrowUp className="size-4" aria-hidden />}
                    disabled={!canEdit || index === 0}
                    onClick={() => onMove(index, -1)}
                  />
                  <IconButton3D
                    label={b.moveDown}
                    icon={<ArrowDown className="size-4" aria-hidden />}
                    disabled={!canEdit || index === ids.length - 1}
                    onClick={() => onMove(index, 1)}
                  />
                  <IconButton3D
                    label={b.remove}
                    icon={<X className="size-4" aria-hidden />}
                    variant="danger"
                    disabled={!canEdit}
                    onClick={() => onRemove(id)}
                  />
                </li>
              );
            })}
          </ol>
        )}

        {canEdit ? (
          <>
            {ids.length >= 3 ? (
              <p className="text-caption text-text-muted">{b.priorityFull}</p>
            ) : loadsQ.isError ? (
              <div className="flex flex-wrap items-center gap-space-xs">
                <p className="text-body-sm text-danger">{errorMessage(loadsQ.error)}</p>
                <Button3D size="sm" variant="neutral" onClick={() => void loadsQ.refetch()}>
                  {faDriverQueue.common.retry}
                </Button3D>
              </div>
            ) : loadsQ.isPending ? (
              <p className="text-body-sm text-text-muted">{b.loadsLoading}</p>
            ) : options.length === 0 ? (
              <p className="text-body-sm text-text-muted">{b.noLoads}</p>
            ) : (
              <Select
                key={ids.join('|')}
                value={undefined}
                onValueChange={onPriorityChange}
                options={options}
                placeholder={b.prioritySelectPlaceholder}
                aria-label={b.prioritySelectLabel}
              />
            )}
            <Button3D
              fullWidth
              icon={<CheckCircle2 className="size-5" aria-hidden />}
              disabled={!dirty}
              loading={save.isPending}
              onClick={() =>
                save.mutate([...draft], {
                  onSuccess: () => {
                    setDirty(false);
                    toast.toast({ tone: 'success', title: b.prioritySaved });
                  },
                  onError: (e) =>
                    toast.toast({ tone: 'danger', title: fa.common.errorTitle, description: errorMessage(e) }),
                })
              }
            >
              {b.prioritySave}
            </Button3D>
          </>
        ) : null}
      </Card>

      {result && result.status === 'ALLOCATED' && result.assignment ? (
        <Card className="flex flex-col gap-space-sm border-s-4 border-success">
          <div className="flex flex-wrap items-center justify-between gap-space-xs">
            <h2 className="text-headline-sm text-text-primary">{b.resultTitle}</h2>
            <Badge tone="success">{b.resultAllocated}</Badge>
          </div>
          <div className="rounded-xl bg-success-surface p-space-md">
            <p className="text-caption text-text-secondary">{b.permitNo}</p>
            <p className="text-display-hero text-success">{faDigits(result.assignment.permitNo)}</p>
            <p className="text-label-lg text-text-primary">
              #{faDigits(result.assignment.announcementNumber)} — {result.assignment.title}
            </p>
            <p className="text-body-sm text-text-secondary">
              {result.assignment.destinationTitle ?? faDriverQueue.common.none}
            </p>
            <p className="mt-1 text-caption text-text-muted">
              {formatDateTimeFa(result.assignment.reservedAt)}
            </p>
          </div>
          <Link href="/driver/reservations" className={button3DClasses({ variant: 'neutral', fullWidth: true })}>
            {b.viewReservations}
          </Link>
        </Card>
      ) : result && result.status === 'NOT_ALLOCATED' ? (
        <Card className="flex flex-col gap-space-sm">
          <h2 className="text-headline-sm text-text-primary">{b.resultTitle}</h2>
          <Alert tone="warning">{b.resultNotAllocated}</Alert>
        </Card>
      ) : turn ? (
        <Alert tone="info" title={b.resultTitle}>
          {b.resultWaiting}
        </Alert>
      ) : null}
    </div>
  );
}
