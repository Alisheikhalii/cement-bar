'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Ban, CheckCircle2, Trash2 } from 'lucide-react';
import {
  CARRIER_STATUS_LABELS_FA,
  carrierUpdateSchema,
  faNumber,
  type CarrierDetailDto,
  type CarrierDto,
  type CarrierUpdateInput,
} from '@cb/shared';
import { Badge, Button3D, Card, Field, FormSection, Tabs, TextInput, button3DClasses } from '@cb/ui';
import { ErrorState, PageSkeleton } from '@/components/StateViews';
import { tableQueryKey } from '@/components/table/ServerTable';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import type { z } from 'zod';
import { ConfirmModal, FactoryPageHeader, useFactoryMutation } from './common';
import { CarrierQuotas } from './CarrierQuotas';
import { CarrierUsers } from './CarrierUsers';

export const carrierKey = (id: string) => ['factory', 'carrier', id] as const;

function ProfileForm({ carrier }: { carrier: CarrierDetailDto }) {
  const form = useForm<z.input<typeof carrierUpdateSchema>, unknown, CarrierUpdateInput>({
    resolver: zodResolver(carrierUpdateSchema, { error: faErrorMap }),
    defaultValues: {
      name: carrier.name,
      phone: carrier.phone ?? '',
      address: carrier.address ?? '',
      nationalId: carrier.nationalId ?? '',
    },
  });
  const m = useFactoryMutation((v: CarrierUpdateInput) => api.patch<CarrierDto>(`/factory/carriers/${carrier.id}`, v), {
    invalidate: [carrierKey(carrier.id), tableQueryKey('/factory/carriers')],
    success: t.common.saved,
  });
  const e = form.formState.errors;
  return (
    <Card>
      <form noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))} className="flex flex-col gap-space-md">
        <FormSection title={t.carriers.tabs.profile}>
          <Field label={t.carriers.code} htmlFor="p-code">
            <TextInput id="p-code" dir="ltr" value={carrier.code} disabled readOnly />
          </Field>
          <Field label={t.carriers.name} htmlFor="p-name" required error={e.name?.message}>
            <TextInput id="p-name" invalid={!!e.name} {...form.register('name')} />
          </Field>
          <Field label={t.carriers.phone} htmlFor="p-phone" error={e.phone?.message}>
            <TextInput id="p-phone" dir="ltr" {...form.register('phone')} />
          </Field>
          <Field label={t.carriers.nationalId} htmlFor="p-nid" error={e.nationalId?.message}>
            <TextInput id="p-nid" dir="ltr" {...form.register('nationalId')} />
          </Field>
          <Field label={t.carriers.address} htmlFor="p-address" error={e.address?.message} className="sm:col-span-2">
            <TextInput id="p-address" {...form.register('address')} />
          </Field>
        </FormSection>
        <div className="flex justify-end">
          <Button3D type="submit" loading={m.isPending}>
            {t.common.save}
          </Button3D>
        </div>
      </form>
    </Card>
  );
}

export function CarrierDetail({ id }: { id: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<'status' | 'delete' | null>(null);
  const q = useQuery({
    queryKey: carrierKey(id),
    queryFn: ({ signal }) => api.get<CarrierDetailDto>(`/factory/carriers/${id}`, { signal }),
  });
  const status = useFactoryMutation(
    (s: 'ACTIVE' | 'SUSPENDED') => api.patch<CarrierDto>(`/factory/carriers/${id}`, { status: s }),
    { invalidate: [carrierKey(id), tableQueryKey('/factory/carriers')], success: t.common.saved, onSuccess: () => setConfirm(null) },
  );
  const del = useFactoryMutation(() => api.del<void>(`/factory/carriers/${id}`), {
    invalidate: [tableQueryKey('/factory/carriers')],
    success: t.carriers.deleted,
    onSuccess: () => router.replace('/factory/carriers'),
  });

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const suspended = c.status === 'SUSPENDED';

  return (
    <div className="flex flex-col gap-space-md">
      <Link href="/factory/carriers" className={button3DClasses({ variant: 'ghost', size: 'sm', className: 'w-fit' })}>
        <ArrowRight className="size-4" aria-hidden />
        {t.common.back}
      </Link>
      <FactoryPageHeader
        title={c.name}
        description={`${t.carriers.code}: ${c.code} · ${t.carriers.driversCount(faNumber(c.driversCount))}`}
        actions={
          <>
            <Badge tone={suspended ? 'danger' : 'success'} className="self-center">
              {CARRIER_STATUS_LABELS_FA[c.status]}
            </Badge>
            <Button3D
              variant={suspended ? 'success' : 'warning'}
              icon={suspended ? <CheckCircle2 className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />}
              onClick={() => setConfirm('status')}
            >
              {suspended ? t.carriers.activate : t.carriers.suspend}
            </Button3D>
            <Button3D variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirm('delete')}>
              {t.carriers.delete}
            </Button3D>
          </>
        }
      />
      <Tabs
        aria-label={c.name}
        items={[
          { value: 'profile', label: t.carriers.tabs.profile, content: <ProfileForm carrier={c} /> },
          { value: 'users', label: t.carriers.tabs.users, content: <CarrierUsers carrierId={c.id} users={c.operators} /> },
          { value: 'quotas', label: t.carriers.tabs.quotas, content: <CarrierQuotas carrierId={c.id} /> },
        ]}
      />
      <ConfirmModal
        open={confirm === 'status'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={suspended ? t.carriers.activate : t.carriers.suspend}
        message={suspended ? undefined : t.carriers.suspendConfirm}
        variant={suspended ? 'success' : 'warning'}
        loading={status.isPending}
        onConfirm={() => status.mutate(suspended ? 'ACTIVE' : 'SUSPENDED')}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t.carriers.delete}
        message={t.carriers.deleteConfirm}
        variant="danger"
        loading={del.isPending}
        onConfirm={() => del.mutate(undefined)}
      />
    </div>
  );
}
