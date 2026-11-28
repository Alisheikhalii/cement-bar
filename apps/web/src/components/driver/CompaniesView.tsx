'use client';
import { useMemo, useState } from 'react';
import { Building2, MapPin, Phone, Search } from 'lucide-react';
import {
  CARRIER_STATUS_LABELS_FA,
  DRIVER_STATUS_LABELS_FA,
  enDigits,
  faDigits,
  type DriverStatus,
} from '@cb/shared';
import { Badge, Card, EmptyState, TextInput, button3DClasses, cn, type Tone } from '@cb/ui';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/StateViews';
import { faDriver } from '@/i18n/driver';
import { errorMessage } from '@/lib/api';
import { matchesQuery } from './format';
import { useDriverCompanies } from './queries';

const c = faDriver.companies;
const STATUS_TONE: Record<DriverStatus, Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  BLOCKED: 'danger',
};

export function CompaniesView() {
  const q = useDriverCompanies();
  const [query, setQuery] = useState('');
  const list = useMemo(() => (q.data ?? []).filter((x) => matchesQuery(x.name, query)), [q.data, query]);

  return (
    <div>
      <PageHeader title={c.title} description={c.description} />
      <div className="relative mb-space-md">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <TextInput
          aria-label={c.search}
          placeholder={c.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ps-10"
          type="search"
        />
      </div>

      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Building2 className="size-7" />} title={c.empty} />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-3">
          {list.map((co) => (
            <li key={co.id}>
              <Card
                className={cn(
                  'relative flex h-full flex-col gap-space-sm overflow-hidden',
                  co.mine && 'ring-2 ring-primary-container',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-y-0 start-0 w-1.5',
                    co.mine ? 'bg-primary-container' : 'bg-outline-variant',
                  )}
                />
                <div className="flex flex-wrap items-center justify-between gap-space-xs">
                  <h2 className="text-headline-sm text-text-primary">{co.name}</h2>
                  <div className="flex flex-wrap gap-1">
                    {co.mine ? <Badge tone="primary">{c.mine}</Badge> : null}
                    {co.status !== 'ACTIVE' ? (
                      <Badge tone="warning">{CARRIER_STATUS_LABELS_FA[co.status]}</Badge>
                    ) : null}
                  </div>
                </div>
                {co.mine && co.driverStatus ? (
                  <p className="text-body-sm text-text-secondary">
                    {c.myStatus}:{' '}
                    <Badge tone={STATUS_TONE[co.driverStatus]}>
                      {DRIVER_STATUS_LABELS_FA[co.driverStatus]}
                    </Badge>
                  </p>
                ) : null}
                <dl className="flex flex-col gap-space-xs text-body-md">
                  <div className="flex items-start gap-space-xs">
                    <dt className="flex items-center gap-1 text-text-secondary">
                      <Phone className="size-4" aria-hidden />
                      {c.phone}:
                    </dt>
                    <dd className="text-text-primary" dir="ltr">
                      {co.phone ? faDigits(co.phone) : c.noValue}
                    </dd>
                  </div>
                  <div className="flex items-start gap-space-xs">
                    <dt className="flex shrink-0 items-center gap-1 text-text-secondary">
                      <MapPin className="size-4" aria-hidden />
                      {c.address}:
                    </dt>
                    <dd className="min-w-0 break-words text-text-primary">
                      {co.address ? faDigits(co.address) : c.noValue}
                    </dd>
                  </div>
                </dl>
                {co.phone ? (
                  <a
                    href={`tel:${enDigits(co.phone).replace(/[^\d+]/g, '')}`}
                    className={cn(button3DClasses({ variant: 'success', size: 'sm' }), 'mt-auto self-start')}
                  >
                    <Phone className="size-4" aria-hidden />
                    {c.call}
                  </a>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
