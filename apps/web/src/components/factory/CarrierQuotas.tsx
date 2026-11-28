'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { carrierQuotaUpsertSchema, enDigits, faDigits, formatTon, type CarrierQuotaDto } from '@cb/shared';
import { Alert, Badge, Button3D, Card, EmptyState, Field, NumberInput, Skeleton, TextInput } from '@cb/ui';
import { ErrorState } from '@/components/StateViews';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { useFactoryMutation } from './common';

const KG_PER_TON = 1000;

export function CarrierQuotas({ carrierId }: { carrierId: string }) {
  const key = ['factory', 'carrier', carrierId, 'quotas'];
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<CarrierQuotaDto[]>(`/factory/carriers/${carrierId}/quotas`, { signal }),
  });
  const [yearMonth, setYearMonth] = useState('');
  const [tons, setTons] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const m = useFactoryMutation(
    (v: { yearMonth: string; tonnageLimitKg: number }) => api.put<CarrierQuotaDto>(`/factory/carriers/${carrierId}/quotas`, v),
    { invalidate: [key, ['factory', 'dashboard']], success: t.common.saved, onSuccess: () => setTons('') },
  );

  const current = q.data?.[0]?.yearMonth;
  const submit = () => {
    const parsed = carrierQuotaUpsertSchema.safeParse({
      yearMonth: enDigits(yearMonth || current || '').trim(),
      tonnageLimitKg: Math.round(Number(tons) * KG_PER_TON),
    });
    if (!parsed.success || tons === '') {
      setFormError(parsed.success ? t.quotas.limit : (parsed.error.issues[0]?.message ?? t.common.failed));
      return;
    }
    if (current && parsed.data.yearMonth < current) {
      setFormError(t.quotas.pastReadOnly);
      return;
    }
    setFormError(null);
    m.mutate(parsed.data);
  };

  return (
    <Card className="flex flex-col gap-space-md">
      <form
        noValidate
        className="grid grid-cols-1 items-end gap-space-md sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t.quotas.yearMonth} htmlFor="q-ym" hint={t.quotas.yearMonthHint}>
          <TextInput id="q-ym" dir="ltr" placeholder={current} value={faDigits(yearMonth)} onChange={(e) => setYearMonth(enDigits(e.target.value))} />
        </Field>
        <Field label={t.quotas.limit} htmlFor="q-tons" required>
          <NumberInput id="q-tons" allowDecimal value={tons} onValueChange={setTons} />
        </Field>
        <Button3D type="submit" loading={m.isPending}>
          {t.quotas.set}
        </Button3D>
      </form>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      {q.isPending ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<Gauge className="size-7" />} title={t.common.empty} />
      ) : (
        <>
          {q.data[0]?.tonnageLimitKg === null ? <Alert tone="warning">{t.quotas.notSetWarning}</Alert> : null}
          <ul className="flex flex-col divide-y divide-border-subtle">
            {q.data.map((row) => {
              const limit = row.tonnageLimitKg === null ? null : Number(row.tonnageLimitKg);
              const used = Number(row.usedKg);
              return (
                <li key={row.yearMonth} className="grid grid-cols-2 gap-space-xs py-space-sm sm:grid-cols-4 sm:items-center">
                  <span className="text-headline-sm text-text-primary" dir="ltr">
                    {faDigits(row.yearMonth)}
                  </span>
                  <span className="text-body-md">
                    <span className="text-text-muted">{t.quotas.limit}: </span>
                    {limit === null ? <Badge tone="warning">{t.quotas.notSet}</Badge> : formatTon(limit)}
                  </span>
                  <span className="text-body-md">
                    <span className="text-text-muted">{t.quotas.used}: </span>
                    {formatTon(used)}
                  </span>
                  <span className="text-body-md">
                    <span className="text-text-muted">{t.quotas.remaining}: </span>
                    {limit === null ? t.common.none : formatTon(Math.max(0, limit - used))}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
