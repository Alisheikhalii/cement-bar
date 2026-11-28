'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight, BarChart3, Search } from 'lucide-react';
import { Alert, Badge, button3DClasses, Card, EmptyState, Field, JalaliDatePicker, Select, Skeleton, TextInput } from '@cb/ui';
import {
  BULK_WINDOW_KIND_LABELS_FA,
  faDigits,
  formatDateTimeFa,
  isoDateToJalali,
  localDate,
  type BulkFairnessRowDto,
} from '@cb/shared';
import { fq } from '@/i18n/factory-queue';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { api, errorMessage } from '@/lib/api';
import { serverNow } from '@/lib/server-clock';
import { groupFairnessRows, matchesFairnessFilters, uniqueValues } from './helpers';

const ALL = '__all';

/** US-F9: bulk fairness report — who received a load in which window/round/group, grouped visually. */
export function BulkFairnessView() {
  const today = localDate(new Date(serverNow()));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [carrierName, setCarrierName] = useState(ALL);
  const [groupTitle, setGroupTitle] = useState(ALL);
  const [driverSearch, setDriverSearch] = useState('');

  const valid = !!from && !!to && from <= to;
  const q = useQuery({
    queryKey: ['factory', 'reports', 'bulk-fairness', from, to],
    queryFn: ({ signal }) =>
      api.get<BulkFairnessRowDto[]>('/factory/reports/bulk-fairness', { query: { from, to }, signal }),
    enabled: valid,
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const carrierOptions = useMemo(() => uniqueValues(rows, (r) => r.carrierName), [rows]);
  const groupOptions = useMemo(() => uniqueValues(rows, (r) => r.groupTitle), [rows]);
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        matchesFairnessFilters(r, {
          carrierName: carrierName === ALL ? '' : carrierName,
          groupTitle: groupTitle === ALL ? '' : groupTitle,
          driverSearch,
        }),
      ),
    [rows, carrierName, groupTitle, driverSearch],
  );
  const groups = useMemo(() => groupFairnessRows(filtered), [filtered]);
  const hasFilters = carrierName !== ALL || groupTitle !== ALL || driverSearch.trim() !== '';

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <Link href="/factory/reports" className={button3DClasses({ variant: 'neutral', size: 'sm' })}>
          <ArrowRight className="size-4" aria-hidden />
          {fq.fairness.back}
        </Link>
      </div>
      <PageHeader title={fq.fairness.title} description={fq.fairness.description} />

      <Card className="flex flex-col gap-space-md">
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <Field label={fq.fairness.from} htmlFor="fairness-from">
            <JalaliDatePicker id="fairness-from" value={from} onChange={setFrom} />
          </Field>
          <Field label={fq.fairness.to} htmlFor="fairness-to">
            <JalaliDatePicker id="fairness-to" value={to} onChange={setTo} />
          </Field>
          <Field label={fq.fairness.carrierFilter} htmlFor="fairness-carrier">
            <Select
              id="fairness-carrier"
              value={carrierName}
              onValueChange={setCarrierName}
              options={[{ value: ALL, label: fq.fairness.all }, ...carrierOptions.map((c) => ({ value: c, label: c }))]}
            />
          </Field>
          <Field label={fq.fairness.groupFilter} htmlFor="fairness-group">
            <Select
              id="fairness-group"
              value={groupTitle}
              onValueChange={setGroupTitle}
              options={[{ value: ALL, label: fq.fairness.all }, ...groupOptions.map((g) => ({ value: g, label: g }))]}
            />
          </Field>
        </div>
        <Field label={fq.fairness.driverSearch} htmlFor="fairness-driver">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <TextInput
              id="fairness-driver"
              className="ps-9"
              value={driverSearch}
              placeholder={fq.fairness.driverSearch}
              autoComplete="off"
              onChange={(e) => setDriverSearch(e.target.value)}
            />
          </div>
        </Field>
        {!valid ? <Alert tone="warning">{fq.fairness.invalidRange}</Alert> : null}
        {valid && !q.isPending && !q.isError ? (
          <p className="text-label-md text-text-muted">{fq.fairness.total(faDigits(filtered.length))}</p>
        ) : null}
      </Card>

      {!valid ? null : q.isPending ? (
        <div className="flex flex-col gap-space-md" role="status" aria-label={fq.fairness.loading}>
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="size-7" />}
            title={hasFilters ? fq.fairness.emptyFiltered : fq.fairness.empty}
            description={fq.fairness.emptyDesc}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-space-md">
          {groups.map((g) => (
            <Card key={g.key} className="flex flex-col gap-space-sm">
              <div className="flex flex-wrap items-center gap-space-xs border-b border-border-subtle pb-space-sm">
                <Badge tone={g.kind === 'HEAD' ? 'primary' : 'info'}>{BULK_WINDOW_KIND_LABELS_FA[g.kind]}</Badge>
                <span className="text-label-lg text-text-primary">{g.carrierName}</span>
                <span className="text-body-sm text-text-secondary">
                  {isoDateToJalali(g.date)} · {g.groupTitle} · {fq.fairness.windowValue(faDigits(g.windowSeq), faDigits(g.round))}
                </span>
                <span className="ms-auto text-caption text-text-muted">
                  {fq.fairness.total(faDigits(g.rows.length))}
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-border-subtle">
                {g.rows.map((r, i) => (
                  <li key={`${r.driverName}-${r.windowSeq}-${i}`} className="flex flex-col gap-1 py-space-xs">
                    <div className="flex flex-wrap items-center justify-between gap-space-xs">
                      <p className="text-body-md font-semibold text-text-primary">{r.driverName}</p>
                      <p className="text-caption text-text-muted">
                        {fq.fairness.plate}: {r.plate ? faDigits(r.plate) : fq.common.none}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-space-md gap-y-1 text-caption text-text-muted">
                      <span>
                        {fq.fairness.announcement}:{' '}
                        {r.announcementNumber !== null ? faDigits(r.announcementNumber) : fq.common.none}
                      </span>
                      <span>
                        {fq.fairness.destination}: {r.destinationTitle ?? fq.common.none}
                      </span>
                      <span>
                        {fq.fairness.reservedAt}: {r.reservedAt ? formatDateTimeFa(r.reservedAt) : fq.common.none}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
