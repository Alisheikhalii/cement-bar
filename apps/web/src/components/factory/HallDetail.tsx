'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Pencil } from 'lucide-react';
import { ALLOCATION_LABELS_FA, HALL_CATEGORY_LABELS_FA, type HallDto } from '@cb/shared';
import { Badge, Button3D, Tabs, button3DClasses } from '@cb/ui';
import { ErrorState, PageSkeleton } from '@/components/StateViews';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { FactoryPageHeader } from './common';
import { HallDays } from './HallDays';
import { HallFormModal } from './HallsPage';
import { HallSchedule } from './HallSchedule';

export function HallDetail({ id }: { id: string }) {
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ['factory', 'hall', id],
    queryFn: ({ signal }) => api.get<HallDto>(`/factory/halls/${id}`, { signal }),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const h = q.data;
  return (
    <div className="flex flex-col gap-space-md">
      <Link href="/factory/halls" className={button3DClasses({ variant: 'ghost', size: 'sm', className: 'w-fit' })}>
        <ArrowRight className="size-4" aria-hidden />
        {t.common.back}
      </Link>
      <FactoryPageHeader
        title={h.title}
        description={`${HALL_CATEGORY_LABELS_FA[h.category]} · ${ALLOCATION_LABELS_FA[h.defaultAllocation]}`}
        actions={
          <>
            <Badge tone={h.active ? 'success' : 'neutral'} className="self-center">
              {h.active ? t.common.active : t.common.inactive}
            </Badge>
            <Button3D variant="neutral" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
              {t.common.edit}
            </Button3D>
          </>
        }
      />
      <Tabs
        aria-label={h.title}
        items={[
          { value: 'days', label: t.halls.days, content: <HallDays hall={h} /> },
          // key forces a fresh editor state after the hall reloads
          { value: 'schedule', label: t.halls.schedule, content: <HallSchedule key={JSON.stringify(h.schedules)} hall={h} /> },
        ]}
      />
      {editing ? <HallFormModal open onOpenChange={setEditing} hall={h} /> : null}
    </div>
  );
}
