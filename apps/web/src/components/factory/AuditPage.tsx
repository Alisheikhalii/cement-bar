'use client';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { LogOut } from 'lucide-react';
import { FACTORY_AUDIT_COLUMNS, FACTORY_SESSION_COLUMNS, type TableRow } from '@cb/shared';
import { Button3D, Tabs } from '@cb/ui';
import { ServerTable, tableQueryKey } from '@/components/table/ServerTable';
import { faFactory as t } from '@/i18n/factory';
import { api } from '@/lib/api';
import { ConfirmModal, FactoryPageHeader, useFactoryMutation } from './common';

const SESSIONS = '/factory/sessions';

function SessionsTab() {
  const [target, setTarget] = useState<TableRow | null>(null);
  const revoke = useFactoryMutation(() => api.post<void>(`${SESSIONS}/${target!.id}/revoke`), {
    invalidate: [tableQueryKey(SESSIONS)],
    success: t.audit.revoked,
    onSuccess: () => setTarget(null),
  });
  const actions = useMemo<ColumnDef<TableRow, unknown>[]>(
    () => [
      {
        id: 'actions',
        header: t.common.actions,
        enableSorting: false,
        enableHiding: false,
        meta: { label: t.common.actions },
        cell: ({ row }) => (
          <Button3D size="sm" variant="danger" icon={<LogOut className="size-4" aria-hidden />} onClick={() => setTarget(row.original)}>
            {t.audit.revoke}
          </Button3D>
        ),
      },
    ],
    [],
  );
  return (
    <>
      <ServerTable endpoint={SESSIONS} columns={FACTORY_SESSION_COLUMNS} storageKey="factory-sessions" extraColumns={actions} caption={t.audit.tabs.sessions} />
      <ConfirmModal
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`${t.audit.revoke} — ${String(target?.userName ?? '')}`}
        message={t.audit.revokeConfirm}
        variant="danger"
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate(undefined)}
      />
    </>
  );
}

export function AuditPage() {
  return (
    <div>
      <FactoryPageHeader title={t.audit.title} description={t.audit.description} />
      <Tabs
        aria-label={t.audit.title}
        items={[
          {
            value: 'audit',
            label: t.audit.tabs.audit,
            content: (
              <ServerTable
                endpoint="/factory/audit"
                columns={FACTORY_AUDIT_COLUMNS}
                storageKey="factory-audit"
                caption={t.audit.tabs.audit}
                defaultSort={{ id: 'at', desc: true }}
              />
            ),
          },
          { value: 'sessions', label: t.audit.tabs.sessions, content: <SessionsTab /> },
        ]}
      />
    </div>
  );
}
