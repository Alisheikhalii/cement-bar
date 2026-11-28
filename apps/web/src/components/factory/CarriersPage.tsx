'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import {
  FACTORY_CARRIER_COLUMNS,
  carrierCreateSchema,
  type CarrierCreateInput,
  type CarrierDto,
  type TableRow,
} from '@cb/shared';
import { Button3D, Field, FormSection, Modal, TextInput, button3DClasses, fieldDescribedBy } from '@cb/ui';
import { ServerTable, tableQueryKey } from '@/components/table/ServerTable';
import { faFactory as t } from '@/i18n/factory';
import { api } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import type { z } from 'zod';
import { FactoryPageHeader, useFactoryMutation } from './common';

const ENDPOINT = '/factory/carriers';

function CarrierCreateModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<z.input<typeof carrierCreateSchema>, unknown, CarrierCreateInput>({
    resolver: zodResolver(carrierCreateSchema, { error: faErrorMap }),
    defaultValues: { code: '', name: '' },
  });
  const m = useFactoryMutation((v: CarrierCreateInput) => api.post<CarrierDto>(ENDPOINT, v), {
    invalidate: [tableQueryKey(ENDPOINT), ['factory']],
    success: t.common.created,
    onSuccess: () => {
      form.reset();
      onOpenChange(false);
    },
  });
  const e = form.formState.errors;
  const field = (name: keyof z.input<typeof carrierCreateSchema>, label: string, opts: { required?: boolean; ltr?: boolean } = {}) => (
    <Field label={label} htmlFor={`c-${name}`} required={opts.required} error={e[name]?.message}>
      <TextInput
        id={`c-${name}`}
        dir={opts.ltr ? 'ltr' : undefined}
        invalid={!!e[name]}
        aria-describedby={fieldDescribedBy(`c-${name}`, e[name]?.message)}
        {...form.register(name)}
      />
    </Field>
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t.carriers.add}
      footer={
        <>
          <Button3D variant="neutral" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button3D>
          <Button3D type="submit" form="carrier-create" loading={m.isPending}>
            {t.common.create}
          </Button3D>
        </>
      }
    >
      <form id="carrier-create" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <FormSection title={t.carriers.tabs.profile}>
          {field('code', t.carriers.code, { required: true, ltr: true })}
          {field('name', t.carriers.name, { required: true })}
          {field('phone', t.carriers.phone, { ltr: true })}
          {field('nationalId', t.carriers.nationalId, { ltr: true })}
          {field('address', t.carriers.address)}
        </FormSection>
      </form>
    </Modal>
  );
}

export function CarriersPage() {
  const [open, setOpen] = useState(false);
  const actions = useMemo<ColumnDef<TableRow, unknown>[]>(
    () => [
      {
        id: 'actions',
        header: t.common.actions,
        enableSorting: false,
        enableHiding: false,
        meta: { label: t.common.actions },
        cell: ({ row }) => (
          <Link href={`/factory/carriers/${row.original.id}`} className={button3DClasses({ variant: 'neutral', size: 'sm' })}>
            {t.carriers.detail}
          </Link>
        ),
      },
    ],
    [],
  );
  return (
    <div>
      <FactoryPageHeader
        title={t.carriers.title}
        description={t.carriers.description}
        actions={
          <Button3D icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            {t.carriers.add}
          </Button3D>
        }
      />
      <ServerTable
        endpoint={ENDPOINT}
        columns={FACTORY_CARRIER_COLUMNS}
        storageKey="factory-carriers"
        extraColumns={actions}
        caption={t.carriers.title}
        rowTone={(r) => (r.status === 'SUSPENDED' ? 'danger' : 'success')}
      />
      <CarrierCreateModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
