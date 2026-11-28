'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, X } from 'lucide-react';
import { Badge, Button3D, Card, DataTable, Skeleton, Tabs, useToast, type Tone } from '@cb/ui';
import {
  CANCEL_REQUEST_STATUSES,
  faDigits,
  formatDateTimeFa,
  type CancelRequestStatus,
  type CarrierCancelRequestDto,
} from '@cb/shared';
import { cq } from '@/i18n/carrier-queue';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { tableQueryKey } from '@/components/table/ServerTable';
import { api, errorMessage } from '@/lib/api';
import { CANCEL_KEY } from './helpers';
import { ReasonDialog } from './dialogs';

const STATUS_TONE: Record<CancelRequestStatus, Tone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' };

interface Decision {
  row: CarrierCancelRequestDto;
  action: 'approve' | 'reject';
}

/** US-B8: cancellation requests queue — approve or reject with an optional decision note. */
export function CancelRequestsView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<CancelRequestStatus>('PENDING');
  const [decision, setDecision] = useState<Decision | null>(null);

  const q = useQuery({
    queryKey: [...CANCEL_KEY, status],
    queryFn: ({ signal }) =>
      api.get<CarrierCancelRequestDto[]>('/carrier/cancel-requests', { query: { status }, signal }),
  });

  const decide = useMutation({
    mutationFn: (v: Decision & { note: string }) =>
      api.post<CarrierCancelRequestDto>(`/carrier/cancel-requests/${v.row.id}/${v.action}`, v.note ? { note: v.note } : {}),
    onSuccess: async (_r, v) => {
      toast.toast({
        tone: 'success',
        title: v.action === 'approve' ? cq.cancel.approvedToast : cq.cancel.rejectedToast,
      });
      setDecision(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: CANCEL_KEY }),
        qc.invalidateQueries({ queryKey: tableQueryKey('/carrier/permits') }),
        qc.invalidateQueries({ queryKey: ['carrier', 'dashboard'] }),
      ]);
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const columns = useMemo<ColumnDef<CarrierCancelRequestDto, unknown>[]>(
    () => [
      {
        id: 'driver',
        header: cq.cancel.driver,
        enableSorting: false,
        cell: ({ row }) => <span className="font-semibold">{row.original.driverName}</span>,
      },
      {
        id: 'carrier',
        header: cq.cancel.carrier,
        enableSorting: false,
        cell: ({ row }) => row.original.carrierName,
      },
      {
        id: 'permit',
        header: cq.cancel.permit,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="whitespace-nowrap">
              {cq.cancel.permitValue(
                faDigits(row.original.reservation.permitNo),
                faDigits(row.original.reservation.announcementNumber),
              )}
            </p>
            <p className="text-caption text-text-muted">
              {cq.cancel.unit} {faDigits(row.original.reservation.unitSeq)} ·{' '}
              {row.original.reservation.destinationTitle}
            </p>
          </div>
        ),
      },
      {
        id: 'status',
        header: cq.cancel.statusLabel,
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status]}>{cq.cancel.status[row.original.status]}</Badge>
        ),
      },
      {
        id: 'reason',
        header: cq.cancel.reason,
        enableSorting: false,
        cell: ({ row }) => <span className="block max-w-64 break-words">{row.original.reason}</span>,
        meta: { hideOnMobile: false },
      },
      {
        id: 'createdAt',
        header: cq.cancel.createdAt,
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTimeFa(row.original.createdAt)}</span>,
      },
      {
        id: 'decision',
        header: cq.cancel.decisionNote,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.status === 'PENDING'
            ? cq.common.none
            : (
                <div className="min-w-0">
                  <p className="break-words text-body-sm">{row.original.decisionNote ?? cq.common.none}</p>
                  {row.original.decidedAt ? (
                    <p className="text-caption text-text-muted">{formatDateTimeFa(row.original.decidedAt)}</p>
                  ) : null}
                </div>
              ),
      },
      {
        id: 'actions',
        header: cq.cancel.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.status === 'PENDING' ? (
            <div className="flex flex-wrap gap-space-xs">
              <Button3D
                size="sm"
                variant="success"
                icon={<Check className="size-4" aria-hidden />}
                onClick={() => setDecision({ row: row.original, action: 'approve' })}
              >
                {cq.cancel.approve}
              </Button3D>
              <Button3D
                size="sm"
                variant="danger"
                icon={<X className="size-4" aria-hidden />}
                onClick={() => setDecision({ row: row.original, action: 'reject' })}
              >
                {cq.cancel.reject}
              </Button3D>
            </div>
          ) : null,
      },
    ],
    [],
  );

  const actionLabel = decision?.action === 'approve' ? cq.cancel.approve : cq.cancel.reject;
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader title={cq.cancel.title} description={cq.cancel.description} />

      <Tabs
        aria-label={cq.cancel.title}
        value={status}
        onValueChange={(v) => setStatus(v as CancelRequestStatus)}
        items={CANCEL_REQUEST_STATUSES.map((s) => ({ value: s, label: cq.cancel.tabs[s] }))}
      />

      <Card>
        {q.isPending ? (
          <div className="flex flex-col gap-space-sm" role="status" aria-label={cq.common.loading}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable<CarrierCancelRequestDto>
            columns={columns}
            data={q.data}
            getRowId={(r) => r.id}
            emptyText={cq.cancel.empty}
            caption={cq.cancel.title}
            rowTone={(r) => STATUS_TONE[r.status]}
          />
        )}
        {!q.isPending && !q.isError && q.data.length === 0 ? (
          <p className="mt-space-sm text-center text-body-sm text-text-muted">{cq.cancel.emptyDesc}</p>
        ) : null}
      </Card>

      <ReasonDialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision?.action === 'approve' ? cq.cancel.approveTitle : cq.cancel.rejectTitle}
        message={
          decision ? (
            <span>
              {cq.cancel.decisionConfirm(decision.row.driverName)} —{' '}
              {cq.cancel.permitValue(
                faDigits(decision.row.reservation.permitNo),
                faDigits(decision.row.reservation.announcementNumber),
              )}
            </span>
          ) : undefined
        }
        required={false}
        submitLabel={actionLabel}
        variant={decision?.action === 'approve' ? 'success' : 'danger'}
        loading={decide.isPending}
        onSubmit={({ reason }) => decision && decide.mutate({ ...decision, note: reason })}
      />
    </div>
  );
}
