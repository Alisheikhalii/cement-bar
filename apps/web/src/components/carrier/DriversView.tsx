'use client';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';
import { IconButton3D, Tabs, type Tone } from '@cb/ui';
import { CARRIER_DRIVER_COLUMNS, type TableRow } from '@cb/shared';
import { faCarrier } from '@/i18n/carrier';
import { PageHeader } from '@/components/StateViews';
import { ServerTable } from '@/components/table/ServerTable';
import { DriverDetailModal } from './DriverDetailModal';

const t = faCarrier.drivers;
type Tab = 'all' | 'pending' | 'vehicle';

const STATUS_TONE: Record<string, Tone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral', BLOCKED: 'danger' };

/** US-B5: drivers of this carrier; approve / reject / block and vehicle-change review in the detail modal. */
export function DriversView() {
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const params = useMemo<Record<string, string | undefined>>(
    () => (tab === 'pending' ? { f_status: 'PENDING' } : tab === 'vehicle' ? { vehicleChange: 'true' } : {}),
    [tab],
  );

  const actions = useMemo<ColumnDef<TableRow, unknown>[]>(
    () => [
      {
        id: 'actions',
        header: faCarrier.common.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <IconButton3D
            label={faCarrier.common.view}
            icon={<Eye className="size-4" aria-hidden />}
            variant="primary"
            onClick={() => setOpenId(row.original.id)}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader title={t.title} description={t.description} />
      <Tabs
        aria-label={t.title}
        className="mb-space-md"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        items={[
          { value: 'all', label: t.tabs.all },
          { value: 'pending', label: t.tabs.pending },
          { value: 'vehicle', label: t.tabs.vehicle },
        ]}
      />
      <ServerTable
        endpoint="/carrier/drivers"
        columns={CARRIER_DRIVER_COLUMNS}
        storageKey="carrier-drivers"
        params={params}
        extraColumns={actions}
        rowTone={(r) => STATUS_TONE[String(r.status)] ?? 'neutral'}
        caption={t.title}
      />
      <DriverDetailModal driverId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
