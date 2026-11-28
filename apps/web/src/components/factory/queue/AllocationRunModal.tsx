'use client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Modal, Skeleton } from '@cb/ui';
import { faDigits, formatDateTimeFa, type FactoryAllocationRunDto } from '@cb/shared';
import { fq } from '@/i18n/factory-queue';
import { api, errorMessage } from '@/lib/api';

const json = (v: unknown): string => JSON.stringify(v ?? null, null, 2) ?? 'null';

/** US-F8: allocation run input/output JSON, rendered as plain text (React escapes it; never innerHTML). */
export function AllocationRunModal({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['factory', 'monitor', 'allocation-run', runId],
    queryFn: ({ signal }) => api.get<FactoryAllocationRunDto>(`/factory/monitor/allocation-runs/${runId}`, { signal }),
    enabled: !!runId,
  });
  const d = q.data;

  return (
    <Modal
      open={!!runId}
      onOpenChange={(o) => !o && onClose()}
      title={fq.monitor.runTitle}
      subtitle={d ? fq.monitor.runSubtitle(faDigits(d.engineVersion)) : undefined}
      size="xl"
    >
      {q.isPending ? (
        <div className="flex flex-col gap-space-sm" role="status" aria-label={fq.common.loading}>
          <Skeleton className="h-11" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : q.isError ? (
        <Alert tone="danger">{errorMessage(q.error)}</Alert>
      ) : d ? (
        <div className="flex flex-col gap-space-lg">
          <div className="flex flex-wrap gap-space-xs">
            <Badge tone="info">
              {fq.monitor.startedAt}: {formatDateTimeFa(d.startedAt)}
            </Badge>
            <Badge tone="info">
              {fq.monitor.finishedAt}: {formatDateTimeFa(d.finishedAt)}
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-space-xs sm:grid-cols-2">
            <div className="min-w-0 rounded-xl bg-surface-container-low px-space-sm py-space-xs">
              <p className="text-caption text-text-muted">{fq.monitor.inputHash}</p>
              <p dir="ltr" className="truncate font-mono text-label-sm text-text-primary">
                {d.inputHash}
              </p>
            </div>
            <div className="min-w-0 rounded-xl bg-surface-container-low px-space-sm py-space-xs">
              <p className="text-caption text-text-muted">{fq.monitor.outputHash}</p>
              <p dir="ltr" className="truncate font-mono text-label-sm text-text-primary">
                {d.outputHash}
              </p>
            </div>
          </div>
          {(['input', 'output'] as const).map((key) => (
            <section key={key} className="flex flex-col gap-space-xs">
              <h3 className="text-headline-sm text-text-primary">
                {key === 'input' ? fq.monitor.input : fq.monitor.output}
              </h3>
              <pre
                dir="ltr"
                className="max-h-64 overflow-auto rounded-xl bg-surface-container-low p-space-sm text-label-sm leading-5 text-text-body"
              >
                {json(d[key])}
              </pre>
            </section>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
