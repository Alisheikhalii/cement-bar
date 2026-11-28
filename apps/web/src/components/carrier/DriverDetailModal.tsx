'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, UserRound, X } from 'lucide-react';
import { Alert, Badge, Button3D, FormSection, Modal, Skeleton, useToast } from '@cb/ui';
import {
  DRIVER_STATUS_LABELS_FA,
  VEHICLE_STATUS_LABELS_FA,
  faDigits,
  formatDateTimeFa,
  isoDateToJalali,
  type CarrierDriverDetailDto,
} from '@cb/shared';
import { faCarrier } from '@/i18n/carrier';
import { api, errorMessage } from '@/lib/api';
import { ErrorState } from '@/components/StateViews';
import { tableQueryKey } from '@/components/table/ServerTable';
import { InfoItem, ReasonModal } from './shared';

const t = faCarrier.drivers;
const f = t.fields;
type Dialog = null | 'reject' | 'block' | 'rejectChange';

const day = (v: string | null | undefined) => (v ? isoDateToJalali(v) : null);
const digits = (v: string | null | undefined) => (v ? faDigits(v) : null);

export function DriverDetailModal({ driverId, onClose }: { driverId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const key = ['carrier', 'driver', driverId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<CarrierDriverDetailDto>(`/carrier/drivers/${driverId}`, { signal }),
    enabled: !!driverId,
  });

  const act = useMutation({
    mutationFn: (v: { path: string; body: object; done: string }) => api.post(`/carrier/drivers/${driverId}/${v.path}`, v.body),
    onSuccess: async (_r, v) => {
      toast.toast({ tone: 'success', title: v.done });
      setDialog(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: tableQueryKey('/carrier/drivers') }),
        qc.invalidateQueries({ queryKey: ['carrier', 'dashboard'] }),
      ]);
    },
    onError: (e) => toast.toast({ tone: 'danger', title: faCarrier.common.failed, description: errorMessage(e) }),
  });

  const d = q.data;
  const v = d?.vehicle;
  const pending = v?.pendingChange;

  return (
    <>
      <Modal
        open={!!driverId}
        onOpenChange={(o) => !o && onClose()}
        title={t.detailTitle}
        subtitle={d ? `${d.firstName} ${d.lastName}` : undefined}
        icon={<UserRound className="size-5" />}
        size="lg"
        footer={
          d?.status === 'PENDING' ? (
            <div className="flex flex-col gap-space-sm sm:flex-row">
              <Button3D
                fullWidth
                variant="success"
                icon={<Check className="size-4" aria-hidden />}
                loading={act.isPending}
                onClick={() => act.mutate({ path: 'decision', body: { decision: 'APPROVE' }, done: t.approved })}
              >
                {t.approve}
              </Button3D>
              <Button3D fullWidth variant="danger" icon={<X className="size-4" aria-hidden />} onClick={() => setDialog('reject')}>
                {t.reject}
              </Button3D>
            </div>
          ) : d?.status === 'APPROVED' ? (
            <Button3D fullWidth variant="danger" icon={<Ban className="size-4" aria-hidden />} onClick={() => setDialog('block')}>
              {t.block}
            </Button3D>
          ) : undefined
        }
      >
        {q.isPending ? (
          <div className="flex flex-col gap-space-sm" role="status" aria-label={faCarrier.common.loadingLabel}>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32" />
          </div>
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : d ? (
          <div className="flex flex-col gap-space-lg">
            <FormSection title={t.personal}>
              <dl className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
                <InfoItem label={f.status} value={<Badge tone={d.status === 'APPROVED' ? 'success' : d.status === 'PENDING' ? 'warning' : 'danger'}>{DRIVER_STATUS_LABELS_FA[d.status]}</Badge>} />
                <InfoItem label={f.name} value={`${d.firstName} ${d.lastName}`} />
                <InfoItem label={f.mobile} value={digits(d.mobile)} />
                <InfoItem label={f.nationalId} value={digits(d.nationalId)} />
                <InfoItem label={f.licenseNo} value={digits(d.licenseNo)} />
                <InfoItem label={f.licenseIssueDate} value={day(d.licenseIssueDate)} />
                <InfoItem label={f.birthCity} value={d.birthCity} />
                <InfoItem label={f.healthCardExpiry} value={day(d.healthCardExpiry)} />
                {d.decisionNote ? <InfoItem label={f.decisionNote} value={d.decisionNote} /> : null}
                {d.blockReason ? <InfoItem label={f.blockReason} value={d.blockReason} /> : null}
                {d.blockedUntil ? <InfoItem label={f.blockedUntil} value={formatDateTimeFa(d.blockedUntil)} /> : null}
              </dl>
            </FormSection>
            <FormSection title={t.vehicle} tone="info">
              {v ? (
                <dl className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
                  <InfoItem label={f.plate} value={digits(v.plate)} />
                  <InfoItem label={f.smartCardNo} value={digits(v.smartCardNo)} />
                  <InfoItem label={f.loaderType} value={v.loaderType} />
                  <InfoItem label={f.status} value={VEHICLE_STATUS_LABELS_FA[v.status]} />
                  <InfoItem label={f.smartCardExpiry} value={day(v.smartCardExpiry)} />
                  <InfoItem label={f.inspectionExpiry} value={day(v.inspectionExpiry)} />
                </dl>
              ) : (
                <p className="text-body-md text-text-secondary">{t.noVehicle}</p>
              )}
            </FormSection>
            {pending ? (
              <Alert tone="warning" title={t.pendingChange}>
                <dl className="mt-space-sm grid grid-cols-1 gap-space-sm sm:grid-cols-2">
                  {pending.plate ? <InfoItem label={f.plate} value={faDigits(pending.plate)} /> : null}
                  {pending.loaderTypeId ? <InfoItem label={f.loaderType} value={pending.loaderType ?? '—'} /> : null}
                  {pending.smartCardNo ? <InfoItem label={f.smartCardNo} value={faDigits(pending.smartCardNo)} /> : null}
                  <InfoItem label={f.requestedAt} value={formatDateTimeFa(pending.requestedAt)} />
                </dl>
                <div className="mt-space-md flex flex-col gap-space-sm sm:flex-row">
                  <Button3D
                    size="sm"
                    variant="success"
                    loading={act.isPending}
                    onClick={() => act.mutate({ path: 'vehicle-change', body: { decision: 'APPROVE' }, done: t.changeApproved })}
                  >
                    {t.approveChange}
                  </Button3D>
                  <Button3D size="sm" variant="danger" onClick={() => setDialog('rejectChange')}>
                    {t.rejectChange}
                  </Button3D>
                </div>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ReasonModal
        open={dialog === 'reject' || dialog === 'rejectChange'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'rejectChange' ? t.rejectChangeTitle : t.rejectTitle}
        required
        tone="danger"
        submitLabel={faCarrier.common.confirm}
        loading={act.isPending}
        onSubmit={({ text }) =>
          act.mutate(
            dialog === 'rejectChange'
              ? { path: 'vehicle-change', body: { decision: 'REJECT', note: text }, done: t.changeRejected }
              : { path: 'decision', body: { decision: 'REJECT', note: text }, done: t.rejected },
          )
        }
      />
      <ReasonModal
        open={dialog === 'block'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t.blockTitle}
        required
        tone="danger"
        submitLabel={t.block}
        loading={act.isPending}
        withDate={{ label: t.blockUntil, hint: t.blockUntilHint }}
        onSubmit={({ text, date }) => act.mutate({ path: 'block', body: date ? { reason: text, until: date } : { reason: text }, done: t.blocked })}
      />
    </>
  );
}
