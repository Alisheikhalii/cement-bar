'use client';
import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, MapPin, PackageSearch } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ALLOCATION_LABELS_FA,
  faDigits,
  type Allocation,
  type HallCategory,
} from '@cb/shared';
import { Button3D, Card, EmptyState, Select, Skeleton, Tabs, TextInput } from '@cb/ui';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { fa } from '@/i18n/fa';
import { faDriverQueue } from '@/i18n/driver-queue';
import { errorMessage } from '@/lib/api';
import { useQueueEvents } from '@/lib/useQueueEvents';
import { matchesQuery } from '../format';
import { LoadCardItem } from './LoadCardItem';
import { LoadDetailModal } from './LoadDetailModal';
import { filterLoads } from './helpers';
import {
  LOAD_ALLOCATION_OPTIONS,
  queueKeys,
  useLoadCities,
  useLoads,
  type LoadFilters,
} from './queries';

const l = faDriverQueue.loads;
const reasons = faDriverQueue.loadBlockReasons;
const c = faDriverQueue.common;

type CategoryFilter = 'ALL' | HallCategory;

export function LoadsView() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [cityQuery, setCityQuery] = useState('');
  const [cityId, setCityId] = useState<number | null>(null);
  const [cityName, setCityName] = useState('');
  const [allocation, setAllocation] = useState<Allocation | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const citiesQ = useLoadCities(category === 'ALL' ? undefined : category);
  const filters = useMemo<LoadFilters>(
    () => ({ cityId: cityId ?? undefined, hallCategory: category === 'ALL' ? undefined : category }),
    [cityId, category],
  );
  const loadsQ = useLoads(filters, cityId !== null);

  const onSse = useCallback(
    (ev: { type: string }) => {
      if (ev.type === 'unit.reserved' || ev.type === 'unit.freed') {
        void qc.invalidateQueries({ queryKey: queueKeys.loadsRoot });
      }
    },
    [qc],
  );
  useQueueEvents(onSse);

  const cities = useMemo(
    () => (citiesQ.data ?? []).filter((x) => matchesQuery(x.cityName, cityQuery) || matchesQuery(x.provinceName, cityQuery)),
    [citiesQ.data, cityQuery],
  );

  const visibleLoads = useMemo(
    () => filterLoads(loadsQ.data ?? [], { allocation, q: search }),
    [loadsQ.data, allocation, search],
  );

  const allocationOptions = useMemo(
    () => [
      { value: 'ALL', label: l.allAllocations },
      ...LOAD_ALLOCATION_OPTIONS.map((a) => ({ value: a, label: ALLOCATION_LABELS_FA[a] })),
    ],
    [],
  );

  const onCategoryChange = (value: string) => {
    setCategory(value as CategoryFilter);
    setCityId(null);
    setCityName('');
  };

  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <PageHeader title={fa.nav.driver.loads} description={l.description} />

      <Tabs
        items={[
          { value: 'ALL', label: l.hallTabs.ALL },
          { value: 'BAG', label: l.hallTabs.BAG },
          { value: 'BULK', label: l.hallTabs.BULK },
        ]}
        value={category}
        onValueChange={onCategoryChange}
        fullWidth
        aria-label={l.hallTabs.ALL}
      />

      {cityId === null ? (
        <section aria-labelledby="load-cities" className="flex flex-col gap-space-sm">
          <div className="flex flex-wrap items-end justify-between gap-space-xs">
            <h2 id="load-cities" className="text-headline-sm text-text-primary">
              {l.cityTitle}
            </h2>
            <p className="text-caption text-text-muted">{l.cityHint}</p>
          </div>
          <TextInput
            type="search"
            value={cityQuery}
            onChange={(e) => setCityQuery(e.target.value)}
            placeholder={l.citySearch}
            aria-label={l.citySearch}
          />

          {citiesQ.isPending ? (
            <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-3 xl:grid-cols-4" role="status">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
          ) : citiesQ.isError ? (
            <ErrorState message={errorMessage(citiesQ.error)} onRetry={() => void citiesQ.refetch()} />
          ) : cities.length === 0 ? (
            <Card>
              <EmptyState title={l.cityEmpty} description={l.cityEmptyBody} icon={<MapPin className="size-7" />} />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-3 xl:grid-cols-4">
              {cities.map((city) => (
                <button
                  key={city.cityId}
                  type="button"
                  onClick={() => {
                    setCityId(city.cityId);
                    setCityName(city.cityName);
                    setSearch('');
                    setAllocation('ALL');
                  }}
                  className="rounded-2xl text-start focus-visible:outline-none"
                >
                  <Card interactive className="flex h-full flex-col gap-1 p-space-md">
                    <span className="flex items-center gap-1.5 text-label-lg text-text-primary">
                      <MapPin className="size-4 shrink-0 text-primary-container" aria-hidden />
                      <span className="truncate">{city.cityName}</span>
                    </span>
                    <span className="truncate text-caption text-text-muted">{city.provinceName}</span>
                    <span className="mt-auto text-body-sm font-semibold text-success">
                      {l.cityCounts(faDigits(city.open), faDigits(city.total))}
                    </span>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section aria-labelledby="load-list" className="flex flex-col gap-space-sm">
          <div className="flex flex-wrap items-center justify-between gap-space-xs">
            <h2 id="load-list" className="text-headline-sm text-text-primary">
              {l.listTitle(cityName)}
            </h2>
            <Button3D
              variant="neutral"
              size="sm"
              icon={<ArrowRight className="size-4" aria-hidden />}
              onClick={() => setCityId(null)}
            >
              {l.changeCity}
            </Button3D>
          </div>

          <Card className="flex flex-col gap-space-sm p-space-md">
            <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
              <TextInput
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={l.searchPlaceholder}
                aria-label={l.searchLabel}
              />
              <Select
                value={allocation}
                onValueChange={(value) => setAllocation(value as Allocation | 'ALL')}
                options={allocationOptions}
                aria-label={l.allocationLabel}
              />
            </div>
            <p className="text-caption text-text-muted">{c.updateHint}</p>
          </Card>

          {loadsQ.isPending ? (
            <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3" role="status">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : loadsQ.isError ? (
            <ErrorState message={errorMessage(loadsQ.error)} onRetry={() => void loadsQ.refetch()} />
          ) : visibleLoads.length === 0 ? (
            <Card>
              <EmptyState
                title={l.loadsEmpty}
                description={l.loadsEmptyBody}
                icon={<PackageSearch className="size-7" />}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3">
              {visibleLoads.map((load) => {
                const mine = Boolean(load.myReservedUnitId);
                const caption = mine
                  ? l.mineBody
                  : load.fullyReserved
                    ? l.fullyReserved
                    : !load.isReservable && load.blockReason
                      ? reasons[load.blockReason]
                      : null;
                return (
                  <LoadCardItem
                    key={load.id}
                    load={load}
                    ctaLabel={mine ? l.ctaMine : load.fullyReserved ? l.ctaUnavailable : l.ctaDetail}
                    disabled={mine || !load.isReservable}
                    caption={caption}
                    onCta={() => setDetailId(load.id)}
                  />
                );
              })}
            </div>
          )}
        </section>
      )}

      <LoadDetailModal announcementId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
