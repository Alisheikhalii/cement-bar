'use client';
import { useState } from 'react';
import { Ticket } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button3D, Card, EmptyState, Field, Modal, Skeleton, Tabs, Textarea, useToast } from '@cb/ui';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { fa } from '@/i18n/fa';
import { faDriverQueue } from '@/i18n/driver-queue';
import { ApiError, errorMessage } from '@/lib/api';
import { PermitCard } from './PermitCard';
import { queueKeys, useMyReservations, useRequestCancel, type ReservationView } from './queries';

const r = faDriverQueue.reservations;
const c = faDriverQueue.common;

function ReservationList({
  view,
  emptyTitle,
  emptyBody,
  onCancelRequest,
}: {
  view: ReservationView;
  emptyTitle: string;
  emptyBody: string;
  onCancelRequest: (reservation: { id: string }) => void;
}) {
  const q = useMyReservations(view);

  if (q.isPending) {
    return (
      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2" role="status" aria-label={c.loadingList}>
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-52 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <Card>
        <EmptyState title={emptyTitle} description={emptyBody} icon={<Ticket className="size-7" />} />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
      {q.data.map((reservation) => (
        <PermitCard key={reservation.id} reservation={reservation} onCancelRequest={onCancelRequest} />
      ))}
    </div>
  );
}

export function ReservationsView() {
  const cancel = useRequestCancel();
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<{ id: string } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setTarget(null);
    setReason('');
    setError(null);
  };

  const submit = () => {
    if (!target) return;
    const value = reason.trim();
    if (value.length < 3) {
      setError(r.reasonError);
      return;
    }
    cancel.mutate(
      { id: target.id, reason: value },
      {
        onSuccess: () => {
          toast.toast({ tone: 'success', title: r.cancelSent });
          close();
        },
        onError: (e) => {
          if (e instanceof ApiError && (e.code === 'CANCEL_PENDING' || e.code === 'INVALID_STATE')) {
            toast.toast({ tone: 'warning', title: errorMessage(e) });
            void qc.invalidateQueries({ queryKey: queueKeys.reservationsRoot });
            close();
            return;
          }
          toast.toast({ tone: 'danger', title: fa.common.errorTitle, description: errorMessage(e) });
        },
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <PageHeader title={fa.nav.driver.reservations} description={r.description} />

      <Tabs
        fullWidth
        aria-label={r.description}
        items={[
          {
            value: 'active',
            label: r.tabs.active,
            content: (
              <ReservationList
                view="active"
                emptyTitle={r.activeEmpty}
                emptyBody={r.activeEmptyBody}
                onCancelRequest={(res) => setTarget({ id: res.id })}
              />
            ),
          },
          {
            value: 'history',
            label: r.tabs.history,
            content: (
              <ReservationList
                view="history"
                emptyTitle={r.historyEmpty}
                emptyBody={r.activeEmptyBody}
                onCancelRequest={(res) => setTarget({ id: res.id })}
              />
            ),
          },
        ]}
      />

      <Modal
        open={!!target}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={r.cancelTitle}
        subtitle={r.cancelSubtitle}
        icon={<Ticket className="size-5" />}
        footer={
          <>
            <Button3D variant="neutral" onClick={close}>
              {c.cancel}
            </Button3D>
            <Button3D variant="danger" loading={cancel.isPending} onClick={submit}>
              {r.submitCancel}
            </Button3D>
          </>
        }
      >
        <div className="flex flex-col gap-space-md">
          <Field label={r.reason} htmlFor="cancel-reason" required error={error ?? undefined}>
            <Textarea
              id="cancel-reason"
              value={reason}
              invalid={!!error}
              rows={4}
              maxLength={500}
              placeholder={r.reasonPlaceholder}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
            />
          </Field>
          <p className="text-caption text-text-muted">{r.penaltyHint}</p>
        </div>
      </Modal>
    </div>
  );
}
