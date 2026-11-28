'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Ticket, Truck } from 'lucide-react';
import {
  ALLOCATION_LABELS_FA,
  UNIT_STATE_LABELS_FA,
  faDigits,
  formatRial,
  formatTon,
  isoDateToJalali,
  type DriverLoadUnitDto,
} from '@cb/shared';
import {
  Alert,
  Button3D,
  button3DClasses,
  cn,
  Modal,
  Skeleton,
  useToast,
} from '@cb/ui';
import { ErrorState } from '@/components/StateViews';
import { faDriverQueue } from '@/i18n/driver-queue';
import { ApiError, errorMessage } from '@/lib/api';
import { useCreateReservation, useLoadDetail } from './queries';

const l = faDriverQueue.loads;
const reasons = faDriverQueue.loadBlockReasons;

function UnitChip({
  unit,
  selected,
  onSelect,
}: {
  unit: DriverLoadUnitDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const disabled = unit.state !== 'OPEN';
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'flex min-h-11 flex-col items-center justify-center rounded-xl border-2 px-space-xs py-1.5 text-center transition-colors',
        selected
          ? 'border-primary-container bg-surface-container-low text-primary-container'
          : 'border-border-subtle bg-surface-container-low text-text-body',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="text-label-md">{l.unitSeq(faDigits(unit.seq))}</span>
      <span className="text-caption">{unit.reservedByMe ? l.myReservation : UNIT_STATE_LABELS_FA[unit.state]}</span>
    </button>
  );
}

export function LoadDetailModal({
  announcementId,
  onClose,
}: {
  announcementId: string | null;
  onClose: () => void;
}) {
  const q = useLoadDetail(announcementId);
  const reserve = useCreateReservation();
  const toast = useToast();
  const [unitId, setUnitId] = useState<string | null>(null);

  useEffect(() => {
    setUnitId(null);
  }, [announcementId]);

  const d = q.data;
  const units = d?.units ?? [];
  const canReserve = Boolean(d?.isReservable) && !d?.myReservedUnitId && !d?.fullyReserved;

  const onReserve = () => {
    if (!announcementId) return;
    reserve.mutate(
      unitId ? { unitId } : { announcementId },
      {
        onSuccess: (r) => {
          toast.toast({ tone: 'success', title: l.reservedToast(faDigits(r.permitNo)) });
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError && (e.code === 'UNIT_TAKEN' || e.code === 'NO_UNIT_AVAILABLE')) {
            toast.toast({ tone: 'warning', title: e.code === 'UNIT_TAKEN' ? l.takenToast : l.noUnitToast });
            setUnitId(null);
            void q.refetch();
            return;
          }
          toast.toast({ tone: 'danger', title: l.blockTitle, description: errorMessage(e) });
        },
      },
    );
  };

  return (
    <Modal
      open={!!announcementId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={l.detailTitle}
      subtitle={d ? `#${faDigits(d.number)} — ${d.destinationTitle}` : undefined}
      icon={<Truck className="size-5" />}
      size="lg"
      footer={
        d ? (
          <>
            <Button3D variant="neutral" onClick={onClose}>
              {faDriverQueue.common.cancel}
            </Button3D>
            <Button3D
              variant="success"
              icon={<Ticket className="size-4" aria-hidden />}
              disabled={!canReserve}
              loading={reserve.isPending}
              onClick={onReserve}
            >
              {unitId ? l.reserveUnit : l.reserveAny}
            </Button3D>
          </>
        ) : null
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-space-sm" role="status" aria-label={l.detailLoading}>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : d ? (
        <div className="flex flex-col gap-space-lg">
          {d.myReservedUnitId ? (
            <Alert tone="success" title={l.mineTitle}>
              {l.mineBody}
            </Alert>
          ) : !d.isReservable && d.blockReason ? (
            <Alert tone="warning" title={l.blockTitle}>
              {reasons[d.blockReason]}
            </Alert>
          ) : d.fullyReserved ? (
            <Alert tone="warning">{l.fullyReserved}</Alert>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-space-md gap-y-space-sm text-body-sm">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="text-caption text-text-muted">{l.announcementNo}</dt>
              <dd className="text-label-lg text-text-primary">
                #{faDigits(d.number)} — {ALLOCATION_LABELS_FA[d.allocation]}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.carrier}</dt>
              <dd className="truncate text-text-body">{d.carrierName}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.hall}</dt>
              <dd className="truncate text-text-body">{d.hallTitle}</dd>
            </div>
            <div className="col-span-2 min-w-0">
              <dt className="text-caption text-text-muted">{l.destination}</dt>
              <dd className="truncate text-text-body">
                {d.originTitle} ← {d.destinationTitle}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.product}</dt>
              <dd className="truncate text-text-body">{d.productTitle}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.packaging}</dt>
              <dd className="truncate text-text-body">{d.packagingTitle}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.loader}</dt>
              <dd className="truncate text-text-body">{d.loaderTitles.join('، ')}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.weight}</dt>
              <dd className="text-text-body">
                {l.weightRange(formatTon(d.weightFromKg), formatTon(d.weightToKg))}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.announceAt}</dt>
              <dd className="text-text-body" dir="rtl">
                {isoDateToJalali(d.announceDate)} — {faDigits(d.announceTime)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.fare}</dt>
              <dd className="text-text-body">{d.fareRial ? formatRial(d.fareRial) : faDriverQueue.common.none}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-text-muted">{l.units}</dt>
              <dd className="text-text-body">{l.openUnitCount(faDigits(d.openUnits), faDigits(d.totalUnits))}</dd>
            </div>
          </dl>

          <section className="flex flex-col gap-space-xs">
            <h3 className="text-label-lg text-text-primary">{l.units}</h3>
            <p className="text-caption text-text-muted">{l.unitsHint}</p>
            {units.length === 0 ? (
              <p className="text-body-sm text-text-muted">{l.unitsEmpty}</p>
            ) : (
              <div className="grid grid-cols-3 gap-space-xs sm:grid-cols-5">
                {units.map((u) => (
                  <UnitChip
                    key={u.id}
                    unit={u}
                    selected={unitId === u.id}
                    onSelect={() => setUnitId((cur) => (cur === u.id ? null : u.id))}
                  />
                ))}
              </div>
            )}
          </section>

          {d.myReservedUnitId ? (
            <Link href="/driver/reservations" className={button3DClasses({ variant: 'neutral', fullWidth: true })}>
              {l.viewReservations}
            </Link>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
