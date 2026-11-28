'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import type { ZodType } from 'zod';
import {
  HALL_CATEGORY_LABELS_FA,
  PACKAGING_CATEGORIES,
  destinationSchema,
  faNumber,
  loaderTypeSchema,
  packagingTypeSchema,
  productSchema,
} from '@cb/shared';
import {
  Alert,
  Badge,
  Button3D,
  Combobox,
  DataTable,
  Field,
  Modal,
  NumberInput,
  Select,
  Switch,
  Tabs,
  TextInput,
  type ComboOption,
} from '@cb/ui';
import { useCitySearch } from '@/components/auth/register-data';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import { FactoryPageHeader, useFactoryMutation } from './common';
import { ErrorState } from '@/components/StateViews';

type Kind = 'text' | 'code' | 'number' | 'bool' | 'category' | 'city';
interface FieldDef {
  key: string;
  label: string;
  kind: Kind;
  required?: boolean;
  hint?: string;
}
type Row = { id: string; active: boolean } & Record<string, unknown>;
interface Resource {
  value: string;
  label: string;
  endpoint: string;
  schema: ZodType;
  fields: FieldDef[];
  /** Columns shown in the table (besides status + actions). */
  show: { key: string; label: string; render?: (r: Row) => string }[];
}

const m = t.master;
const RESOURCES: Resource[] = [
  {
    value: 'destinations',
    label: m.tabs.destinations,
    endpoint: '/factory/destinations',
    schema: destinationSchema,
    fields: [
      { key: 'cityId', label: m.city, kind: 'city', required: true },
      { key: 'title', label: t.common.title, kind: 'text', required: true },
      { key: 'sortOrder', label: t.common.sortOrder, kind: 'number' },
      { key: 'active', label: t.common.active, kind: 'bool' },
    ],
    show: [
      { key: 'title', label: t.common.title },
      { key: 'cityName', label: m.city },
      { key: 'provinceName', label: m.province },
      { key: 'sortOrder', label: t.common.sortOrder, render: (r) => faNumber(Number(r.sortOrder)) },
    ],
  },
  {
    value: 'loader-types',
    label: m.tabs.loaderTypes,
    endpoint: '/factory/loader-types',
    schema: loaderTypeSchema,
    fields: [
      { key: 'code', label: m.code, kind: 'code', required: true, hint: m.codeHint },
      { key: 'title', label: t.common.title, kind: 'text', required: true },
      { key: 'sortOrder', label: t.common.sortOrder, kind: 'number' },
      { key: 'active', label: t.common.active, kind: 'bool' },
    ],
    show: [
      { key: 'title', label: t.common.title },
      { key: 'code', label: m.code },
      { key: 'sortOrder', label: t.common.sortOrder, render: (r) => faNumber(Number(r.sortOrder)) },
    ],
  },
  {
    value: 'packaging-types',
    label: m.tabs.packaging,
    endpoint: '/factory/packaging-types',
    schema: packagingTypeSchema,
    fields: [
      { key: 'title', label: t.common.title, kind: 'text', required: true },
      { key: 'category', label: m.packagingCategory, kind: 'category', required: true },
      { key: 'active', label: t.common.active, kind: 'bool' },
    ],
    show: [
      { key: 'title', label: t.common.title },
      { key: 'category', label: m.packagingCategory, render: (r) => HALL_CATEGORY_LABELS_FA[r.category as 'BAG' | 'BULK'] },
    ],
  },
  {
    value: 'products',
    label: m.tabs.products,
    endpoint: '/factory/products',
    schema: productSchema,
    fields: [
      { key: 'title', label: t.common.title, kind: 'text', required: true },
      { key: 'active', label: t.common.active, kind: 'bool' },
    ],
    show: [{ key: 'title', label: t.common.title }],
  },
];

function CityField({ id, initial, onChange }: { id: string; initial: ComboOption | null; onChange: (cityId: number) => void }) {
  const [query, setQuery] = useState(initial?.label ?? '');
  const [selected, setSelected] = useState<ComboOption | null>(initial);
  const cities = useCitySearch(query);
  const options = (cities.data ?? []).map((c) => ({ value: String(c.id), label: c.name, hint: c.province }));
  return (
    <Combobox
      id={id}
      query={query}
      onQueryChange={setQuery}
      options={options}
      selected={selected}
      onSelect={(o) => {
        setSelected(o);
        setQuery(o.label);
        onChange(Number(o.value));
      }}
      loading={cities.isFetching}
      placeholder={m.citySearch}
      emptyText={cities.tooShort ? m.cityMinChars : m.cityNoResult}
    />
  );
}

function defaults(r: Resource): Record<string, unknown> {
  return Object.fromEntries(
    r.fields.map((f) => [f.key, f.kind === 'bool' ? true : f.kind === 'number' ? 0 : f.kind === 'category' ? 'BAG' : f.kind === 'city' ? undefined : '']),
  );
}

function EditModal({ res, row, onClose }: { res: Resource; row: Row | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => (row ? { ...row } : defaults(res)));
  const [error, setError] = useState<string | null>(null);
  const mut = useFactoryMutation(
    (body: Record<string, unknown>) => (row ? api.patch(`${res.endpoint}/${row.id}`, body) : api.post(res.endpoint, body)),
    { invalidate: [['factory', 'master', res.value]], success: row ? t.common.saved : t.common.created, onSuccess: onClose },
  );
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  const submit = () => {
    const body = Object.fromEntries(res.fields.map((f) => [f.key, values[f.key]]));
    const parsed = res.schema.safeParse(body, { error: faErrorMap });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const label = res.fields.find((f) => f.key === issue?.path[0])?.label ?? '';
      setError(`${label}: ${issue?.message ?? ''}`);
      return;
    }
    setError(null);
    const data = parsed.data as Record<string, unknown>;
    // PATCH only what changed (server applies only sent keys).
    const body2 = row ? Object.fromEntries(Object.entries(data).filter(([k, v]) => row[k] !== v)) : data;
    if (Object.keys(body2).length === 0) return onClose();
    mut.mutate(body2);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? t.common.edit : m.add}
      subtitle={res.label}
      size="sm"
      footer={
        <Button3D loading={mut.isPending} onClick={submit}>
          {t.common.save}
        </Button3D>
      }
    >
      <div className="flex flex-col gap-space-md">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {res.fields.map((f) => {
          const id = `md-${f.key}`;
          const v = values[f.key];
          if (f.kind === 'bool') {
            return <Switch key={f.key} id={id} checked={v !== false} onCheckedChange={(c) => set(f.key, c)} label={f.label} />;
          }
          return (
            <Field key={f.key} label={f.label} htmlFor={id} required={f.required} hint={f.hint}>
              {f.kind === 'city' ? (
                <CityField
                  id={id}
                  initial={row ? { value: String(row.cityId), label: String(row.cityName), hint: String(row.provinceName) } : null}
                  onChange={(c) => set(f.key, c)}
                />
              ) : f.kind === 'number' ? (
                <NumberInput id={id} value={String(v ?? '')} onValueChange={(s) => set(f.key, s === '' ? undefined : Number(s))} />
              ) : f.kind === 'category' ? (
                <Select
                  id={id}
                  value={String(v)}
                  onValueChange={(s) => set(f.key, s)}
                  options={PACKAGING_CATEGORIES.map((c) => ({ value: c, label: HALL_CATEGORY_LABELS_FA[c] }))}
                />
              ) : (
                <TextInput
                  id={id}
                  dir={f.kind === 'code' ? 'ltr' : undefined}
                  value={String(v ?? '')}
                  onChange={(e) => set(f.key, f.kind === 'code' ? e.target.value.toUpperCase() : e.target.value)}
                />
              )}
            </Field>
          );
        })}
      </div>
    </Modal>
  );
}

function ResourceTab({ res }: { res: Resource }) {
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['factory', 'master', res.value],
    queryFn: ({ signal }) => api.get<Row[]>(res.endpoint, { signal }),
  });
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      ...res.show.map<ColumnDef<Row, unknown>>((c) => ({
        id: c.key,
        header: c.label,
        meta: { label: c.label },
        accessorFn: (r) => r[c.key],
        cell: ({ row }) => (c.render ? c.render(row.original) : String(row.original[c.key] ?? '—')),
      })),
      {
        id: 'active',
        header: t.common.status,
        meta: { label: t.common.status },
        accessorFn: (r) => r.active,
        cell: ({ row }) => (
          <Badge tone={row.original.active ? 'success' : 'neutral'}>{row.original.active ? t.common.active : t.common.inactive}</Badge>
        ),
      },
      {
        id: 'actions',
        header: t.common.actions,
        enableSorting: false,
        enableHiding: false,
        meta: { label: t.common.actions },
        cell: ({ row }) => (
          <Button3D size="sm" variant="neutral" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(row.original)}>
            {t.common.edit}
          </Button3D>
        ),
      },
    ],
    [res],
  );
  return (
    <>
      <DataTable<Row>
        columns={columns}
        data={q.data ?? []}
        getRowId={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : undefined}
        emptyText={t.common.empty}
        caption={res.label}
        rowTone={(r) => (r.active ? 'success' : 'neutral')}
        toolbar={
          <Button3D size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
            {m.add}
          </Button3D>
        }
      />
      {editing ? <EditModal res={res} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

export function MasterDataPage() {
  return (
    <div>
      <FactoryPageHeader title={m.title} description={m.description} />
      <Tabs aria-label={m.title} items={RESOURCES.map((r) => ({ value: r.value, label: r.label, content: <ResourceTab res={r} /> }))} />
    </div>
  );
}
