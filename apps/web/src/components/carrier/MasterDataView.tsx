'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button3D, IconButton3D, Modal, Tabs, useToast } from '@cb/ui';
import { CARRIER_MASTER_COLUMNS, CARRIER_MASTER_KINDS, type CarrierMasterKind, type TableRow } from '@cb/shared';
import { faCarrier } from '@/i18n/carrier';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/StateViews';
import { ServerTable, tableQueryKey } from '@/components/table/ServerTable';
import { MasterForm } from './MasterForm';

const m = faCarrier.master;
const c = faCarrier.common;

/** US-B10: five carrier master tables; factory-shared rows are read-only (P2-5). */
export function MasterDataView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<CarrierMasterKind>('parties');
  const [edit, setEdit] = useState<{ id: string; cityLabel?: string } | null>(null);
  const [toDelete, setToDelete] = useState<TableRow | null>(null);
  const endpoint = `/carrier/master/${kind}`;
  const kindLabel = m.tabs[kind];

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`${endpoint}/${id}`),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: c.deleted });
      setToDelete(null);
      await qc.invalidateQueries({ queryKey: tableQueryKey(endpoint) });
    },
    onError: (e) => toast.toast({ tone: 'danger', title: c.failed, description: errorMessage(e) }),
  });

  const actions = useMemo<ColumnDef<TableRow, unknown>[]>(
    () => [
      {
        id: 'actions',
        header: c.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.shared ? (
            <span className="inline-flex items-center gap-1 text-label-md text-text-muted" title={c.readOnlyShared}>
              <Lock className="size-4" aria-hidden />
              {c.readOnlyShared}
            </span>
          ) : (
            <div className="flex gap-space-xs">
              <IconButton3D
                label={c.edit}
                variant="primary"
                icon={<Pencil className="size-4" aria-hidden />}
                onClick={() => setEdit({ id: row.original.id, cityLabel: typeof row.original.city === 'string' ? row.original.city : undefined })}
              />
              <IconButton3D label={c.delete} variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setToDelete(row.original)} />
            </div>
          ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader title={m.title} description={m.description} />
      <Tabs
        aria-label={m.title}
        className="mb-space-md"
        value={kind}
        onValueChange={(v) => setKind(v as CarrierMasterKind)}
        items={CARRIER_MASTER_KINDS.map((k) => ({ value: k, label: m.tabs[k] }))}
      />
      <ServerTable
        key={kind}
        endpoint={endpoint}
        columns={CARRIER_MASTER_COLUMNS[kind]}
        storageKey={`carrier-master-${kind}`}
        extraColumns={actions}
        caption={kindLabel}
        toolbar={
          <Button3D size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEdit({ id: 'new' })}>
            {c.add}
          </Button3D>
        }
      />
      <MasterForm key={kind} kind={kind} kindLabel={kindLabel} editId={edit?.id ?? null} cityLabel={edit?.cityLabel} onClose={() => setEdit(null)} />
      <Modal
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={m.deleteTitle}
        size="sm"
        footer={
          <Button3D fullWidth variant="danger" loading={remove.isPending} onClick={() => toDelete && remove.mutate(toDelete.id)}>
            {c.delete}
          </Button3D>
        }
      >
        <p className="text-body-md text-text-secondary">{m.deleteConfirm}</p>
      </Modal>
    </div>
  );
}
