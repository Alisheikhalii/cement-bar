'use client';
import { Boxes, Layers, Package, Truck } from 'lucide-react';
import { ALLOCATION_LABELS_FA, faDigits, type DriverLoadDto } from '@cb/shared';
import { LoadCard } from '@cb/ui';
import { faDriverQueue } from '@/i18n/driver-queue';
import { loadStatus } from './helpers';

export interface LoadCardItemProps {
  load: DriverLoadDto;
  ctaLabel: string;
  onCta: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Extra explanation shown under the card (e.g. the block reason). */
  caption?: string | null;
}

const q = faDriverQueue.loads;

/** One announcement rendered with the shared LoadCard plus the driver-specific status and block hint. */
export function LoadCardItem({ load, ctaLabel, onCta, disabled, loading, caption }: LoadCardItemProps) {
  const status = loadStatus(load);
  const statusLabel = status.kind === 'MINE' ? q.myReservation : ALLOCATION_LABELS_FA[status.allocation];
  const reserved = load.fullyReserved && !load.myReservedUnitId;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <LoadCard
        status={{ label: statusLabel, tone: status.tone }}
        reference={`#${faDigits(load.number)}`}
        origin={load.originTitle}
        destination={load.destinationTitle}
        specs={[
          { icon: <Package className="size-4" />, label: q.product, value: load.productTitle },
          { icon: <Boxes className="size-4" />, label: q.packaging, value: load.packagingTitle },
          { icon: <Truck className="size-4" />, label: q.loader, value: load.loaderTitles.join('، ') },
          {
            icon: <Layers className="size-4" />,
            label: q.units,
            value: q.openUnitCount(faDigits(load.openUnits), faDigits(load.totalUnits)),
          },
        ]}
        fareRial={load.fareRial ?? undefined}
        ctaLabel={ctaLabel}
        onCta={onCta}
        ctaLoading={loading}
        reserved={reserved}
        disabled={disabled}
      />
      {caption ? <p className="px-space-xs text-caption text-text-muted">{caption}</p> : null}
    </div>
  );
}
