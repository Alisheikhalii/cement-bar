'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field, JalaliDatePicker, Select, Tabs, TextInput } from '@cb/ui';
import {
  AGGREGATE_COLUMNS,
  PERMIT_COLUMNS,
  QUOTA_USAGE_COLUMNS,
  enDigits,
  faDigits,
  type ReportCarrierOptionDto,
} from '@cb/shared';
import { faCarrier } from '@/i18n/carrier';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/StateViews';
import { ServerTable } from '@/components/table/ServerTable';

const r = faCarrier.reports;
type Tab = 'permits' | 'aggregate' | 'quota';
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function CarrierFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const q = useQuery({
    queryKey: ['factory', 'reports', 'carriers'],
    queryFn: ({ signal }) => api.get<ReportCarrierOptionDto[]>('/factory/reports/carriers', { signal }),
    staleTime: 5 * 60_000,
  });
  return (
    <Field label={r.carrier} htmlFor="rep-carrier" className="min-w-48">
      <Select
        id="rep-carrier"
        value={value || '__all'}
        onValueChange={(v) => onChange(v === '__all' ? '' : v)}
        disabled={q.isPending}
        options={[
          { value: '__all', label: r.allCarriers },
          ...(q.data ?? []).map((c) => ({ value: c.id, label: `${faDigits(c.code)} — ${c.name}` })),
        ]}
      />
    </Field>
  );
}

/**
 * Reports (US-B11 carrier / US-F9 factory): issued permits, aggregate and quota usage, all with xlsx.
 * The factory variant adds a carrier filter; the API scopes carriers to their own data regardless.
 */
export function ReportsView({ panel }: { panel: 'carrier' | 'factory' }) {
  const [tab, setTab] = useState<Tab>('permits');
  const [carrierId, setCarrierId] = useState('');
  const [view, setView] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [yearMonth, setYearMonth] = useState('');
  const base = `/${panel}/reports`;
  const ym = enDigits(yearMonth.trim());
  const params = useMemo<Record<string, string | undefined>>(() => {
    const scope = panel === 'factory' && carrierId ? { carrierId } : {};
    if (tab === 'permits') return { ...scope, view: view || undefined };
    if (tab === 'aggregate') return { ...scope, from: from || undefined, to: to || undefined };
    return { ...scope, yearMonth: YM_RE.test(ym) ? ym : undefined };
  }, [panel, tab, carrierId, view, from, to, ym]);

  return (
    <div>
      <PageHeader title={r.title} description={r.description} />
      <Tabs
        aria-label={r.title}
        className="mb-space-md"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        items={[
          { value: 'permits', label: r.tabs.permits },
          { value: 'aggregate', label: r.tabs.aggregate },
          { value: 'quota', label: r.tabs.quota },
        ]}
      />
      <div className="mb-space-md flex flex-wrap items-end gap-space-md">
        {panel === 'factory' ? <CarrierFilter value={carrierId} onChange={setCarrierId} /> : null}
        {tab === 'permits' ? (
          <Field label={r.status} htmlFor="rep-view" className="min-w-40">
            <Select
              id="rep-view"
              value={view || '__all'}
              onValueChange={(v) => setView(v === '__all' ? '' : v)}
              options={[
                { value: '__all', label: r.allStatuses },
                { value: 'active', label: faCarrier.permits.tabs.active },
                { value: 'archived', label: faCarrier.permits.tabs.archived },
              ]}
            />
          </Field>
        ) : null}
        {tab === 'aggregate' ? (
          <>
            <Field label={r.from} htmlFor="rep-from">
              <JalaliDatePicker id="rep-from" value={from} onChange={setFrom} />
            </Field>
            <Field label={r.to} htmlFor="rep-to">
              <JalaliDatePicker id="rep-to" value={to} onChange={setTo} />
            </Field>
          </>
        ) : null}
        {tab === 'quota' ? (
          <Field label={r.month} htmlFor="rep-ym" hint={r.monthHint} error={ym && !YM_RE.test(ym) ? faCarrier.common.required : undefined}>
            <TextInput id="rep-ym" dir="ltr" className="text-end" inputMode="numeric" placeholder="1405-09" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} />
          </Field>
        ) : null}
      </div>
      {tab === 'permits' ? (
        <ServerTable
          key={`${panel}-permits`}
          endpoint={`${base}/permits`}
          columns={PERMIT_COLUMNS}
          storageKey={`${panel}-report-permits`}
          params={params}
          caption={r.tabs.permits}
          defaultSort={{ id: 'reservedAt', desc: true }}
        />
      ) : tab === 'aggregate' ? (
        <ServerTable key={`${panel}-aggregate`} endpoint={`${base}/aggregate`} columns={AGGREGATE_COLUMNS} storageKey={`${panel}-report-aggregate`} params={params} caption={r.tabs.aggregate} />
      ) : (
        <ServerTable key={`${panel}-quota`} endpoint={`${base}/quota`} columns={QUOTA_USAGE_COLUMNS} storageKey={`${panel}-report-quota`} params={params} caption={r.tabs.quota} />
      )}
    </div>
  );
}
