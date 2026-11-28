'use client';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';
import { Button3D, useToast } from '@cb/ui';
import { CARRIER_DAILY_FILE_COLUMNS, type TableRow } from '@cb/shared';
import { faCarrier } from '@/i18n/carrier';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/StateViews';
import { ServerTable, tableQueryKey } from '@/components/table/ServerTable';
import { saveBlob, utf8Filename } from './shared';

const t = faCarrier.files;
const ENDPOINT = '/carrier/daily-files';

/** US-B2 / D6: list + download (first download records "seen" on the server). */
export function DailyFilesView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const actions = useMemo<ColumnDef<TableRow, unknown>[]>(() => {
    async function download(row: TableRow) {
      setBusy(row.id);
      try {
        const res = await fetch(`/api${ENDPOINT}/${row.id}/download`, { credentials: 'include' });
        if (!res.ok) {
          // Re-run through the typed client for a proper Persian error (and session refresh).
          await api.download(`${ENDPOINT}/${row.id}/download`).then(({ blob, filename }) => saveBlob(blob, filename ?? 'daily-file.xlsx'));
        } else {
          const name = utf8Filename(res.headers.get('Content-Disposition')) ?? String(row.originalName ?? 'daily-file.xlsx');
          saveBlob(await res.blob(), name);
        }
        await qc.invalidateQueries({ queryKey: tableQueryKey(ENDPOINT) });
        await qc.invalidateQueries({ queryKey: ['carrier', 'dashboard'] });
      } catch (e) {
        toast.toast({ tone: 'danger', title: t.downloadFailed, description: errorMessage(e) });
      } finally {
        setBusy(null);
      }
    }
    return [
      {
        id: 'actions',
        header: faCarrier.common.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button3D
            size="sm"
            variant={row.original.seen ? 'neutral' : 'primary'}
            icon={<Download className="size-4" aria-hidden />}
            loading={busy === row.original.id}
            onClick={() => void download(row.original)}
          >
            {t.download}
          </Button3D>
        ),
      },
    ];
  }, [busy, qc, toast]);

  return (
    <div>
      <PageHeader title={t.title} description={t.description} />
      <ServerTable
        endpoint={ENDPOINT}
        columns={CARRIER_DAILY_FILE_COLUMNS}
        storageKey="carrier-daily-files"
        extraColumns={actions}
        rowTone={(r) => (r.seen ? 'neutral' : 'info')}
        caption={t.title}
      />
    </div>
  );
}
