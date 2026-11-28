'use client';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Unlock } from 'lucide-react';
import { FACTORY_DRIVER_COLUMNS, type DriverBlockResultDto, type TableRow } from '@cb/shared';
import { Button3D, Field, JalaliDatePicker } from '@cb/ui';
import { ServerTable, tableQueryKey } from '@/components/table/ServerTable';
import { faFactory as t } from '@/i18n/factory';
import { api } from '@/lib/api';
import { ConfirmModal, FactoryPageHeader, useFactoryMutation } from './common';

const ENDPOINT = '/factory/drivers';
const TONE = { APPROVED: 'success', PENDING: 'warning', REJECTED: 'neutral', BLOCKED: 'danger' } as const;

export function DriversPage() {
  const [target, setTarget] = useState<{ row: TableRow; action: 'block' | 'unblock' } | null>(null);
  const [until, setUntil] = useState('');
  const close = () => {
    setTarget(null);
    setUntil('');
  };
  const block = useFactoryMutation(
    (reason: string) =>
      api.post<DriverBlockResultDto>(`${ENDPOINT}/${target!.row.id}/block`, { reason, ...(until ? { until } : {}) }),
    { invalidate: [tableQueryKey(ENDPOINT), ['factory', 'dashboard']], success: t.drivers.blocked, onSuccess: close },
  );
  const unblock = useFactoryMutation(
    (note: string) => api.post<DriverBlockResultDto>(`${ENDPOINT}/${target!.row.id}/unblock`, note ? { note } : {}),
    { invalidate: [tableQueryKey(ENDPOINT), ['factory', 'dashboard']], success: t.drivers.unblocked, onSuccess: close },
  );

  const actions = useMemo<ColumnDef<TableRow, unknown>[]>(
    () => [
      {
        id: 'actions',
        header: t.common.actions,
        enableSorting: false,
        enableHiding: false,
        meta: { label: t.common.actions },
        cell: ({ row }) =>
          row.original.status === 'BLOCKED' ? (
            <Button3D size="sm" variant="success" icon={<Unlock className="size-4" aria-hidden />} onClick={() => setTarget({ row: row.original, action: 'unblock' })}>
              {t.drivers.unblock}
            </Button3D>
          ) : row.original.status === 'REJECTED' ? null : (
            <Button3D size="sm" variant="danger" icon={<Ban className="size-4" aria-hidden />} onClick={() => setTarget({ row: row.original, action: 'block' })}>
              {t.drivers.block}
            </Button3D>
          ),
      },
    ],
    [],
  );
  const name = target ? `${target.row.firstName ?? ''} ${target.row.lastName ?? ''}`.trim() : '';

  return (
    <div>
      <FactoryPageHeader title={t.drivers.title} description={t.drivers.description} />
      <ServerTable
        endpoint={ENDPOINT}
        columns={FACTORY_DRIVER_COLUMNS}
        storageKey="factory-drivers"
        extraColumns={actions}
        caption={t.drivers.title}
        rowTone={(r) => TONE[r.status as keyof typeof TONE] ?? 'neutral'}
      />
      <ConfirmModal
        open={target?.action === 'block'}
        onOpenChange={(o) => !o && close()}
        title={`${t.drivers.block} — ${name}`}
        reasonLabel={t.common.reason}
        variant="danger"
        loading={block.isPending}
        onConfirm={(r) => block.mutate(r)}
      >
        <Field label={t.drivers.until} htmlFor="block-until" hint={t.drivers.untilHint}>
          <JalaliDatePicker id="block-until" value={until} onChange={setUntil} />
        </Field>
      </ConfirmModal>
      <ConfirmModal
        open={target?.action === 'unblock'}
        onOpenChange={(o) => !o && close()}
        title={`${t.drivers.unblock} — ${name}`}
        reasonLabel={t.common.note}
        reasonOptional
        variant="success"
        loading={unblock.isPending}
        onConfirm={(n) => unblock.mutate(n)}
      />
    </div>
  );
}
