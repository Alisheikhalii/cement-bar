'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, CalendarRange, OctagonX, Clock } from 'lucide-react';
import {
  HALL_DAY_STATUS_LABELS_FA,
  addDaysIso,
  faNumber,
  isoDateToJalali,
  localDate,
  toJalali,
  type HallDayDto,
  type HallDayGenerateResultDto,
  type HallDayStatus,
  type HallDto,
} from '@cb/shared';
import { Alert, Badge, Button3D, Card, EmptyState, Field, JalaliDatePicker, Modal, NumberInput, Skeleton, TextInput, Textarea, type Tone } from '@cb/ui';
import { ErrorState } from '@/components/StateViews';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { serverNow } from '@/lib/server-clock';
import { ConfirmModal, useFactoryMutation } from './common';

const TONE: Record<HallDayStatus, Tone> = {
  SCHEDULED: 'info',
  OPEN: 'success',
  ALLOCATING: 'warning',
  CLOSED: 'neutral',
  HALTED: 'danger',
  CANCELLED: 'neutral',
};
const DAYS_BACK = 7;
const DAYS_AHEAD = 31;
const DEFAULT_GENERATE_DAYS = '7';

interface Times {
  t0: string;
  priorityEnd: string;
  hallEnd: string;
}

/** Shared modal for "new exception day" (date editable) and "re-time" (reason required). */
function DayModal(props: {
  hall: HallDto;
  day?: HallDayDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invalidate: unknown[][];
}) {
  const { hall, day } = props;
  const [date, setDate] = useState(day?.date ?? addDaysIso(localDate(new Date(serverNow())), 1));
  const [times, setTimes] = useState<Times>({
    t0: day ? toJalali(day.t0At, 'HH:mm') : '08:00',
    priorityEnd: day?.priorityEndAt ? toJalali(day.priorityEndAt, 'HH:mm') : '',
    hallEnd: day ? toJalali(day.hallEndAt, 'HH:mm') : '14:00',
  });
  const [reason, setReason] = useState('');
  const m = useFactoryMutation(
    () => {
      const body = { t0: times.t0, hallEnd: times.hallEnd, ...(times.priorityEnd ? { priorityEnd: times.priorityEnd } : {}) };
      return day
        ? api.patch<HallDayDto>(`/factory/halls/${hall.id}/days/${day.id}`, { ...body, reason: reason.trim() })
        : api.post<HallDayDto>(`/factory/halls/${hall.id}/days`, { ...body, date });
    },
    { invalidate: props.invalidate, success: t.common.saved, onSuccess: () => props.onOpenChange(false) },
  );
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={day ? t.halls.retime : t.halls.addDay}
      subtitle={day ? isoDateToJalali(day.date) : hall.title}
      size="sm"
      footer={
        <Button3D loading={m.isPending} disabled={!!day && !reason.trim()} onClick={() => m.mutate(undefined)}>
          {t.common.save}
        </Button3D>
      }
    >
      <div className="flex flex-col gap-space-md">
        {!day ? (
          <Field label={t.halls.date} htmlFor="d-date" required>
            <JalaliDatePicker id="d-date" value={date} onChange={setDate} />
          </Field>
        ) : null}
        {(
          [
            ['t0', t.halls.t0],
            ['priorityEnd', t.halls.priorityEnd],
            ['hallEnd', t.halls.hallEnd],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label} htmlFor={`d-${k}`} required={k !== 'priorityEnd' || hall.defaultAllocation === 'TIMED'}>
            <TextInput id={`d-${k}`} type="time" dir="ltr" value={times[k]} onChange={(e) => setTimes((s) => ({ ...s, [k]: e.target.value }))} />
          </Field>
        ))}
        {day ? (
          <Field label={t.common.reason} htmlFor="d-reason" required>
            <Textarea id="d-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

export function HallDays({ hall }: { hall: HallDto }) {
  const today = localDate(new Date(serverNow()));
  const from = addDaysIso(today, -DAYS_BACK);
  const to = addDaysIso(today, DAYS_AHEAD);
  const key = ['factory', 'hall', hall.id, 'days', from, to];
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<HallDayDto[]>(`/factory/halls/${hall.id}/days`, { query: { from, to }, signal }),
  });
  const invalidate = [['factory', 'hall', hall.id, 'days'], ['factory', 'dashboard']];
  const [genFrom, setGenFrom] = useState(addDaysIso(today, 1));
  const [genDays, setGenDays] = useState(DEFAULT_GENERATE_DAYS);
  const [result, setResult] = useState<HallDayGenerateResultDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [retiming, setRetiming] = useState<HallDayDto | null>(null);
  const [halting, setHalting] = useState<HallDayDto | null>(null);

  const gen = useFactoryMutation(
    () => api.post<HallDayGenerateResultDto>(`/factory/halls/${hall.id}/days/generate`, { from: genFrom, days: Number(genDays) }),
    { invalidate, onSuccess: setResult },
  );
  const halt = useFactoryMutation(
    (reason: string) => api.post<HallDayDto>(`/factory/halls/${hall.id}/days/${halting!.id}/halt`, { reason }),
    { invalidate, success: t.common.saved, onSuccess: () => setHalting(null) },
  );
  const now = serverNow();

  return (
    <Card className="flex flex-col gap-space-md">
      <div className="grid grid-cols-1 items-end gap-space-sm sm:grid-cols-[1fr_10rem_auto_auto]">
        <Field label={t.halls.generateFrom} htmlFor="g-from">
          <JalaliDatePicker id="g-from" value={genFrom} onChange={setGenFrom} />
        </Field>
        <Field label={t.halls.generateDays} htmlFor="g-days">
          <NumberInput id="g-days" value={genDays} onValueChange={setGenDays} />
        </Field>
        <Button3D icon={<CalendarRange className="size-4" aria-hidden />} loading={gen.isPending} onClick={() => gen.mutate(undefined)}>
          {t.halls.generate}
        </Button3D>
        <Button3D variant="neutral" icon={<CalendarPlus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
          {t.halls.addDay}
        </Button3D>
      </div>
      {result ? (
        <Alert tone="success">{t.halls.generated(faNumber(result.created.length), faNumber(result.skipped.length))}</Alert>
      ) : null}

      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<CalendarRange className="size-7" />} title={t.halls.noDays} />
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {q.data.map((d) => {
            const editable = d.status === 'SCHEDULED' && new Date(d.t0At).getTime() > now;
            const haltable = d.status === 'SCHEDULED' || d.status === 'OPEN' || d.status === 'ALLOCATING';
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-space-sm py-space-sm">
                <div className="min-w-0">
                  <p className="text-headline-sm text-text-primary">
                    {t.halls.weekdays[(new Date(`${d.date}T12:00:00Z`).getUTCDay() + 1) % 7]} {isoDateToJalali(d.date)}
                  </p>
                  <p className="text-body-sm text-text-secondary" dir="ltr">
                    {toJalali(d.t0At, 'HH:mm')}
                    {d.priorityEndAt ? ` / ${toJalali(d.priorityEndAt, 'HH:mm')}` : ''} – {toJalali(d.hallEndAt, 'HH:mm')}
                  </p>
                  {d.haltedReason ? <p className="text-body-sm text-danger">{d.haltedReason}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-space-sm">
                  <Badge tone={TONE[d.status]}>{HALL_DAY_STATUS_LABELS_FA[d.status]}</Badge>
                  {editable ? (
                    <Button3D size="sm" variant="neutral" icon={<Clock className="size-4" aria-hidden />} onClick={() => setRetiming(d)}>
                      {t.halls.retime}
                    </Button3D>
                  ) : null}
                  {haltable ? (
                    <Button3D size="sm" variant="danger" icon={<OctagonX className="size-4" aria-hidden />} onClick={() => setHalting(d)}>
                      {t.halls.halt}
                    </Button3D>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? <DayModal hall={hall} open onOpenChange={setAdding} invalidate={invalidate} /> : null}
      {retiming ? <DayModal hall={hall} day={retiming} open onOpenChange={(o) => !o && setRetiming(null)} invalidate={invalidate} /> : null}
      <ConfirmModal
        open={!!halting}
        onOpenChange={(o) => !o && setHalting(null)}
        title={t.halls.halt}
        message={t.halls.haltConfirm}
        reasonLabel={t.common.reason}
        variant="danger"
        loading={halt.isPending}
        onConfirm={(reason) => halt.mutate(reason)}
      />
    </Card>
  );
}
