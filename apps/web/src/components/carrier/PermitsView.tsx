'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreVertical } from 'lucide-react';
import { Alert, IconButton3D, Menu, Tabs, useToast, type Tone } from '@cb/ui';
import {
  PERMIT_COLUMNS,
  PERMIT_TRANSITIONS,
  faDigits,
  type PermitAction,
  type PermitView,
  type ReservationStatus,
  type TableRow,
} from '@cb/shared';
import { faCarrier } from '@/i18n/carrier';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/StateViews';
import { ServerTable, tableQueryKey } from '@/components/table/ServerTable';
import { ReasonModal } from './shared';

const t = faCarrier.permits;
const ENDPOINT = '/carrier/permits';
const ACTIONS = Object.keys(PERMIT_TRANSITIONS) as PermitAction[];

/** UX hint only — the server enforces the same state machine (PRD §5.5). */
export function allowedActions(status: ReservationStatus): PermitAction[] {
  return ACTIONS.filter((a) => (PERMIT_TRANSITIONS[a].from as readonly ReservationStatus[]).includes(status));
}

const STATUS_TONE: Partial<Record<ReservationStatus, Tone>> = {
  RESERVED: 'primary',
  ARRIVED: 'info',
  LOADED: 'purple',
  EXITED: 'success',
  CANCEL_REQUESTED: 'warning',
  NO_SHOW: 'danger',
  RETURNED: 'danger',
};

interface Pending {
  row: TableRow;
  action: PermitAction;
}

/** US-B9: permits on this carrier's loads + operational status actions. */
export function PermitsView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<PermitView>('active');
  const [pending, setPending] = useState<Pending | null>(null);

  const act = useMutation({
    mutationFn: (v: { id: string; action: PermitAction; text: string }) =>
      api.post(`${ENDPOINT}/${v.id}/${v.action}`, v.action === 'return' ? { reason: v.text } : v.text ? { note: v.text } : {}),
    onSuccess: async (_r, v) => {
      toast.toast({ tone: 'success', title: t.done(t.actions[v.action]) });
      setPending(null);
      await qc.invalidateQueries({ queryKey: tableQueryKey(ENDPOINT) });
    },
    onError: (e) => toast.toast({ tone: 'danger', title: faCarrier.common.failed, description: errorMessage(e) }),
  });

  const actions = useMemo<ColumnDef<TableRow, unknown>[]>(
    () => [
      {
        id: 'actions',
        header: faCarrier.common.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const allowed = allowedActions(row.original.status as ReservationStatus);
          if (!allowed.length) return <span className="text-label-md text-text-muted">{t.noActions}</span>;
          return (
            <Menu
              label={faCarrier.common.actions}
              trigger={<IconButton3D label={faCarrier.common.actions} icon={<MoreVertical className="size-4" aria-hidden />} variant="neutral" />}
              items={allowed.map((a) => ({
                key: a,
                label: t.actions[a],
                danger: a === 'no-show' || a === 'return',
                onSelect: () => setPending({ row: row.original, action: a }),
              }))}
            />
          );
        },
      },
    ],
    [],
  );

  const actionLabel = pending ? t.actions[pending.action] : '';
  return (
    <div>
      <PageHeader title={t.title} description={t.description} />
      <Tabs
        aria-label={t.title}
        className="mb-space-md"
        value={view}
        onValueChange={(v) => setView(v as PermitView)}
        items={[
          { value: 'active', label: t.tabs.active },
          { value: 'archived', label: t.tabs.archived },
        ]}
      />
      <ServerTable
        endpoint={ENDPOINT}
        columns={PERMIT_COLUMNS}
        storageKey="carrier-permits"
        params={{ view }}
        extraColumns={actions}
        rowTone={(r) => STATUS_TONE[r.status as ReservationStatus] ?? 'neutral'}
        caption={t.title}
        defaultSort={{ id: 'reservedAt', desc: true }}
      />
      <Alert tone="info" className="mt-space-md">
        {t.manualPending}
      </Alert>
      <ReasonModal
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? t.confirmTitle(actionLabel, faDigits(String(pending.row.permitNo ?? ''))) : ''}
        required={pending?.action === 'return'}
        tone={pending?.action === 'return' || pending?.action === 'no-show' ? 'danger' : 'primary'}
        submitLabel={actionLabel}
        loading={act.isPending}
        onSubmit={({ text }) => pending && act.mutate({ id: pending.row.id, action: pending.action, text })}
      />
    </div>
  );
}
