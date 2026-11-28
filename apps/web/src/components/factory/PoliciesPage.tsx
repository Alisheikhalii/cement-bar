'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Settings2 } from 'lucide-react';
import {
  STRATEGIES,
  faDigits,
  faNumber,
  formatDateTimeFa,
  policyParamsByStrategy,
  type HallDto,
  type PolicyDto,
  type StrategyCode,
} from '@cb/shared';
import { Alert, Badge, Button3D, Card, EmptyState, Field, NumberInput, Select, Skeleton, Switch, TextInput } from '@cb/ui';
import { ErrorState } from '@/components/StateViews';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import { FactoryPageHeader, useFactoryMutation } from './common';
import { useHalls } from './HallsPage';

const p = t.policies;
type Params = Record<string, unknown>;

/** Same coherence rule as the API (BAG → timed/free, BULK → bulk/free). */
const compatible = (h: HallDto, s: StrategyCode) =>
  s === 'FREE_FIRST_COME' || (h.category === 'BAG' ? s === 'TIMED_PRIORITY_RESERVATION' : s === 'BULK_GROUP_ROTATION');

const defaultsFor = (s: StrategyCode): Params => policyParamsByStrategy[s].parse({}) as Params;

function ParamsEditor({ values, onChange }: { values: Params; onChange: (v: Params) => void }) {
  return (
    <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
      {Object.entries(values).map(([k, v]) => {
        const id = `pp-${k}`;
        const label = p.fields[k] ?? k;
        if (typeof v === 'boolean') {
          return <Switch key={k} id={id} checked={v} onCheckedChange={(c) => onChange({ ...values, [k]: c })} label={label} />;
        }
        if (k === 'leftoverAfterAllocation') {
          return (
            <Field key={k} label={label} htmlFor={id}>
              <Select
                id={id}
                value={String(v)}
                onValueChange={(s) => onChange({ ...values, [k]: s })}
                options={Object.entries(p.leftover).map(([value, l]) => ({ value, label: l }))}
              />
            </Field>
          );
        }
        if (typeof v === 'number') {
          return (
            <Field key={k} label={label} htmlFor={id}>
              <NumberInput id={id} value={String(v)} onValueChange={(s) => onChange({ ...values, [k]: s === '' ? 0 : Number(s) })} />
            </Field>
          );
        }
        return (
          <Field key={k} label={label} htmlFor={id}>
            <TextInput id={id} value={String(v ?? '')} onChange={(e) => onChange({ ...values, [k]: e.target.value })} />
          </Field>
        );
      })}
    </div>
  );
}

function HallPolicies({ hall }: { hall: HallDto }) {
  const key = ['factory', 'policies', hall.id];
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<PolicyDto[]>('/factory/policies', { query: { hallId: hall.id }, signal }),
  });
  const strategies = STRATEGIES.filter((s) => compatible(hall, s));
  const [strategy, setStrategy] = useState<StrategyCode>(strategies[0]!);
  const [params, setParams] = useState<Params>(() => defaultsFor(strategies[0]!));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currentOf = useMemo(
    () => (s: StrategyCode) => q.data?.find((x) => x.strategy === s && x.current),
    [q.data],
  );

  // Start from the current version's params (or schema defaults) whenever the strategy/data changes.
  useEffect(() => {
    setParams({ ...defaultsFor(strategy), ...(currentOf(strategy)?.params ?? {}) });
  }, [strategy, currentOf]);

  const m = useFactoryMutation(
    () => api.post<PolicyDto>('/factory/policies', { hallId: hall.id, strategy, params, ...(note.trim() ? { note: note.trim() } : {}) }),
    { invalidate: [key], success: t.common.created, onSuccess: () => setNote('') },
  );
  const submit = () => {
    const r = policyParamsByStrategy[strategy].safeParse(params, { error: faErrorMap });
    if (!r.success) {
      const i = r.error.issues[0];
      setError(`${p.fields[String(i?.path[0])] ?? ''}: ${i?.message ?? ''}`);
      return;
    }
    setError(null);
    m.mutate(undefined);
  };

  return (
    <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
      <Card className="flex flex-col gap-space-md">
        <h2 className="flex items-center gap-space-xs text-headline-md text-text-primary">
          <Settings2 className="size-5" aria-hidden />
          {p.newVersion}
        </h2>
        <Field label={p.strategy} htmlFor="pol-strategy">
          <Select
            id="pol-strategy"
            value={strategy}
            onValueChange={(s) => setStrategy(s as StrategyCode)}
            options={strategies.map((s) => ({ value: s, label: p.strategies[s] }))}
          />
        </Field>
        <ParamsEditor values={params} onChange={setParams} />
        <Field label={t.common.note} htmlFor="pol-note">
          <TextInput id="pol-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex justify-end">
          <Button3D loading={m.isPending} onClick={submit}>
            {t.common.save}
          </Button3D>
        </div>
      </Card>

      <Card className="flex flex-col gap-space-md">
        <h2 className="flex items-center gap-space-xs text-headline-md text-text-primary">
          <History className="size-5" aria-hidden />
          {p.version}
        </h2>
        {q.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState title={p.empty} />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {q.data.map((v) => (
              <li key={v.id} className="flex flex-col gap-1 py-space-sm">
                <div className="flex flex-wrap items-center gap-space-xs">
                  <span className="text-headline-sm text-text-primary">
                    {p.strategies[v.strategy]} — {p.version} {faNumber(v.version)}
                  </span>
                  {v.current ? <Badge tone="success">{p.current}</Badge> : null}
                </div>
                <p className="text-body-sm text-text-secondary">
                  {p.activeFrom}: {formatDateTimeFa(v.activeFrom)}
                  {v.note ? ` · ${v.note}` : ''}
                </p>
                <p className="text-body-sm text-text-muted">
                  {Object.entries(v.params)
                    .map(([k, val]) => `${p.fields[k] ?? k}: ${typeof val === 'boolean' ? (val ? '✓' : '✗') : faDigits(String(p.leftover[String(val)] ?? val))}`)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function PoliciesPage() {
  const halls = useHalls();
  const [hallId, setHallId] = useState<string>('');
  const hall = halls.data?.find((h) => h.id === hallId) ?? halls.data?.[0];
  return (
    <div className="flex flex-col gap-space-md">
      <FactoryPageHeader title={p.title} description={p.description} />
      {halls.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : halls.isError ? (
        <ErrorState message={errorMessage(halls.error)} onRetry={() => void halls.refetch()} />
      ) : !hall ? (
        <Card>
          <EmptyState title={p.noHalls} />
        </Card>
      ) : (
        <>
          <div className="w-full max-w-sm">
            <Field label={p.hall} htmlFor="pol-hall">
              <Select id="pol-hall" value={hall.id} onValueChange={setHallId} options={halls.data.map((h) => ({ value: h.id, label: h.title }))} />
            </Field>
          </div>
          <HallPolicies key={hall.id} hall={hall} />
        </>
      )}
    </div>
  );
}
