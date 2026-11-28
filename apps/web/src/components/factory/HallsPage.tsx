'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Warehouse } from 'lucide-react';
import {
  ALLOCATION_LABELS_FA,
  ALLOCATIONS,
  HALL_CATEGORIES,
  HALL_CATEGORY_LABELS_FA,
  faDigits,
  hallCreateSchema,
  type HallDto,
} from '@cb/shared';
import { Badge, Button3D, Card, EmptyState, Field, FormSection, Modal, Select, Skeleton, Switch, TextInput, button3DClasses } from '@cb/ui';
import { ErrorState } from '@/components/StateViews';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import type { z } from 'zod';
import { FactoryPageHeader, useFactoryMutation } from './common';

export const HALLS_KEY = ['factory', 'halls'] as const;
type HallForm = z.input<typeof hallCreateSchema>;

const categoryOptions = HALL_CATEGORIES.map((c) => ({ value: c, label: HALL_CATEGORY_LABELS_FA[c] }));
const allocationOptions = ALLOCATIONS.map((a) => ({ value: a, label: ALLOCATION_LABELS_FA[a] }));

export function useHalls() {
  return useQuery({ queryKey: HALLS_KEY, queryFn: ({ signal }) => api.get<HallDto[]>('/factory/halls', { signal }) });
}

/** Create (hall = undefined) or edit a hall. */
export function HallFormModal({ open, onOpenChange, hall }: { open: boolean; onOpenChange: (o: boolean) => void; hall?: HallDto }) {
  const form = useForm<HallForm>({
    resolver: zodResolver(hallCreateSchema, { error: faErrorMap }),
    defaultValues: hall
      ? {
          title: hall.title,
          category: hall.category,
          defaultAllocation: hall.defaultAllocation,
          terminalName: hall.terminalName ?? '',
          terminalCity: hall.terminalCity ?? '',
          active: hall.active,
        }
      : { title: '', category: 'BAG', defaultAllocation: 'TIMED', active: true },
  });
  const m = useFactoryMutation(
    (v: HallForm) => (hall ? api.patch<HallDto>(`/factory/halls/${hall.id}`, v) : api.post<HallDto>('/factory/halls', v)),
    {
      invalidate: [HALLS_KEY, ['factory', 'hall'], ['factory', 'dashboard']],
      success: hall ? t.common.saved : t.common.created,
      onSuccess: () => {
        if (!hall) form.reset();
        onOpenChange(false);
      },
    },
  );
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={hall ? t.common.edit : t.halls.add}
      footer={
        <>
          <Button3D variant="neutral" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button3D>
          <Button3D type="submit" form="hall-form" loading={m.isPending}>
            {t.common.save}
          </Button3D>
        </>
      }
    >
      <form id="hall-form" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <FormSection title={t.halls.title}>
          <Field label={t.halls.hallTitle} htmlFor="h-title" required error={e.title?.message}>
            <TextInput id="h-title" invalid={!!e.title} {...form.register('title')} />
          </Field>
          <Field label={t.halls.category} htmlFor="h-category" required error={e.category?.message}>
            <Controller
              control={form.control}
              name="category"
              render={({ field }) => <Select id="h-category" value={field.value} onValueChange={field.onChange} options={categoryOptions} />}
            />
          </Field>
          <Field label={t.halls.allocation} htmlFor="h-alloc" required error={e.defaultAllocation?.message}>
            <Controller
              control={form.control}
              name="defaultAllocation"
              render={({ field }) => <Select id="h-alloc" value={field.value} onValueChange={field.onChange} options={allocationOptions} />}
            />
          </Field>
          <Field label={t.halls.terminalName} htmlFor="h-tname" error={e.terminalName?.message}>
            <TextInput id="h-tname" {...form.register('terminalName')} />
          </Field>
          <Field label={t.halls.terminalCity} htmlFor="h-tcity" error={e.terminalCity?.message}>
            <TextInput id="h-tcity" {...form.register('terminalCity')} />
          </Field>
          <Controller
            control={form.control}
            name="active"
            render={({ field }) => <Switch id="h-active" checked={field.value ?? true} onCheckedChange={field.onChange} label={t.common.active} />}
          />
        </FormSection>
      </form>
    </Modal>
  );
}

export function HallsPage() {
  const [open, setOpen] = useState(false);
  const q = useHalls();
  return (
    <div>
      <FactoryPageHeader
        title={t.halls.title}
        description={t.halls.description}
        actions={
          <Button3D icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            {t.halls.add}
          </Button3D>
        }
      />
      {q.isPending ? (
        <div className="grid grid-cols-1 gap-space-md md:grid-cols-2">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Warehouse className="size-7" />} title={t.dashboard.noHalls} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-space-md md:grid-cols-2">
          {q.data.map((h) => (
            <Card key={h.id} className="flex flex-col gap-space-sm">
              <div className="flex flex-wrap items-start justify-between gap-space-sm">
                <div className="min-w-0">
                  <h2 className="text-headline-md text-text-primary">{h.title}</h2>
                  <p className="text-body-sm text-text-secondary">
                    {HALL_CATEGORY_LABELS_FA[h.category]} · {ALLOCATION_LABELS_FA[h.defaultAllocation]}
                  </p>
                </div>
                <Badge tone={h.active ? 'success' : 'neutral'}>{h.active ? t.common.active : t.common.inactive}</Badge>
              </div>
              <p className="text-body-sm text-text-secondary">
                {h.schedules.filter((s) => s.active).length === 0
                  ? t.halls.noSchedule
                  : h.schedules
                      .filter((s) => s.active)
                      .map((s) => `${t.halls.weekdays[s.weekday]} ${faDigits(s.t0)}–${faDigits(s.hallEnd)}`)
                      .join('، ')}
              </p>
              <Link href={`/factory/halls/${h.id}`} className={button3DClasses({ variant: 'neutral', size: 'sm', className: 'w-fit' })}>
                {t.halls.manage}
              </Link>
            </Card>
          ))}
        </div>
      )}
      <HallFormModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
