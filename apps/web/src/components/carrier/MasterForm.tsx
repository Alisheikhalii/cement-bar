'use client';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm, type FieldValues, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button3D,
  Combobox,
  Field,
  FormSection,
  IconButton3D,
  Modal,
  Skeleton,
  TextInput,
  Textarea,
  useToast,
  type ComboOption,
} from '@cb/ui';
import { enDigits, type CarrierMasterKind, type CarrierMasterRecordDto } from '@cb/shared';
import { faCarrier } from '@/i18n/carrier';
import { api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import { useCitySearch } from '@/components/auth/register-data';
import { ErrorState } from '@/components/StateViews';
import { tableQueryKey } from '@/components/table/ServerTable';
import { MASTER_FORMS, cleanValues, type FieldDef } from './master-fields';

const m = faCarrier.master;

function CityField({ id, value, initialLabel, onChange, error }: {
  id: string;
  value: unknown;
  initialLabel?: string;
  onChange: (v: number | undefined) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ComboOption | null>(
    typeof value === 'number' && initialLabel ? { value: String(value), label: initialLabel } : null,
  );
  const search = useCitySearch(query);
  const options = (search.data ?? []).map((c) => ({ value: String(c.id), label: c.name, hint: c.province }));
  return (
    <Combobox
      id={id}
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        if (!q) {
          setSelected(null);
          onChange(undefined);
        }
      }}
      options={options}
      selected={selected}
      onSelect={(o) => {
        setSelected(o);
        onChange(Number(o.value));
      }}
      loading={search.isFetching}
      placeholder={m.citySearch}
      emptyText={search.tooShort ? m.cityMinChars : m.cityNoResult}
      invalid={!!error}
    />
  );
}

export interface MasterFormProps {
  kind: CarrierMasterKind;
  kindLabel: string;
  /** null = closed, 'new' = create, otherwise the id to edit. */
  editId: string | null;
  /** Display label of the current city (edit mode). */
  cityLabel?: string;
  onClose: () => void;
}

export function MasterForm({ kind, kindLabel, editId, cityLabel, onClose }: MasterFormProps) {
  const def = MASTER_FORMS[kind];
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = !!editId && editId !== 'new';
  const record = useQuery({
    queryKey: ['carrier', 'master', kind, editId],
    queryFn: ({ signal }) => api.get<CarrierMasterRecordDto>(`/carrier/master/${kind}/${editId}`, { signal }),
    enabled: isEdit,
  });

  const base = zodResolver(def.schema as never, { error: faErrorMap }) as unknown as Resolver<FieldValues>;
  const form = useForm<FieldValues>({
    defaultValues: def.empty,
    resolver: (values, ctx, opts) => base(cleanValues(values), ctx, opts),
  });
  const addresses = useFieldArray({ control: form.control, name: 'addresses' });

  useEffect(() => {
    if (!editId) return;
    if (!isEdit) form.reset(def.empty);
    else if (record.data) {
      const values: Record<string, unknown> = { ...def.empty };
      for (const k of Object.keys(def.empty)) if (record.data[k] !== null && record.data[k] !== undefined) values[k] = record.data[k];
      if (record.data.cityId !== null && record.data.cityId !== undefined) values.cityId = record.data.cityId;
      form.reset(values);
    }
  }, [editId, isEdit, record.data, def.empty, form]);

  const save = useMutation({
    mutationFn: (body: FieldValues) =>
      isEdit ? api.put(`/carrier/master/${kind}/${editId}`, body) : api.post(`/carrier/master/${kind}`, body),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: faCarrier.common.saved });
      await qc.invalidateQueries({ queryKey: tableQueryKey(`/carrier/master/${kind}`) });
      onClose();
    },
    onError: (e) => toast.toast({ tone: 'danger', title: faCarrier.common.failed, description: errorMessage(e) }),
  });

  const err = (name: string): string | undefined => {
    const e = form.getFieldState(name, form.formState).error;
    return e?.message;
  };

  const renderField = (fd: FieldDef) => {
    const id = `m-${kind}-${fd.name}`;
    const e = err(fd.name);
    let control;
    if (fd.type === 'city') {
      control = (
        <Controller
          control={form.control}
          name={fd.name}
          render={({ field }) => <CityField id={id} value={field.value} initialLabel={cityLabel} onChange={field.onChange} error={e} />}
        />
      );
    } else if (fd.type === 'textarea') {
      control = <Textarea id={id} invalid={!!e} {...form.register(fd.name)} />;
    } else {
      control = (
        <TextInput
          id={id}
          invalid={!!e}
          dir={fd.ltr ? 'ltr' : undefined}
          className={fd.ltr ? 'text-end' : undefined}
          inputMode={fd.type === 'digits' ? 'numeric' : undefined}
          {...form.register(fd.name, fd.type === 'digits' ? { setValueAs: (v: unknown) => enDigits(String(v ?? '')) } : undefined)}
        />
      );
    }
    return (
      <Field key={fd.name} label={fd.label} htmlFor={id} required={fd.required} error={e}>
        {control}
      </Field>
    );
  };

  return (
    <Modal
      open={!!editId}
      onOpenChange={(o) => !o && onClose()}
      title={isEdit ? m.editTitle(kindLabel) : m.addTitle(kindLabel)}
      size="md"
      footer={
        <Button3D fullWidth loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(cleanValues(v)))}>
          {faCarrier.common.save}
        </Button3D>
      }
    >
      {isEdit && record.isPending ? (
        <Skeleton className="h-40" />
      ) : isEdit && record.isError ? (
        <ErrorState message={errorMessage(record.error)} onRetry={() => void record.refetch()} />
      ) : (
        <form
          className="flex flex-col gap-space-lg"
          noValidate
          onSubmit={form.handleSubmit((v) => save.mutate(cleanValues(v)))}
        >
          <FormSection title={kindLabel}>
            <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">{def.fields.map(renderField)}</div>
          </FormSection>
          {def.addresses ? (
            <FormSection title={m.fields.addresses} tone="info">
              <div className="flex flex-col gap-space-md">
                {addresses.fields.map((a, i) => (
                  <div key={a.id} className="grid grid-cols-1 gap-space-sm rounded-xl border border-border-subtle p-space-sm sm:grid-cols-[1fr_1fr_auto]">
                    <Field label={m.fields.addressTitle} htmlFor={`addr-t-${i}`}>
                      <TextInput id={`addr-t-${i}`} {...form.register(`addresses.${i}.title`)} />
                    </Field>
                    <Field label={m.fields.postalCode} htmlFor={`addr-p-${i}`} error={err(`addresses.${i}.postalCode`)}>
                      <TextInput id={`addr-p-${i}`} dir="ltr" className="text-end" inputMode="numeric" {...form.register(`addresses.${i}.postalCode`)} />
                    </Field>
                    <div className="flex items-end">
                      <IconButton3D label={m.fields.removeAddress} variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => addresses.remove(i)} />
                    </div>
                    <Field className="sm:col-span-3" label={m.fields.address} htmlFor={`addr-a-${i}`} required error={err(`addresses.${i}.address`)}>
                      <TextInput id={`addr-a-${i}`} {...form.register(`addresses.${i}.address`)} />
                    </Field>
                  </div>
                ))}
                <Button3D variant="neutral" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => addresses.append({ title: '', postalCode: '', address: '' })}>
                  {m.fields.addAddress}
                </Button3D>
              </div>
            </FormSection>
          ) : null}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}
