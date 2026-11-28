'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, RotateCcw } from 'lucide-react';
import { Alert, Badge, Button3D, Card, Field, Select, Skeleton, Textarea, useToast } from '@cb/ui';
import { faDigits, type CarrierBulkGroupDto, type CarrierBulkSettingsDto } from '@cb/shared';
import { cq } from '@/i18n/carrier-queue';
import { api, errorMessage } from '@/lib/api';
import { ErrorState } from '@/components/StateViews';
import { DAILY_CAP_MAX, DAILY_CAP_MIN, LIVE_KEY, SETTINGS_KEY } from './helpers';

const CAPS = Array.from({ length: DAILY_CAP_MAX - DAILY_CAP_MIN + 1 }, (_, i) => i + DAILY_CAP_MIN);

/** US-B6: carrier bulk rotation settings — daily cap, hall-end leftover policy and the start-head group. */
export function BulkSettingsCard({ groups }: { groups: readonly CarrierBulkGroupDto[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: ({ signal }) => api.get<CarrierBulkSettingsDto>('/carrier/bulk/settings', { signal }),
  });

  const [cap, setCap] = useState(String(DAILY_CAP_MIN));
  const [leftover, setLeftover] = useState<'CARRY' | 'FREE'>('CARRY');
  const [headGroupId, setHeadGroupId] = useState('');
  const [headReason, setHeadReason] = useState('');

  useEffect(() => {
    if (!q.data) return;
    setCap(String(q.data.maxLoadsPerDriverPerDay));
    setLeftover(q.data.leftoverAtHallEnd);
    setHeadGroupId(q.data.startHeadGroupId ?? '');
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<CarrierBulkSettingsDto>('/carrier/bulk/settings', {
        maxLoadsPerDriverPerDay: Number(cap),
        leftoverAtHallEnd: leftover,
      }),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.settings.saved });
      await Promise.all([
        qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
        qc.invalidateQueries({ queryKey: LIVE_KEY }),
      ]);
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const startHead = useMutation({
    mutationFn: () =>
      api.post<CarrierBulkSettingsDto>('/carrier/bulk/start-head', {
        headGroupId,
        ...(headReason.trim() ? { reason: headReason.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.settings.startHeadDone });
      setHeadReason('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
        qc.invalidateQueries({ queryKey: LIVE_KEY }),
      ]);
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  if (q.isPending) {
    return (
      <Card>
        <div className="flex flex-col gap-space-sm" role="status" aria-label={cq.common.loading}>
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      </Card>
    );
  }
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data;

  return (
    <Card className="flex flex-col gap-space-lg">
      <div>
        <h2 className="text-headline-md text-text-primary">{cq.settings.title}</h2>
        <div className="mt-space-xs flex flex-wrap gap-space-xs">
          <Badge tone="info" icon={<Clock className="size-3.5" aria-hidden />}>
            {cq.common.headMinutes(faDigits(s.headMinutes))}
          </Badge>
          <Badge tone="info" icon={<Clock className="size-3.5" aria-hidden />}>
            {cq.common.freeMinutes(faDigits(s.freeMinutes))}
          </Badge>
        </div>
        <p className="mt-1 text-caption text-text-muted">{cq.settings.readOnlyHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
        <Field label={cq.settings.dailyCap} htmlFor="bulk-cap" hint={cq.settings.dailyCapHint}>
          <Select
            id="bulk-cap"
            value={cap}
            onValueChange={setCap}
            options={CAPS.map((n) => ({ value: String(n), label: faDigits(n) }))}
          />
        </Field>
        <Field label={cq.settings.leftover} htmlFor="bulk-leftover">
          <Select
            id="bulk-leftover"
            value={leftover}
            onValueChange={(v) => setLeftover(v === 'FREE' ? 'FREE' : 'CARRY')}
            options={[
              { value: 'CARRY', label: cq.settings.leftoverCARRY },
              { value: 'FREE', label: cq.settings.leftoverFREE },
            ]}
          />
        </Field>
      </div>
      <div>
        <Button3D variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {cq.settings.save}
        </Button3D>
      </div>

      <div className="flex flex-col gap-space-md border-t border-border-subtle pt-space-md">
        <div>
          <h3 className="text-headline-sm text-text-primary">{cq.settings.startHead}</h3>
          <p className="text-body-sm text-text-secondary">{cq.settings.startHeadHint}</p>
        </div>
        {groups.length === 0 ? (
          <Alert tone="warning">{cq.groups.emptyDesc}</Alert>
        ) : (
          <>
            <Field label={cq.settings.startHead} htmlFor="bulk-head">
              <Select
                id="bulk-head"
                value={headGroupId}
                onValueChange={setHeadGroupId}
                placeholder={cq.settings.chooseGroup}
                options={groups.map((g) => ({ value: g.id, label: g.title }))}
              />
            </Field>
            <Field label={cq.settings.startHeadReason} htmlFor="bulk-head-reason">
              <Textarea
                id="bulk-head-reason"
                rows={2}
                value={headReason}
                maxLength={500}
                onChange={(e) => setHeadReason(e.target.value)}
              />
            </Field>
            <div>
              <Button3D
                variant="neutral"
                icon={<RotateCcw className="size-4" aria-hidden />}
                loading={startHead.isPending}
                disabled={!headGroupId}
                onClick={() => startHead.mutate()}
              >
                {cq.settings.applyStartHead}
              </Button3D>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
