'use client';
import { useState } from 'react';
import { hallScheduleReplaceSchema, type HallDto, type HallScheduleItem } from '@cb/shared';
import { Alert, Button3D, Card, Checkbox, NumberInput, TextInput } from '@cb/ui';
import { faFactory as t } from '@/i18n/factory';
import { api } from '@/lib/api';
import { useFactoryMutation } from './common';

interface Row {
  open: boolean;
  t0: string;
  priorityEnd: string;
  hallEnd: string;
  headMinutes: string;
  freeMinutes: string;
}

function initialRows(hall: HallDto): Row[] {
  return t.halls.weekdays.map((_, weekday) => {
    const s = hall.schedules.find((x) => x.weekday === weekday);
    return {
      open: !!s?.active,
      t0: s?.t0 ?? '08:00',
      priorityEnd: s?.priorityEnd ?? '',
      hallEnd: s?.hallEnd ?? '14:00',
      headMinutes: s?.headMinutes ? String(s.headMinutes) : '',
      freeMinutes: s?.freeMinutes ? String(s.freeMinutes) : '',
    };
  });
}

/** Weekly schedule editor (PUT replaces the whole week). Weekday 0 = Saturday. */
export function HallSchedule({ hall }: { hall: HallDto }) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(hall));
  const [error, setError] = useState<string | null>(null);
  const bulk = hall.category === 'BULK';
  const m = useFactoryMutation((items: HallScheduleItem[]) => api.put<HallDto>(`/factory/halls/${hall.id}/schedules`, { items }), {
    invalidate: [['factory', 'hall', hall.id], ['factory', 'halls']],
    success: t.common.saved,
  });
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => {
    const items = rows.flatMap((r, weekday) =>
      r.open
        ? [
            {
              weekday,
              t0: r.t0,
              hallEnd: r.hallEnd,
              active: true,
              ...(r.priorityEnd ? { priorityEnd: r.priorityEnd } : {}),
              ...(bulk && r.headMinutes ? { headMinutes: Number(r.headMinutes) } : {}),
              ...(bulk && r.freeMinutes ? { freeMinutes: Number(r.freeMinutes) } : {}),
            },
          ]
        : [],
    );
    const parsed = hallScheduleReplaceSchema.safeParse({ items });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const day = typeof issue?.path[1] === 'number' ? t.halls.weekdays[items[issue.path[1]]?.weekday ?? 0] : '';
      setError(`${day} ${issue?.message ?? ''}`.trim());
      return;
    }
    setError(null);
    m.mutate(parsed.data.items);
  };

  return (
    <Card className="flex flex-col gap-space-md">
      <p className="text-body-sm text-text-secondary">{t.halls.scheduleHint}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul className="flex flex-col gap-space-sm">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-2 items-end gap-space-sm rounded-xl bg-surface-container-low p-space-sm md:grid-cols-6">
            <div className="col-span-2 flex min-h-11 items-center md:col-span-1">
              <Checkbox id={`open-${i}`} checked={r.open} onCheckedChange={(open) => set(i, { open })} label={t.halls.weekdays[i]} />
            </div>
            {(
              [
                ['t0', t.halls.t0],
                ['priorityEnd', t.halls.priorityEnd],
                ['hallEnd', t.halls.hallEnd],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex min-w-0 flex-col gap-1 text-label-md text-text-secondary">
                {label}
                <TextInput type="time" dir="ltr" disabled={!r.open} value={r[k]} onChange={(e) => set(i, { [k]: e.target.value })} />
              </label>
            ))}
            {bulk ? (
              <>
                <label className="flex min-w-0 flex-col gap-1 text-label-md text-text-secondary">
                  {t.halls.headMinutes}
                  <NumberInput disabled={!r.open} value={r.headMinutes} onValueChange={(v) => set(i, { headMinutes: v })} />
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-label-md text-text-secondary">
                  {t.halls.freeMinutes}
                  <NumberInput disabled={!r.open} value={r.freeMinutes} onValueChange={(v) => set(i, { freeMinutes: v })} />
                </label>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button3D loading={m.isPending} onClick={save}>
          {t.halls.saveSchedule}
        </Button3D>
      </div>
    </Card>
  );
}
