'use client';
import type { ReactNode } from 'react';
import { Copy, Pencil, XCircle } from 'lucide-react';
import {
  ANNOUNCEMENT_STATUS_LABELS_FA,
  faDigits,
  faNumber,
  formatRial,
  formatTon,
  isoDateToJalali,
  type AnnouncementDetailDto,
} from '@cb/shared';
import { Alert, Badge, Button3D, Drawer, Skeleton } from '@cb/ui';
import { faAnnouncements as t } from '@/i18n/announcements';
import { errorMessage } from '@/lib/api';
import { ErrorState } from '@/components/StateViews';
import { useAnnouncement } from './data';
import { UnitsPanel } from './UnitsPanel';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md text-text-secondary">{label}</dt>
      <dd className="truncate text-body-md text-text-primary">{children ?? '—'}</dd>
    </div>
  );
}

export interface AnnouncementDetailsProps {
  id: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (a: AnnouncementDetailDto) => void;
  onCopy: (a: AnnouncementDetailDto) => void;
  onCancel: (a: AnnouncementDetailDto) => void;
}

function Body({ a, onEdit, onCopy, onCancel }: { a: AnnouncementDetailDto } & Omit<AnnouncementDetailsProps, 'id' | 'onOpenChange'>) {
  const f = a.form;
  const c = a.counts;
  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex flex-wrap items-center gap-space-xs">
        <Badge tone={a.status === 'ACTIVE' ? 'success' : 'neutral'}>{ANNOUNCEMENT_STATUS_LABELS_FA[a.status]}</Badge>
        <Badge tone="info">{a.hall.title}</Badge>
      </div>
      {a.cancelReason ? <Alert tone="warning">{a.cancelReason}</Alert> : null}
      {a.editBlockedReason && a.status === 'ACTIVE' ? <Alert tone="info">{t.details.editBlocked[a.editBlockedReason]}</Alert> : null}
      <div className="flex flex-wrap gap-space-sm">
        <Button3D size="sm" variant="neutral" icon={<Pencil className="size-4" aria-hidden />} disabled={!a.editable} onClick={() => onEdit(a)}>
          {t.actions.edit}
        </Button3D>
        <Button3D size="sm" variant="neutral" icon={<Copy className="size-4" aria-hidden />} onClick={() => onCopy(a)}>
          {t.actions.copy}
        </Button3D>
        <Button3D size="sm" variant="danger" icon={<XCircle className="size-4" aria-hidden />} disabled={!a.cancellable} onClick={() => onCancel(a)}>
          {t.actions.cancel}
        </Button3D>
      </div>
      <dl className="grid grid-cols-2 gap-space-sm rounded-xl bg-surface-container-low p-space-sm">
        <Item label={t.fields.announceDate}>
          {isoDateToJalali(f.announceDate)} {faDigits(f.announceTime)}
        </Item>
        <Item label={t.fields.productId}>{a.labels.product}</Item>
        <Item label={t.details.route}>
          {a.labels.originCity ?? '—'} ← {a.labels.destination ?? a.labels.destCity ?? '—'}
        </Item>
        <Item label={t.details.loader}>
          {[a.labels.loaderType, a.labels.loaderType2].filter(Boolean).join('، ')}
        </Item>
        <Item label={t.details.weight}>
          {formatTon(f.weightFromKg)} – {formatTon(f.weightToKg)}
        </Item>
        <Item label={t.details.fare}>
          {f.fareCalc === 'PER_TON' && f.ratePerTon !== undefined ? formatRial(f.ratePerTon) : f.farePerTruck !== undefined ? formatRial(f.farePerTruck) : null}
        </Item>
        <Item label={t.details.quota}>{formatTon(Number(a.quotaKg))}</Item>
        <Item label={t.fields.loadingLocationId}>{a.labels.loadingLocation}</Item>
      </dl>
      <div className="flex flex-wrap gap-space-xs">
        {(['total', 'open', 'issued', 'held', 'cancelled'] as const).map((k) => (
          <Badge key={k} tone={k === 'open' ? 'success' : k === 'issued' ? 'primary' : 'neutral'}>
            {t.details.counts[k]}: {faNumber(c[k])}
          </Badge>
        ))}
      </div>
      <h3 className="text-headline-sm text-text-primary">{t.details.units}</h3>
      <UnitsPanel key={a.id + a.units.map((u) => u.allocation + u.state).join()} announcement={a} />
    </div>
  );
}

/** Details drawer: summary + load units with allocation changes (SPEC §5.3 "drawer جزئیات واحدها"). */
export function AnnouncementDetails({ id, onOpenChange, ...actions }: AnnouncementDetailsProps) {
  const q = useAnnouncement(id);
  const title = q.data ? t.details.title(faDigits(q.data.number)) : t.actions.details;
  return (
    <Drawer open={!!id} onOpenChange={onOpenChange} title={title} className="w-[40rem] max-w-full">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-space-md pt-space-lg">
        <h2 className="mb-space-md pe-12 text-headline-md text-text-primary">{title}</h2>
        {q.isPending ? (
          <div className="flex flex-col gap-space-sm" role="status">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-32" />
            <Skeleton className="h-48" />
          </div>
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : (
          <Body a={q.data} {...actions} />
        )}
      </div>
    </Drawer>
  );
}
