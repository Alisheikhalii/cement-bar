'use client';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, XCircle } from 'lucide-react';
import {
  ANNOUNCEMENT_COLUMNS,
  ANNOUNCEMENT_VIEWS,
  faDigits,
  faNumber,
  type AnnouncementDetailDto,
  type AnnouncementView,
  type TableRow,
} from '@cb/shared';
import { Badge, Button3D, Tabs, useToast } from '@cb/ui';
import { faAnnouncements as t } from '@/i18n/announcements';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/StateViews';
import { ServerTable } from '@/components/table/ServerTable';
import { AnnouncementDetails } from './AnnouncementDetails';
import { AnnouncementFormModal } from './AnnouncementFormModal';
import { ANN_ENDPOINT, useInvalidateAnnouncements, useSummary } from './data';
import type { FormMode } from './FormSections';
import { ReasonModal } from './ReasonModal';

type FormState = { mode: FormMode; source?: AnnouncementDetailDto } | null;

function SummaryBadges({ view }: { view: AnnouncementView }) {
  const s = useSummary(view);
  if (!s.data) return null;
  return (
    <div className="flex flex-wrap gap-space-xs" aria-live="polite">
      <Badge tone="primary">
        {t.stats.announcements}: {faNumber(s.data.announcements)}
      </Badge>
      <Badge tone="info">
        {t.stats.trucks}: {faNumber(s.data.trucks)}
      </Badge>
      <Badge tone="success">
        {t.stats.remaining}: {faNumber(s.data.remaining)}
      </Badge>
    </div>
  );
}

/** /carrier/announcements — list (all spec columns) + 7-section form + details drawer (US-B3/B4). */
export function AnnouncementsPage() {
  const toast = useToast();
  const invalidate = useInvalidateAnnouncements();
  const [view, setView] = useState<AnnouncementView>('active');
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; number: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const one = selected.length === 1 ? selected[0]! : null;

  /** Edit / copy / cancel from the toolbar need the full detail (form values, editability). */
  async function withDetail(fn: (a: AnnouncementDetailDto) => void) {
    if (!one) return toast.toast({ tone: 'warning', title: t.selectOne });
    setBusy(true);
    try {
      fn(await api.get<AnnouncementDetailDto>(`${ANN_ENDPOINT}/${one}`));
    } catch (e) {
      toast.toast({ tone: 'danger', title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const openEdit = (a: AnnouncementDetailDto) => {
    if (!a.editable && a.editBlockedReason) return toast.toast({ tone: 'warning', title: t.details.editBlocked[a.editBlockedReason] });
    setFormState({ mode: 'edit', source: a });
  };
  const openCopy = (a: AnnouncementDetailDto) => setFormState({ mode: 'copy', source: a });
  const openCancel = (a: AnnouncementDetailDto) => {
    if (!a.cancellable) {
      return toast.toast({ tone: 'warning', title: t.details.editBlocked[a.editBlockedReason ?? 'NOT_ACTIVE'] });
    }
    setCancelTarget({ id: a.id, number: a.number });
  };

  const extraColumns = useMemo<ColumnDef<TableRow, unknown>[]>(
    () => [
      {
        id: 'actions',
        header: t.actions.details,
        enableSorting: false,
        enableHiding: false,
        cell: (ctx) => (
          <Button3D size="sm" variant="ghost" icon={<Eye className="size-4" aria-hidden />} onClick={() => setDetailId(ctx.row.original.id)}>
            {t.actions.details}
          </Button3D>
        ),
        meta: { label: t.actions.details },
      },
    ],
    [],
  );

  const toolbar = (
    <>
      <Button3D size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setFormState({ mode: 'create' })}>
        {t.actions.add}
      </Button3D>
      <Button3D size="sm" variant="neutral" icon={<Eye className="size-4" aria-hidden />} disabled={!one} onClick={() => setDetailId(one)}>
        {t.actions.view}
      </Button3D>
      <Button3D size="sm" variant="neutral" icon={<Pencil className="size-4" aria-hidden />} disabled={!one || busy} onClick={() => void withDetail(openEdit)}>
        {t.actions.edit}
      </Button3D>
      <Button3D size="sm" variant="neutral" icon={<Copy className="size-4" aria-hidden />} disabled={!one || busy} onClick={() => void withDetail(openCopy)}>
        {t.actions.copy}
      </Button3D>
      <Button3D size="sm" variant="danger" icon={<XCircle className="size-4" aria-hidden />} disabled={!one || busy} onClick={() => void withDetail(openCancel)}>
        {t.actions.cancel}
      </Button3D>
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      <PageHeader title={t.pageTitle} description={t.pageDescription} />
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <Tabs
          aria-label={t.viewsLabel}
          value={view}
          onValueChange={(v) => {
            setView(v as AnnouncementView);
            setSelected([]);
          }}
          items={ANNOUNCEMENT_VIEWS.map((v) => ({ value: v, label: t.views[v] }))}
        />
        <SummaryBadges view={view} />
      </div>
      <ServerTable
        endpoint={ANN_ENDPOINT}
        columns={ANNOUNCEMENT_COLUMNS}
        storageKey="carrier-announcements"
        params={{ view }}
        extraColumns={extraColumns}
        toolbar={toolbar}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={setSelected}
        rowTone={(r) => (r.status === 'CANCELLED' ? 'danger' : r.remaining === 0 ? 'success' : 'primary')}
        caption={t.pageTitle}
        defaultSort={{ id: 'number', desc: true }}
      />
      <AnnouncementDetails
        id={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        onEdit={(a) => {
          setDetailId(null);
          openEdit(a);
        }}
        onCopy={(a) => {
          setDetailId(null);
          openCopy(a);
        }}
        onCancel={(a) => {
          setDetailId(null);
          openCancel(a);
        }}
      />
      <AnnouncementFormModal
        open={!!formState}
        mode={formState?.mode ?? 'create'}
        source={formState?.source}
        onOpenChange={(o) => !o && setFormState(null)}
        onDone={(a) => {
          setSelected([]);
          setDetailId(a.id);
        }}
      />
      <ReasonModal
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title={cancelTarget ? t.cancelTitle(faDigits(cancelTarget.number)) : ''}
        description={t.cancelDescription}
        label={t.reason}
        confirmLabel={t.actions.confirmCancel}
        danger
        onConfirm={async (reason) => {
          await api.post(`${ANN_ENDPOINT}/${cancelTarget!.id}/cancel`, { reason });
          invalidate();
          setSelected([]);
          toast.toast({ tone: 'success', title: t.cancelled });
        }}
      />
    </div>
  );
}
